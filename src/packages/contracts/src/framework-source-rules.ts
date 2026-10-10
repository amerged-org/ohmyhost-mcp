/**
 * Customer source rules ohmyho.st judges from file text before any install: package.json, its
 * lockfile, ohmyhost.yaml and the framework config. The framework adapters throw the first finding
 * and `ohmyhost init` lists them all, so both answer with the same catalog diagnostics. Findings are
 * ordered by rule group: package.json (build script, dependencies, framework versions, React pins),
 * ohmyhost.yaml with the Worker modules it requires, the better-auth pin, then the framework config.
 * Paths are relative to the application; ohmyhost.yaml stays at the repository root. The Worker
 * handler and database contract rules judge one module's source the same way for both.
 */
import { parseDocument } from "yaml";

import {
  classifyFrameworkVersion,
  FrameworkAdmissionError,
  frameworkVersionDiagnostic,
  isResolvedFrameworkVersion,
  managedCustomerAuthAdmissionIssue,
  parseFrameworkConversionDiagnostic,
  resolveFrameworkConfig,
  resolvePackageManager,
  type FrameworkConversionDiagnostic,
  type FrameworkVersionAdmission,
  type FrameworkVersionPackage,
  type LockfileName,
  type PackageManagerDescriptor,
} from "./framework-admission.js";
import {
  FRAMEWORK_VERSION_POLICY,
  isAdmittedFrameworkBuildScript,
} from "./framework-build-script.mjs";
import { classifyFrameworkFamily } from "./framework-family.js";
import { parseOhmyhostConfigYaml, type OhmyhostConfig } from "./index.js";

/** The only better-auth release the managed auth bridge installs. */
export const MANAGED_BETTER_AUTH_VERSION = "1.7.1" as const;
/** The largest framework config the rules inspect, in UTF-8 bytes. */
export const MAXIMUM_FRAMEWORK_CONFIG_BYTES = 256 * 1024;
/** The customer Worker module of the functions runtime and of Next.js or TanStack Start crons. */
export const WORKER_MODULE_PATH = "src/ohmyhost/worker.ts" as const;
/** The Worker module of a Vite application with a server runtime. */
export const VITE_COMPANION_ENTRY_PATH = "src/ohmyhost/companion.ts" as const;

export type FrameworkSourceFramework = "functions" | "nextjs" | "tanstack-start" | "vite-static";
export type PackageManifest = Readonly<Record<string, unknown>>;
/**
 * Where package.json may declare a dependency: `runtime` only in dependencies, `build` also in
 * devDependencies, `any` also in optionalDependencies.
 */
export type DependencyPlacement = "any" | "build" | "runtime";
export type FrameworkSourceLockfile = Readonly<{ name: LockfileName; text: string }>;
export type FrameworkSourceConfig = Readonly<{ path: string; text: string }>;
export type TanStackRuntime = "edge" | "static";
export type DatabaseContractCode = "database_binding_private" | "database_driver_unsupported";

export interface FrameworkSourceRuleInput {
  readonly framework: FrameworkSourceFramework;
  /** Every file of the application, relative to its root. */
  readonly files: readonly string[];
  readonly configuration: OhmyhostConfig;
  readonly manifest: PackageManifest;
  /** The admitted package manager; null when package.json or its lockfile was refused. */
  readonly packageManager: PackageManagerDescriptor | null;
  /** The decoded lockfile; null leaves every framework version to its declaration. */
  readonly lockfile: FrameworkSourceLockfile | null;
  /** The resolved framework config; null when the application has none. */
  readonly frameworkConfig: FrameworkSourceConfig | null;
}

export interface FrameworkSourceFindings {
  /** Ordered refusals; empty when the source is admitted. Adapters throw the first. */
  readonly findings: readonly FrameworkConversionDiagnostic[];
  /** Every declared governed package; a pending one is admitted and decided after the install. */
  readonly versions: readonly FrameworkVersionAdmission[];
}

export interface RepositorySourceFindings extends FrameworkSourceFindings {
  /** The framework ohmyho.st selects; null when the source is refused before the selection. */
  readonly framework: FrameworkSourceFramework | null;
}

const PACKAGE_MANIFEST = "package.json";
const REPOSITORY_CONFIG = "ohmyhost.yaml";
const TANSTACK_START_PLUGIN = "@tanstack/react-start/plugin/vite";
const CLOUDFLARE_PLUGIN = "@cloudflare/vite-plugin";
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const DEPENDENCY_FIELDS = Object.freeze({
  runtime: Object.freeze(["dependencies"]),
  build: Object.freeze(["dependencies", "devDependencies"]),
  any: Object.freeze(["dependencies", "devDependencies", "optionalDependencies"]),
} as const satisfies Record<DependencyPlacement, readonly string[]>);
// Next.js and TanStack Start load their runtime packages in the server bundle, so package.json
// declares them in dependencies; Vite and its plugins only build, so devDependencies suffice.
const REQUIRED_DEPENDENCIES = Object.freeze({
  nextjs: Object.freeze([
    ["next", "runtime"],
    ["react", "runtime"],
    ["react-dom", "runtime"],
  ] as const),
  "vite-static": Object.freeze([["vite", "build"]] as const),
  "tanstack-start": Object.freeze([
    ["@tanstack/react-start", "runtime"],
    ["@tanstack/react-router", "runtime"],
    ["react", "runtime"],
    ["react-dom", "runtime"],
    ["@vitejs/plugin-react", "build"],
    ["vite", "build"],
  ] as const),
  functions: Object.freeze([] as const),
} satisfies Record<FrameworkSourceFramework, readonly (readonly [string, DependencyPlacement])[]>);
const TANSTACK_EDGE_DEPENDENCY = Object.freeze([CLOUDFLARE_PLUGIN, "build"] as const);
const BUILD_SCRIPT_FRAMEWORKS = Object.freeze({
  nextjs: "nextjs",
  "vite-static": "vite",
  "tanstack-start": "tanstack-start",
} as const);
const BUILD_OUTPUTS: Readonly<Partial<Record<FrameworkSourceFramework, string>>> = Object.freeze({
  "vite-static": "dist",
  "tanstack-start": "dist/client",
});
const REQUIRED_CONFIG_PATHS: Readonly<Partial<Record<FrameworkSourceFramework, string>>> =
  Object.freeze({ nextjs: "next.config.ts", "tanstack-start": "vite.config.ts" });
const MAXIMUM_LOCKFILE_LENGTH = 5 * 1024 * 1024;
const MAXIMUM_PNPM_LOCKFILE_HEAD = 256 * 1024;
const PNPM_LOCKFILE_BODY = /^(?:packages|snapshots):/mu;
const PNPM_LOCKFILE_VERSION = /^(?:6|9)\.[0-9]{1,3}$/u;
const PNPM_RESOLVED_VERSION = /^([^()]+)(?:\(.*\))?$/u;
// Only the default export's handlers are invoked; fetch counts as a key or method, never a call.
const DEFAULT_EXPORT_PATTERN = /\bexport\s+default\b/u;
const FETCH_HANDLER_PATTERN = /(?:[{,;}]|\basync)\s*fetch\s*(?:\(|:|,|\})/u;
const SCHEDULED_HANDLER_PATTERN = /\bscheduled\s*(?:\(|:|,|\})/u;
// No connection string reaches a customer Worker, and a Worker cannot open a socket.
const DATABASE_CONTRACT_PATTERNS = Object.freeze([
  [
    /\bHYPERDRIVE\b|\bconnectionString\b|\bDATABASE_URL\b|postgres(?:ql)?:\/\//u,
    "database_binding_private",
  ],
  [
    /\bfrom\s*["'](?:pg|postgres|mysql2|pg-native)["']|\brequire\(\s*["'](?:pg|postgres|pg-native)["']/u,
    "database_driver_unsupported",
  ],
] as const satisfies readonly (readonly [RegExp, DatabaseContractCode])[]);

/** The parsed package.json, or null when the text or value is not one JSON object. */
export function parsePackageManifest(value: unknown): PackageManifest | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return isRecord(parsed) ? parsed : null;
}

/** The packageManager declaration that resolvePackageManager judges. */
export function packageManagerDeclaration(manifest: PackageManifest): string | undefined {
  const value = manifest["packageManager"];
  return typeof value === "string" ? value : undefined;
}

/**
 * The declared version of a dependency: the first non-empty string among the fields its placement
 * admits, read in the order dependencies, devDependencies, optionalDependencies.
 */
export function declaredDependency(
  manifest: PackageManifest,
  name: string,
  placement: DependencyPlacement,
): string | null {
  for (const field of DEPENDENCY_FIELDS[placement]) {
    const version = ownValue(manifest[field], name);
    if (typeof version === "string" && version.length > 0) return version;
  }
  return null;
}

/** Every dependency name declared with a non-empty version; it selects the framework family. */
export function declaredDependencyNames(manifest: PackageManifest): ReadonlySet<string> {
  const names = new Set<string>();
  for (const field of DEPENDENCY_FIELDS.any) {
    const dependencies = manifest[field];
    if (!isRecord(dependencies)) continue;
    for (const [name, version] of Object.entries(dependencies))
      if (typeof version === "string" && version.length > 0) names.add(name);
  }
  return names;
}

/** A Vite application with a server runtime or any managed capability runs the API companion. */
export function viteCompanionRequired(configuration: OhmyhostConfig): boolean {
  return (
    configuration.runtime.mode === "edge" ||
    configuration.database?.enabled === true ||
    configuration.auth?.provider === "better-auth" ||
    configuration.mail?.enabled === true ||
    configuration.storage !== undefined ||
    (configuration.functions?.crons.length ?? 0) > 0
  );
}

/**
 * The admission of every governed framework package the application declares where the framework
 * needs it. The lockfile resolution decides when the lockfile names one; otherwise the declaration.
 */
export function frameworkVersionAdmissions(
  framework: FrameworkSourceFramework,
  manifest: PackageManifest,
  lockfile: FrameworkSourceLockfile | null,
): readonly FrameworkVersionAdmission[] {
  const admissions: FrameworkVersionAdmission[] = [];
  let locked: ((packageName: string) => string | null) | undefined;
  for (const [name, placement] of REQUIRED_DEPENDENCIES[framework]) {
    if (!isFrameworkVersionPackage(name)) continue;
    const declared = declaredDependency(manifest, name, placement);
    if (declared === null) continue;
    locked ??= lockfile === null ? () => null : lockedPackageVersions(lockfile);
    admissions.push(classifyFrameworkVersion(name, declared, locked(name)));
  }
  return Object.freeze(admissions);
}

/**
 * The versions a trusted lockfile installs, parsed once: the node_modules entries of
 * package-lock.json v2/v3, or the root importer of pnpm-lock.yaml v6/v9 without its peer suffix,
 * read from the head before the top-level packages and snapshots. Other lockfiles, text over 5 Mi
 * characters, a pnpm head over 256 Ki characters, parse failures and versions outside the catalog
 * grammar (links, aliases, workspace, file and URL sources) resolve to null, so the declaration
 * decides. Never throws for customer text.
 */
export function lockedPackageVersions(
  lockfile: Readonly<{ name: string; text: string }>,
): (packageName: string) => string | null {
  const { name, text } = lockfile;
  const npm = name === "package-lock.json";
  if (
    (!npm && name !== "pnpm-lock.yaml") ||
    typeof text !== "string" ||
    text.length > MAXIMUM_LOCKFILE_LENGTH
  )
    return () => null;
  const document = npm ? parseJsonLockfile(text) : parsePnpmLockfileHead(text);
  return (packageName) => {
    const version = npm
      ? npmLockedVersion(document, packageName)
      : pnpmLockedVersion(document, packageName);
    return isResolvedFrameworkVersion(version) ? version : null;
  };
}

/** Every rule of one framework over the application's package.json, configuration and config. */
export function frameworkSourceFindings(input: FrameworkSourceRuleInput): FrameworkSourceFindings {
  const versions = frameworkVersionAdmissions(input.framework, input.manifest, input.lockfile);
  return Object.freeze({
    findings: Object.freeze([
      ...manifestFindings(input, versions),
      ...configurationFindings(input),
      ...betterAuthFindings(input.configuration, input.manifest),
      ...frameworkConfigFindings(input),
    ]),
    versions,
  });
}

/**
 * The whole pure admission of one commit, in the order the platform judges it: ohmyhost.yaml, the
 * application root, package.json, the framework family, the package manager, the framework config
 * file, then frameworkSourceFindings. `files` maps every repository-relative path to its UTF-8 text,
 * or to null when the bytes are not text; only ohmyhost.yaml, package.json, the lockfile and the
 * framework config are read. Worker handlers and database calls (workerModuleFindings,
 * databaseContractCodes) and reachable runtime sources are not judged here.
 */
export function repositorySourceFindings(
  files: ReadonlyMap<string, string | null>,
): RepositorySourceFindings {
  const configuration = repositoryConfiguration(files.get(REPOSITORY_CONFIG));
  if (configuration === null) return refused("repository_configuration_invalid", REPOSITORY_CONFIG);
  const prefix = configuration.applicationRoot === "." ? "" : `${configuration.applicationRoot}/`;
  const applicationFiles = [...files.keys()]
    .filter((path) => path.length > prefix.length && path.startsWith(prefix))
    .map((path) => path.slice(prefix.length));
  if (applicationFiles.length === 0) return refused("application_root_missing", REPOSITORY_CONFIG);
  const text = (path: string) => files.get(`${prefix}${path}`) ?? null;
  const manifest = parsePackageManifest(text(PACKAGE_MANIFEST));
  if (manifest === null) return refused("package_manifest_invalid", PACKAGE_MANIFEST);
  const family =
    configuration.runtime.mode === "functions"
      ? "functions"
      : classifyFrameworkFamily(declaredDependencyNames(manifest));
  if (family === "ambiguous") return refused("framework_ambiguous", PACKAGE_MANIFEST);
  if (family === "unknown") return refused("framework_unsupported", PACKAGE_MANIFEST);
  const framework = family === "vite" ? "vite-static" : family;
  const findings: FrameworkConversionDiagnostic[] = [];
  const packageManager =
    admitted(findings, () =>
      resolvePackageManager({
        packageManager: packageManagerDeclaration(manifest),
        files: applicationFiles,
      }),
    ) ?? null;
  const configPath = frameworkConfigPath(framework, applicationFiles, findings);
  const configText = configPath === null ? null : text(configPath);
  if (configPath !== null && configText === null)
    findings.push(diagnostic({ code: "source_syntax_invalid", path: configPath }));
  const lockfileText = packageManager === null ? null : text(packageManager.lockfile);
  const result = frameworkSourceFindings({
    framework,
    files: applicationFiles,
    configuration,
    manifest,
    packageManager,
    lockfile:
      packageManager === null || lockfileText === null
        ? null
        : Object.freeze({ name: packageManager.lockfile, text: lockfileText }),
    frameworkConfig:
      configPath === null || configText === null
        ? null
        : Object.freeze({ path: configPath, text: configText }),
  });
  return Object.freeze({
    framework,
    findings: Object.freeze([...findings, ...result.findings]),
    versions: result.versions,
  });
}

/**
 * The Next.js config rules: inspection size, comment and string syntax, the root origin
 * (basePath, assetPrefix), output, cacheComponents and the default export; next.config.js may
 * assign module.exports instead.
 */
export function nextConfigFindings(
  text: string,
  path: string,
): readonly FrameworkConversionDiagnostic[] {
  const lexed = lexFrameworkConfig(text, path);
  if ("finding" in lexed) return Object.freeze([lexed.finding]);
  const { tokens } = lexed;
  const findings: FrameworkConversionDiagnostic[] = [];
  if (hasNonRootProperty(tokens, ["basePath", "assetPrefix"], ["", "/"]))
    findings.push(diagnostic({ code: "next_base_path_unsupported", path }));
  if (hasProperty(tokens, "output", "export") || hasProperty(tokens, "output", "standalone"))
    findings.push(diagnostic({ code: "next_output_unsupported", path }));
  if (hasProperty(tokens, "cacheComponents", "true"))
    findings.push(diagnostic({ code: "next_cache_components_unsupported", path }));
  if (
    !hasExportDefault(tokens) &&
    !(path.slice(path.lastIndexOf("/") + 1) === "next.config.js" && hasModuleExports(tokens))
  )
    findings.push(diagnostic({ code: "framework_config_default_export_required", path }));
  return Object.freeze(findings);
}

/** The Vite config rules: inspection size, syntax and a base at the root origin. */
export function viteConfigFindings(
  text: string,
  path: string,
): readonly FrameworkConversionDiagnostic[] {
  const lexed = lexFrameworkConfig(text, path);
  if ("finding" in lexed) return Object.freeze([lexed.finding]);
  return Object.freeze(
    hasNonRootProperty(lexed.tokens, ["base"], ["/"])
      ? [diagnostic({ code: "framework_base_path_unsupported", path })]
      : [],
  );
}

/**
 * The TanStack Start Vite config rules: the Vite rules plus the plugin contract of the runtime.
 * Static imports tanstackStart and calls it with prerender enabled, without the Cloudflare plugin;
 * edge also imports cloudflare and calls cloudflare({ viteEnvironment: { name: "ssr" } }) before
 * tanstackStart(). A null runtime judges only the Vite rules.
 */
export function tanStackViteConfigFindings(
  text: string,
  path: string,
  runtime: TanStackRuntime | null,
): readonly FrameworkConversionDiagnostic[] {
  const lexed = lexFrameworkConfig(text, path);
  if ("finding" in lexed) return Object.freeze([lexed.finding]);
  const findings: FrameworkConversionDiagnostic[] = [];
  if (hasNonRootProperty(lexed.tokens, ["base"], ["/"]))
    findings.push(diagnostic({ code: "framework_base_path_unsupported", path }));
  if (runtime === null) return Object.freeze(findings);
  const contract = tanStackPluginContract(lexed.tokens, runtime);
  if (contract === null)
    return Object.freeze([diagnostic({ code: "source_syntax_invalid", path })]);
  if (!contract.plugins)
    findings.push(diagnostic({ code: "tanstack_vite_plugins_required", path }));
  if (!contract.prerender) findings.push(diagnostic({ code: "tanstack_prerender_required", path }));
  return Object.freeze(findings);
}

/** The TanStack Start runtime whose complete plugin contract the config follows, if any. */
export function tanStackViteConfigRuntime(text: string): TanStackRuntime | null {
  const tokens = exceedsConfigBytes(text) ? null : configTokens(text);
  if (tokens === null) return null;
  for (const runtime of ["static", "edge"] as const) {
    const contract = tanStackPluginContract(tokens, runtime);
    if (contract?.plugins === true && contract.prerender) return runtime;
  }
  return null;
}

/**
 * The database contract a module's source breaks once the configuration enables the managed
 * database: it reads a connection string or imports a socket driver. Comments are ignored and
 * strings count. Planning refuses the first code; `ohmyhost init` lists every one.
 */
export function databaseContractCodes(source: string): readonly DatabaseContractCode[] {
  const code = sourceWithoutComments(source);
  return Object.freeze(
    DATABASE_CONTRACT_PATTERNS.filter(([pattern]) => pattern.test(code)).map(([, found]) => found),
  );
}

/**
 * The handler rules a Worker module breaks, ignoring comments: a default export, with fetch when
 * the module serves requests (runtime.mode: functions) and scheduled when crons are declared.
 * Without a default export no handler is judged, because named exports are never invoked.
 */
export function workerModuleFindings(
  worker: Readonly<{
    path: typeof VITE_COMPANION_ENTRY_PATH | typeof WORKER_MODULE_PATH;
    source: string;
    fetch: boolean;
    scheduled: boolean;
  }>,
): readonly FrameworkConversionDiagnostic[] {
  const { path } = worker;
  const code = sourceWithoutComments(worker.source);
  if (!DEFAULT_EXPORT_PATTERN.test(code))
    return Object.freeze([diagnostic({ code: "worker_module_default_export_required", path })]);
  const findings: FrameworkConversionDiagnostic[] = [];
  if (worker.fetch && !FETCH_HANDLER_PATTERN.test(code))
    findings.push(diagnostic({ code: "worker_module_fetch_handler_required", path }));
  if (worker.scheduled && !SCHEDULED_HANDLER_PATTERN.test(code))
    findings.push(diagnostic({ code: "scheduled_handler_required", path }));
  return Object.freeze(findings);
}

/**
 * Source text with every comment blanked and every string kept, so a URL keeps its "//". A quoted
 * string also ends at a line break, so an apostrophe in JSX text never hides the comments after it,
 * and a slash escaped by a backslash, as in a regex literal, opens no comment.
 */
export function sourceWithoutComments(source: string): string {
  let result = "";
  let quote: "'" | '"' | "`" | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] as string;
    const next = source[index + 1];
    if (quote !== null) {
      result += character;
      if (character === "\\") {
        index += 1;
        result += source[index] ?? "";
      } else if (character === quote || (character === "\n" && quote !== "`")) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      result += character;
      continue;
    }
    if (character === "/" && next === "/" && source[index - 1] !== "\\") {
      while (index < source.length && source[index] !== "\n") {
        result += " ";
        index += 1;
      }
      result += "\n";
      continue;
    }
    if (character === "/" && next === "*" && source[index - 1] !== "\\") {
      result += "  ";
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        result += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      // Blank the closing "*/" as well; the loop then continues after it.
      result += "  ";
      index += 1;
      continue;
    }
    result += character;
  }
  return result;
}

/**
 * Whether the database contract judges a module, in planning and `ohmyhost init` alike: the source
 * extensions planning reads, without TypeScript declaration files, which never run.
 */
export function isDatabaseContractModule(path: string): boolean {
  return /\.(?:ts|tsx|js|jsx|mjs|mts)$/u.test(path) && !/\.d\.[cm]?ts$/u.test(path);
}

function manifestFindings(
  input: FrameworkSourceRuleInput,
  versions: readonly FrameworkVersionAdmission[],
): FrameworkConversionDiagnostic[] {
  const { configuration, framework, manifest } = input;
  const findings: FrameworkConversionDiagnostic[] = [];
  if (
    framework !== "functions" &&
    !isAdmittedFrameworkBuildScript(
      BUILD_SCRIPT_FRAMEWORKS[framework],
      ownValue(manifest["scripts"], "build"),
    )
  )
    findings.push(
      diagnostic({ code: "build_script_unsupported", path: PACKAGE_MANIFEST, framework }),
    );
  const required =
    framework === "tanstack-start" && configuration.runtime.mode === "edge"
      ? [...REQUIRED_DEPENDENCIES[framework], TANSTACK_EDGE_DEPENDENCY]
      : REQUIRED_DEPENDENCIES[framework];
  for (const [name, placement] of required)
    if (declaredDependency(manifest, name, placement) === null)
      findings.push(
        diagnostic({
          code: "framework_dependency_required",
          path: PACKAGE_MANIFEST,
          package: name,
        }),
      );
  for (const admission of versions) {
    const finding = frameworkVersionDiagnostic(admission, input.lockfile?.name ?? null);
    if (finding !== null) findings.push(finding);
  }
  if (framework === "nextjs")
    for (const name of ["react", "react-dom"]) {
      const version = declaredDependency(manifest, name, "runtime");
      if (version !== null && !EXACT_VERSION.test(version))
        findings.push(
          diagnostic({
            code: "react_version_exact_required",
            path: PACKAGE_MANIFEST,
            package: name,
          }),
        );
    }
  return findings;
}

function configurationFindings(input: FrameworkSourceRuleInput): FrameworkConversionDiagnostic[] {
  const { configuration, files, framework, packageManager } = input;
  const build = "command" in configuration.build ? configuration.build : null;
  const crons = (configuration.functions?.crons.length ?? 0) > 0;
  const findings: FrameworkConversionDiagnostic[] = [];
  // runtime.mode functions selects the functions framework, whose build is only build.install.
  if (framework !== "functions" && !runtimeModeAdmitted(framework, configuration, crons))
    findings.push(
      diagnostic({ code: "runtime_mode_unsupported", path: REPOSITORY_CONFIG, framework }),
    );
  if (build !== null && framework !== "nextjs" && build.ssg_cache_max_mib !== undefined)
    findings.push(diagnostic({ code: "build_option_unsupported", path: REPOSITORY_CONFIG }));
  const output = BUILD_OUTPUTS[framework];
  if (build !== null && output !== undefined && build.output !== output)
    findings.push(
      diagnostic({ code: "build_output_unsupported", path: REPOSITORY_CONFIG, framework }),
    );
  // A Next.js plan always runs the commands of its package manager, whatever ohmyhost.yaml says.
  if (
    packageManager !== null &&
    framework !== "nextjs" &&
    (configuration.build.install !== packageManager.installCommand ||
      (build !== null && build.command !== packageManager.buildCommand))
  )
    findings.push(diagnostic({ code: "build_command_mismatch", path: REPOSITORY_CONFIG }));
  if (
    framework === "vite-static" &&
    viteCompanionRequired(configuration) &&
    !files.includes(VITE_COMPANION_ENTRY_PATH)
  )
    findings.push(
      diagnostic({ code: "companion_entry_required", path: VITE_COMPANION_ENTRY_PATH }),
    );
  if (
    (framework === "functions" ||
      (crons &&
        (framework === "nextjs" ||
          (framework === "tanstack-start" && configuration.runtime.mode === "edge")))) &&
    !files.includes(WORKER_MODULE_PATH)
  )
    findings.push(diagnostic({ code: "worker_module_required", path: WORKER_MODULE_PATH }));
  if (managedCustomerAuthAdmissionIssue(configuration) !== null)
    findings.push(diagnostic({ code: "managed_auth_database_required", path: REPOSITORY_CONFIG }));
  return findings;
}

function runtimeModeAdmitted(
  framework: Exclude<FrameworkSourceFramework, "functions">,
  configuration: OhmyhostConfig,
  crons: boolean,
): boolean {
  const mode = configuration.runtime.mode;
  if (framework === "nextjs") return mode === "edge";
  if (framework === "vite-static")
    return mode === (viteCompanionRequired(configuration) ? "edge" : "static");
  return mode === "edge" || (mode === "static" && !crons && configuration.storage === undefined);
}

function betterAuthFindings(
  configuration: OhmyhostConfig,
  manifest: PackageManifest,
): FrameworkConversionDiagnostic[] {
  return configuration.auth?.provider === "better-auth" &&
    declaredDependency(manifest, "better-auth", "any") !== MANAGED_BETTER_AUTH_VERSION
    ? [diagnostic({ code: "better_auth_version_required", path: PACKAGE_MANIFEST })]
    : [];
}

function frameworkConfigFindings(
  input: FrameworkSourceRuleInput,
): readonly FrameworkConversionDiagnostic[] {
  const { frameworkConfig, framework } = input;
  if (frameworkConfig === null || framework === "functions") return [];
  const { path, text } = frameworkConfig;
  if (framework === "nextjs") return nextConfigFindings(text, path);
  if (framework === "vite-static") return viteConfigFindings(text, path);
  const mode = input.configuration.runtime.mode;
  return tanStackViteConfigFindings(text, path, mode === "edge" || mode === "static" ? mode : null);
}

function repositoryConfiguration(text: string | null | undefined): OhmyhostConfig | null {
  if (typeof text !== "string") return null;
  try {
    return parseOhmyhostConfigYaml(text);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

/** The framework config file; ambiguous variants and a missing required config are findings. */
function frameworkConfigPath(
  framework: FrameworkSourceFramework,
  files: readonly string[],
  findings: FrameworkConversionDiagnostic[],
): string | null {
  if (framework === "functions") return null;
  const path = admitted(findings, () =>
    resolveFrameworkConfig(framework === "nextjs" ? "next.config" : "vite.config", files),
  );
  if (framework === "nextjs")
    admitted(findings, () => resolveFrameworkConfig("open-next.config", files));
  const required = REQUIRED_CONFIG_PATHS[framework];
  if (path === null && required !== undefined)
    findings.push(diagnostic({ code: "framework_config_required", path: required }));
  return path ?? null;
}

/** The result of a contracts admission, or undefined after recording its typed refusal. */
function admitted<T>(findings: FrameworkConversionDiagnostic[], admit: () => T): T | undefined {
  try {
    return admit();
  } catch (error) {
    if (!(error instanceof FrameworkAdmissionError)) throw error;
    findings.push(error.diagnostic);
    return undefined;
  }
}

function refused(
  code:
    | "application_root_missing"
    | "framework_ambiguous"
    | "framework_unsupported"
    | "package_manifest_invalid"
    | "repository_configuration_invalid",
  path: string,
): RepositorySourceFindings {
  return Object.freeze({
    framework: null,
    findings: Object.freeze([diagnostic({ code, path })]),
    versions: Object.freeze([]),
  });
}

function diagnostic(value: unknown): FrameworkConversionDiagnostic {
  const parsed = parseFrameworkConversionDiagnostic(value);
  if (parsed === null) throw new TypeError("Framework source diagnostic is invalid");
  return parsed;
}

function isFrameworkVersionPackage(name: string): name is FrameworkVersionPackage {
  return Object.hasOwn(FRAMEWORK_VERSION_POLICY, name);
}

function parseJsonLockfile(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The importers sit in the head of pnpm-lock.yaml, before its top-level packages and snapshots. */
function parsePnpmLockfileHead(text: string): unknown {
  const end = text.search(PNPM_LOCKFILE_BODY);
  const head = end === -1 ? text : text.slice(0, end);
  if (head.length > MAXIMUM_PNPM_LOCKFILE_HEAD) return null;
  try {
    const document = parseDocument(head, {
      customTags: [],
      logLevel: "error",
      merge: false,
      prettyErrors: false,
      resolveKnownTags: false,
      schema: "core",
      strict: true,
      stringKeys: true,
      // The parser compares every key with every earlier one; pnpm refuses repeated keys itself.
      uniqueKeys: false,
      version: "1.2",
    });
    // pnpm never writes aliases, so a single alias already exceeds the limit.
    return document.errors.length === 0 && document.warnings.length === 0
      ? document.toJS({ maxAliasCount: 0 })
      : null;
  } catch {
    return null;
  }
}

function npmLockedVersion(document: unknown, packageName: string): unknown {
  if (
    !isRecord(document) ||
    (document["lockfileVersion"] !== 2 && document["lockfileVersion"] !== 3)
  )
    return null;
  const entry = ownValue(document["packages"], `node_modules/${packageName}`);
  // npm records the real name of an npm: alias and marks workspace and file: directories as links.
  return isRecord(entry) &&
    !Object.hasOwn(entry, "link") &&
    (entry["name"] === undefined || entry["name"] === packageName)
    ? entry["version"]
    : null;
}

function pnpmLockedVersion(document: unknown, packageName: string): unknown {
  if (!isRecord(document)) return null;
  const lockfileVersion = document["lockfileVersion"];
  if (typeof lockfileVersion !== "string" || !PNPM_LOCKFILE_VERSION.test(lockfileVersion))
    return null;
  const importers = document["importers"];
  // Lockfile v6 inlines a single root project at the top level; v9 always lists its importers.
  const root =
    importers === undefined && lockfileVersion.startsWith("6.")
      ? document
      : ownValue(importers, ".");
  if (!isRecord(root)) return null;
  for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const dependencies = root[group];
    if (!isRecord(dependencies) || !Object.hasOwn(dependencies, packageName)) continue;
    const entry = dependencies[packageName];
    return isRecord(entry) && typeof entry["version"] === "string"
      ? (PNPM_RESOLVED_VERSION.exec(entry["version"])?.[1] ?? null)
      : null;
  }
  return null;
}

function ownValue(record: unknown, key: string): unknown {
  return isRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ConfigToken {
  readonly kind: "identifier" | "number" | "punctuation" | "string";
  readonly value: string;
}

type ConfigLexing =
  | Readonly<{ tokens: readonly ConfigToken[] }>
  | Readonly<{ finding: FrameworkConversionDiagnostic }>;

const PUNCTUATION = "{}[]():,.;?=-!";

/** The config tokens, or its size or syntax finding. The path must be a framework config path. */
function lexFrameworkConfig(text: string, path: string): ConfigLexing {
  const tooLarge = diagnostic({ code: "framework_config_too_large", path });
  if (exceedsConfigBytes(text)) return { finding: tooLarge };
  const tokens = configTokens(text);
  return tokens === null
    ? { finding: diagnostic({ code: "source_syntax_invalid", path }) }
    : { tokens };
}

/** UTF-8 never takes fewer bytes than UTF-16 code units, so long text is refused unencoded. */
function exceedsConfigBytes(text: string): boolean {
  return (
    text.length > MAXIMUM_FRAMEWORK_CONFIG_BYTES ||
    new TextEncoder().encode(text).byteLength > MAXIMUM_FRAMEWORK_CONFIG_BYTES
  );
}

/**
 * Identifiers, numbers, string contents and punctuation of config source, without comments and
 * without evaluating it; null when a block comment or a string is unterminated.
 */
function configTokens(source: string): readonly ConfigToken[] | null {
  const tokens: ConfigToken[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index] as string;
    const next = source[index + 1];
    if (character === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      index = end === -1 ? source.length : end + 1;
    } else if (character === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) return null;
      index = end + 2;
    } else if (character === "'" || character === '"' || character === "`") {
      const string = readString(source, index, character);
      if (string === null) return null;
      tokens.push(string.token);
      index = string.nextIndex;
    } else if (isIdentifierStart(character) || isDigit(character)) {
      const start = index;
      const part = isDigit(character) ? isDigit : isIdentifierPart;
      index += 1;
      while (index < source.length && part(source[index] as string)) index += 1;
      tokens.push({
        kind: isDigit(character) ? "number" : "identifier",
        value: source.slice(start, index),
      });
    } else {
      if (PUNCTUATION.includes(character)) tokens.push({ kind: "punctuation", value: character });
      index += 1;
    }
  }
  return tokens;
}

function readString(
  source: string,
  index: number,
  quote: "'" | '"' | "`",
): Readonly<{ token: ConfigToken; nextIndex: number }> | null {
  let cursor = index + 1;
  let value = "";
  while (cursor < source.length) {
    const character = source[cursor] as string;
    if (character === quote) return { token: { kind: "string", value }, nextIndex: cursor + 1 };
    if (character === "\\") {
      const escaped = source[cursor + 1];
      if (escaped === undefined) return null;
      value += escaped;
      cursor += 2;
    } else {
      value += character;
      cursor += 1;
    }
  }
  return null;
}

function isIdentifierStart(character: string): boolean {
  return (
    (character >= "A" && character <= "Z") ||
    (character >= "a" && character <= "z") ||
    character === "_" ||
    character === "$"
  );
}

function isIdentifierPart(character: string): boolean {
  return isIdentifierStart(character) || isDigit(character);
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

/**
 * Whether an object key in `names`, direct or computed, has a value other than undefined or one of
 * the root strings. Shorthand and computed values cannot be judged and count as non-root.
 */
function hasNonRootProperty(
  tokens: readonly ConfigToken[],
  names: readonly string[],
  rootStrings: readonly string[],
): boolean {
  let objectDepth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as ConfigToken;
    if (token.value === "{" || token.value === "}") {
      objectDepth += token.value === "{" ? 1 : -1;
      continue;
    }
    const before = tokens[index - 1]?.value;
    const directKey = before === "{" || before === ",";
    const computedKey =
      before === "[" &&
      tokens[index + 1]?.value === "]" &&
      (tokens[index - 2]?.value === "{" || tokens[index - 2]?.value === ",");
    if (objectDepth < 1 || !names.includes(token.value) || (!directKey && !computedKey)) continue;
    const separator = tokens[index + (computedKey ? 2 : 1)]?.value;
    const value = tokens[index + (computedKey ? 3 : 2)];
    const root =
      separator === ":" &&
      ((value?.kind === "string" && rootStrings.includes(value.value)) ||
        (value?.kind === "identifier" && value.value === "undefined"));
    if (!root) return true;
  }
  return false;
}

function hasProperty(tokens: readonly ConfigToken[], name: string, value: string): boolean {
  return tokens.some(
    (token, index) =>
      token.value === name &&
      tokens[index + 1]?.value === ":" &&
      tokens[index + 2]?.value === value,
  );
}

function hasExportDefault(tokens: readonly ConfigToken[]): boolean {
  return tokens.some(
    (token, index) => token.value === "export" && tokens[index + 1]?.value === "default",
  );
}

/** module.exports = … or module["exports"] = …, but not a comparison. */
function hasModuleExports(tokens: readonly ConfigToken[]): boolean {
  return tokens.some((token, index) => {
    if (token.kind !== "identifier" || token.value !== "module") return false;
    const property = tokens[index + 2];
    const direct =
      tokens[index + 1]?.value === "." &&
      property?.kind === "identifier" &&
      property.value === "exports";
    const computed =
      tokens[index + 1]?.value === "[" &&
      property?.kind === "string" &&
      property.value === "exports" &&
      tokens[index + 3]?.value === "]";
    const assignment = index + (computed ? 4 : 3);
    return (
      (direct || computed) &&
      tokens[assignment]?.value === "=" &&
      tokens[assignment + 1]?.value !== "="
    );
  });
}

/**
 * Whether the config follows the plugin contract of the runtime and, for static, enables prerender;
 * null when the options object of a plugin call is not closed.
 */
function tanStackPluginContract(
  tokens: readonly ConfigToken[],
  runtime: TanStackRuntime,
): Readonly<{ plugins: boolean; prerender: boolean }> | null {
  const closing = closingBraces(tokens);
  const imported = hasNamedImport(tokens, "tanstackStart", TANSTACK_START_PLUGIN);
  if (runtime === "static") {
    const calls = callOptions(tokens, closing, "tanstackStart");
    return calls === null
      ? null
      : {
          plugins: imported && !hasModuleImport(tokens, CLOUDFLARE_PLUGIN),
          prerender: calls.some(
            ([start, end]) =>
              nestedPropertyValue(tokens, closing, start, end, "prerender", "enabled") === "true",
          ),
        };
  }
  const calls = callOptions(tokens, closing, "cloudflare");
  return calls === null
    ? null
    : {
        plugins:
          imported &&
          hasNamedImport(tokens, "cloudflare", CLOUDFLARE_PLUGIN) &&
          calls.some(
            ([start, end]) =>
              nestedPropertyValue(tokens, closing, start, end, "viteEnvironment", "name") === "ssr",
          ) &&
          callIndex(tokens, "cloudflare") < callIndex(tokens, "tanstackStart"),
        prerender: true,
      };
}

/** For every `{`, the index of the `}` that closes it, or -1 when none does. */
function closingBraces(tokens: readonly ConfigToken[]): readonly number[] {
  const closing = tokens.map(() => -1);
  const open: number[] = [];
  tokens.forEach((token, index) => {
    if (token.value === "{") open.push(index);
    if (token.value !== "}") return;
    const start = open.pop();
    if (start !== undefined) closing[start] = index;
  });
  return closing;
}

/** The options object of every `name({ … })` call; null when one is not closed. */
function callOptions(
  tokens: readonly ConfigToken[],
  closing: readonly number[],
  name: string,
): readonly (readonly [number, number])[] | null {
  const calls: (readonly [number, number])[] = [];
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (
      tokens[index]?.value !== name ||
      tokens[index + 1]?.value !== "(" ||
      tokens[index + 2]?.value !== "{"
    )
      continue;
    const end = closing[index + 2] ?? -1;
    if (end === -1) return null;
    calls.push([index + 2, end]);
  }
  return calls;
}

/** The value token of `outer: { inner: value }` directly inside an object, if present. */
function nestedPropertyValue(
  tokens: readonly ConfigToken[],
  closing: readonly number[],
  start: number,
  end: number,
  outer: string,
  inner: string,
): string | null {
  const object = directProperty(tokens, closing, start, end, outer);
  if (object?.value !== "{") return null;
  return directProperty(tokens, closing, object.start, object.end, inner)?.value ?? null;
}

/**
 * The first value token of a property at the top level of the object between start and end, with
 * the range of an object value. Nested objects are skipped whole; brackets and parentheses nest.
 */
function directProperty(
  tokens: readonly ConfigToken[],
  closing: readonly number[],
  start: number,
  end: number,
  name: string,
): Readonly<{ start: number; end: number; value: string }> | null {
  let depth = 0;
  for (let index = start + 1; index < end; index += 1) {
    const value = tokens[index]?.value;
    if (value === "{") {
      index = Math.max(index, closing[index] ?? -1);
      continue;
    }
    if (value === "[" || value === "(") depth += 1;
    if (value === "]" || value === ")") depth -= 1;
    if (depth !== 0 || value !== name || tokens[index + 1]?.value !== ":") continue;
    const candidate = tokens[index + 2]?.value ?? "";
    const close = candidate === "{" ? (closing[index + 2] ?? -1) : index + 2;
    return { start: index + 2, end: close, value: candidate };
  }
  return null;
}

function callIndex(tokens: readonly ConfigToken[], name: string): number {
  return tokens.findIndex(
    (token, index) => token.value === name && tokens[index + 1]?.value === "(",
  );
}

/** Whether an import statement names `name` and loads it from `moduleName`. */
function hasNamedImport(tokens: readonly ConfigToken[], name: string, moduleName: string): boolean {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.value !== "import") continue;
    let from = index + 1;
    while (from < tokens.length && tokens[from]?.value !== "from") from += 1;
    if (from === tokens.length) return false;
    const source = tokens[from + 1];
    if (
      source?.kind === "string" &&
      source.value === moduleName &&
      tokens.slice(index + 1, from).some((token) => token.value === name)
    )
      return true;
    index = from;
  }
  return false;
}

function hasModuleImport(tokens: readonly ConfigToken[], moduleName: string): boolean {
  return tokens.some(
    (token, index) =>
      token.value === "from" &&
      tokens[index + 1]?.kind === "string" &&
      tokens[index + 1]?.value === moduleName,
  );
}
