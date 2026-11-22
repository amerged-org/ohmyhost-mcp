import configSchema from "../schemas/ohmyhost.schema.json" with { type: "json" };
import {
  compareStableVersions,
  FRAMEWORK_VERSION_POLICY,
  frameworkVersionMinimum,
  frameworkVersionVerdict,
  parseStableVersion,
  PINNED_BUN_VERSION,
  type FrameworkVersionPackage,
  type FrameworkVersionPolicy,
} from "./framework-build-script.mjs";
import { managedCustomerAuthDatabaseMessage } from "./customer-auth-admission.js";
export { managedCustomerAuthAdmissionIssue } from "./customer-auth-admission.js";
export type { FrameworkVersionPackage } from "./framework-build-script.mjs";

export type PackageManagerName = "bun" | "npm" | "pnpm" | "yarn";
export type LockfileName =
  | "bun.lock"
  | "bun.lockb"
  | "package-lock.json"
  | "pnpm-lock.yaml"
  | "yarn.lock";
export type FrameworkConfigBasename =
  | "astro.config"
  | "next.config"
  | "open-next.config"
  | "vite.config";

export type FrameworkAdmissionReason =
  | "ambiguous_config"
  | "ambiguous_lockfile"
  | "invalid_package_manager"
  | "missing_lockfile"
  | "missing_package_manager"
  | "package_manager_lockfile_mismatch"
  | "package_manager_version_unsupported";

const ADMISSION_DIAGNOSTIC_CODES = Object.freeze({
  ambiguous_config: "framework_config_ambiguous",
  ambiguous_lockfile: "lockfile_ambiguous",
  invalid_package_manager: "package_manager_invalid",
  missing_lockfile: "lockfile_missing",
  missing_package_manager: "package_manager_missing",
  package_manager_lockfile_mismatch: "package_manager_lockfile_mismatch",
  package_manager_version_unsupported: "package_manager_version_unsupported",
} as const satisfies Record<FrameworkAdmissionReason, string>);

export class FrameworkAdmissionError extends Error {
  public readonly code = "framework_admission_failed";
  /** The catalog diagnostic of the refused file, relative to the application root. */
  public readonly diagnostic: FrameworkConversionDiagnostic;

  public constructor(
    public readonly reason: FrameworkAdmissionReason,
    path: string,
  ) {
    super("Framework source is not admitted");
    this.name = "FrameworkAdmissionError";
    this.diagnostic = requiredDiagnostic({ code: ADMISSION_DIAGNOSTIC_CODES[reason], path });
  }
}

export interface PackageManagerInput {
  readonly packageManager: string | undefined;
  readonly files: readonly string[];
}

export interface PackageManagerDescriptor {
  readonly manager: PackageManagerName;
  readonly version: string;
  readonly lockfile: LockfileName;
  readonly installCommand: string;
  readonly buildCommand: string;
}

interface PackageManagerContract {
  readonly lockfiles: readonly LockfileName[];
  readonly installCommand: string;
  readonly buildCommand: string;
}

export const PACKAGE_MANAGER_CONTRACTS: Readonly<
  Record<PackageManagerName, PackageManagerContract>
> = Object.freeze({
  bun: Object.freeze({
    lockfiles: Object.freeze(["bun.lock", "bun.lockb"] as const),
    installCommand: "bun install --frozen-lockfile --ignore-scripts",
    buildCommand: "bun run build",
  }),
  npm: Object.freeze({
    lockfiles: Object.freeze(["package-lock.json"] as const),
    installCommand: "npm ci --ignore-scripts",
    buildCommand: "npm run build",
  }),
  pnpm: Object.freeze({
    lockfiles: Object.freeze(["pnpm-lock.yaml"] as const),
    installCommand: "pnpm install --frozen-lockfile --ignore-scripts",
    buildCommand: "pnpm run build",
  }),
  yarn: Object.freeze({
    lockfiles: Object.freeze(["yarn.lock"] as const),
    installCommand: "yarn install --immutable --mode=skip-build",
    buildCommand: "yarn run build",
  }),
});

const ALL_LOCKFILES: readonly string[] = Object.freeze(
  Object.values(PACKAGE_MANAGER_CONTRACTS).flatMap(({ lockfiles }) => lockfiles),
);
const PACKAGE_MANIFEST = "package.json";
// Yarn 2.0.0 introduced --immutable and Yarn 3.0.0 renamed --skip-builds to --mode=skip-build; the frozen,
// script-free install needs both, so an earlier Yarn is refused rather than run unfrozen or failing late.
const YARN_MINIMUM_MAJOR = 3;
const PACKAGE_MANAGER_DECLARATION =
  /^(bun|npm|pnpm|yarn)@((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/u;

export function resolvePackageManager(input: PackageManagerInput): PackageManagerDescriptor {
  const presentLockfiles = ALL_LOCKFILES.filter((lockfile) => input.files.includes(lockfile));
  if (presentLockfiles.length === 0) {
    throw new FrameworkAdmissionError("missing_lockfile", PACKAGE_MANIFEST);
  }
  if (presentLockfiles.length !== 1) {
    throw new FrameworkAdmissionError("ambiguous_lockfile", PACKAGE_MANIFEST);
  }
  if (input.packageManager === undefined) {
    throw new FrameworkAdmissionError("missing_package_manager", PACKAGE_MANIFEST);
  }
  const declaration = PACKAGE_MANAGER_DECLARATION.exec(input.packageManager);
  if (declaration === null) {
    throw new FrameworkAdmissionError("invalid_package_manager", PACKAGE_MANIFEST);
  }
  const manager = declaration[1] as PackageManagerName;
  const version = declaration[2] as string;
  const contract = PACKAGE_MANAGER_CONTRACTS[manager];
  const lockfile = presentLockfiles[0] as LockfileName;
  if (!contract.lockfiles.includes(lockfile)) {
    throw new FrameworkAdmissionError("package_manager_lockfile_mismatch", lockfile);
  }
  if (manager === "bun" && version !== PINNED_BUN_VERSION) {
    throw new FrameworkAdmissionError("package_manager_version_unsupported", PACKAGE_MANIFEST);
  }
  if (manager === "yarn" && Number(version.split(".")[0]) < YARN_MINIMUM_MAJOR) {
    throw new FrameworkAdmissionError("package_manager_version_unsupported", PACKAGE_MANIFEST);
  }
  return Object.freeze({
    manager,
    version,
    lockfile,
    installCommand: contract.installCommand,
    buildCommand: contract.buildCommand,
  });
}

export function resolveFrameworkConfig(
  basename: FrameworkConfigBasename,
  files: readonly string[],
): string | null {
  const supported = [`${basename}.js`, `${basename}.mjs`, `${basename}.ts`] as const;
  const matches = supported.filter((candidate) => files.includes(candidate));
  if (matches.length > 1) {
    throw new FrameworkAdmissionError("ambiguous_config", matches[0] as string);
  }
  return matches[0] ?? null;
}

export type FrameworkVersionStatus = "admitted" | "pending" | "unsupported";

/** One framework package judged by its lockfile resolution or, without one, its declaration. */
export interface FrameworkVersionAdmission {
  readonly package: FrameworkVersionPackage;
  readonly status: FrameworkVersionStatus;
  readonly declared: string;
  readonly resolved: string | null;
  /** The lowest admitted release for the line of the judged version; it names the required change. */
  readonly minimum: string;
}

type VersionTuple = readonly [major: number, minor: number, patch: number];

const STABLE_VERSION_SOURCE =
  "(?:0|[1-9][0-9]{0,5})\\.(?:0|[1-9][0-9]{0,5})\\.(?:0|[1-9][0-9]{0,5})";
const VERSION_RANGE = new RegExp(`^([~^])(${STABLE_VERSION_SOURCE})$`, "u");

/**
 * A non-null lockfile resolution decides with the shared verdict. Without one, an exact declaration
 * decides. A ^ range (below the next major) or ~ range (below the next minor) is admitted when every
 * version it allows passes, unsupported when none can, and otherwise pending: planning admits it and
 * the build's installed-version check decides. Every other declaration form is unsupported.
 */
export function classifyFrameworkVersion(
  packageName: FrameworkVersionPackage,
  declared: string,
  resolved: string | null = null,
  policy: FrameworkVersionPolicy = FRAMEWORK_VERSION_POLICY,
): FrameworkVersionAdmission {
  const judged = resolved ?? declared;
  const range = resolved === null ? VERSION_RANGE.exec(declared) : null;
  let status: FrameworkVersionStatus;
  if (range === null) {
    status =
      frameworkVersionVerdict(packageName, judged, policy) === "admitted"
        ? "admitted"
        : "unsupported";
  } else {
    status = rangeStatus(packageName, range[1] === "^", range[2] as string, policy);
  }
  return Object.freeze({
    package: packageName,
    status,
    declared,
    resolved,
    minimum: frameworkVersionMinimum(packageName, judged, policy),
  });
}

function rangeStatus(
  packageName: FrameworkVersionPackage,
  caret: boolean,
  base: string,
  policy: FrameworkVersionPolicy,
): FrameworkVersionStatus {
  const lower = policyVersion(base);
  const upper: VersionTuple = caret ? [lower[0] + 1, 0, 0] : [lower[0], lower[1] + 1, 0];
  if (
    frameworkVersionVerdict(packageName, base, policy) === "admitted" &&
    !policy[packageName].denied.some(([introduced, fixed]) => {
      const from = parseStableVersion(introduced);
      const to = fixed === null ? null : parseStableVersion(fixed);
      return (
        from !== null &&
        compareStableVersions(from, upper) < 0 &&
        (to === null || compareStableVersions(to, lower) > 0)
      );
    })
  )
    return "admitted";
  // The lowest release inside the range that can pass: past the floor and every fixed denied range.
  const minimum = policyVersion(frameworkVersionMinimum(packageName, base, policy));
  const candidate = compareStableVersions(minimum, lower) > 0 ? minimum : lower;
  return compareStableVersions(candidate, upper) < 0 &&
    frameworkVersionVerdict(packageName, candidate.join("."), policy) === "admitted"
    ? "pending"
    : "unsupported";
}

function policyVersion(version: string): VersionTuple {
  const parsed = parseStableVersion(version);
  if (parsed === null) throw new TypeError("Framework version policy is invalid");
  return parsed;
}

const RESOLVED_VERSION_SOURCE = `${STABLE_VERSION_SOURCE}(?:-[0-9A-Za-z.-]{1,32})?`;
const RESOLVED_VERSION_FIELD = anchoredPattern(RESOLVED_VERSION_SOURCE);
const DECLARED_VERSION_FIELD = anchoredPattern(`[~^]?${RESOLVED_VERSION_SOURCE}`);
const STABLE_VERSION_FIELD = anchoredPattern(STABLE_VERSION_SOURCE);

/** A version the catalog names as resolved: X.Y.Z or X.Y.Z-<up to 32 of [0-9A-Za-z.-]>. */
export function isResolvedFrameworkVersion(value: unknown): value is string {
  return typeof value === "string" && RESOLVED_VERSION_FIELD.test(value);
}

/**
 * The typed refusal of an unsupported admission, naming the file that decided it: the lockfile for
 * a resolved version, package.json for a declaration. A declaration outside the exact, ^ and ~ forms
 * asks for one of them. Admitted and pending admissions are not refused.
 */
export function frameworkVersionDiagnostic(
  admission: FrameworkVersionAdmission,
  lockfile: LockfileName | null,
): FrameworkConversionDiagnostic | null {
  if (admission.status !== "unsupported") return null;
  if (admission.resolved !== null) {
    if (lockfile === null) throw new TypeError("Framework version lockfile is required");
    return requiredDiagnostic({
      code: "framework_version_unsupported",
      path: lockfile,
      package: admission.package,
      version: admission.resolved,
      minimum: admission.minimum,
    });
  }
  return DECLARED_VERSION_FIELD.test(admission.declared)
    ? requiredDiagnostic({
        code: "framework_version_unsupported",
        path: PACKAGE_MANIFEST,
        package: admission.package,
        version: admission.declared,
        minimum: admission.minimum,
      })
    : requiredDiagnostic({
        code: "framework_version_declaration_unsupported",
        path: PACKAGE_MANIFEST,
        package: admission.package,
      });
}

/**
 * The file a diagnostic names. Every class but repository_config is relative to the application
 * and may carry its application-root prefix; ohmyhost.yaml always sits at the repository root.
 */
export type FrameworkConversionPathClass =
  | "framework_config"
  | "lockfile"
  | "manifest"
  | "module"
  | "repository_config";

/** A field value grammar: a closed set of values or an anchored pattern. */
type FieldGrammar = readonly string[] | RegExp;

interface DerivedText {
  /** `path` selects by path class; any other name selects by that field's value. */
  readonly from: string;
  readonly text: Readonly<Record<string, string>>;
}

interface DetailDefinition {
  readonly paths: readonly FrameworkConversionPathClass[];
  readonly fields?: Readonly<Record<string, FieldGrammar>>;
  readonly derived?: Readonly<Record<string, DerivedText>>;
  /** The sentence; `{{name}}` places the path, a field or a derived text. */
  readonly template: string;
}

const FRAMEWORK_VERSION_PACKAGES = Object.freeze([
  "astro",
  "@astrojs/cloudflare",
  "next",
  "vite",
  "@tanstack/react-start",
] as const satisfies readonly FrameworkVersionPackage[]);
const FRAMEWORK_DEPENDENCY_PACKAGES = Object.freeze([
  "astro",
  "@astrojs/cloudflare",
  "next",
  "react",
  "react-dom",
  "vite",
  "@tanstack/react-start",
  "@tanstack/react-router",
  "@vitejs/plugin-react",
  "@cloudflare/vite-plugin",
] as const);
const REACT_PACKAGES = Object.freeze(["react", "react-dom"] as const);
const BUILD_FRAMEWORKS = Object.freeze([
  "astro",
  "nextjs",
  "vite-static",
  "tanstack-start",
] as const);

const PUSH_AND_PLAN = "Commit and push the change, then plan the new commit.";
const VITE_BUILD_SCRIPT =
  '"vite build", optionally joined with && to one "tsc", "tsc -b", "tsc --build" or "tsc --noEmit" stage';

// Each sentence names the file, the rule and the exact change. Render and parse both derive from
// the template, so a client maps a detail back to exactly one typed diagnostic.
const FRAMEWORK_CONVERSION_DETAILS = Object.freeze({
  native_auth_route_conflict: {
    paths: ["module"],
    template:
      '"{{path}}" declares a route in the reserved /api/auth/v1 namespace. Move the route or select a different authentication provider. Commit and push the change, then plan the new commit.',
  },
  astro_template_import_unsupported: {
    paths: ["module"],
    template:
      '"{{path}}" uses a dynamic import, import.meta or require in an Astro template. Move server imports into frontmatter and dynamic browser imports into a normal statically imported browser module, then commit and push the change and plan the new commit.',
  },
  astro_config_unsupported: {
    paths: ["framework_config"],
    template:
      '"{{path}}" must use the standard Astro output directories and root base. For edge use output: "server", @astrojs/cloudflare with imageService: "passthrough", and session: false. Static hosting must omit a server adapter. Additional Cloudflare bindings, custom sessions and provider cache are not supported. Commit and push the change, then plan the new commit.',
  },
  managed_auth_database_required: {
    paths: ["repository_config"],
    template: managedCustomerAuthDatabaseMessage("{{path}}"),
  },
  database_binding_private: {
    paths: ["module"],
    template: `"{{path}}" reads a database connection string (DATABASE_URL, HYPERDRIVE, connectionString or a postgres:// URL); none reaches a customer Worker. Call the database with createPrivateDatabaseClient from "@ohmyhost/customer-runtime/database". ${PUSH_AND_PLAN}`,
  },
  database_driver_unsupported: {
    paths: ["module"],
    template: `"{{path}}" imports a database socket driver (pg, postgres, pg-native or mysql2); customer Workers cannot open sockets. Call the database with createPrivateDatabaseClient from "@ohmyhost/customer-runtime/database". ${PUSH_AND_PLAN}`,
  },
  socket_primitive_unsupported: {
    paths: ["module"],
    template: `"{{path}}" loads cloudflare:sockets; customer Workers cannot open sockets. Call HTTPS services through the global fetch function and declare each origin in runtime.egress.allow in ohmyhost.yaml. ${PUSH_AND_PLAN}`,
  },
  source_syntax_invalid: {
    paths: ["module"],
    template:
      'Invalid JavaScript or TypeScript in "{{path}}". Fix the file, commit and push the change, then plan the new commit.',
  },
  worker_module_default_export_required: {
    paths: ["module"],
    template: `Worker module "{{path}}" has no default export. Export default { fetch, scheduled } with the handlers ohmyho.st invokes; named exports are never called. ${PUSH_AND_PLAN}`,
  },
  scheduled_handler_required: {
    paths: ["module"],
    template:
      'functions.crons is declared but "{{path}}" exports no scheduled handler. Add scheduled(controller, env, ctx) to its default export, commit and push the change, then plan the new commit.',
  },
  framework_base_path_unsupported: {
    paths: ["framework_config"],
    template: `"{{path}}" sets a Vite base. ohmyho.st serves the app at the root origin: remove base or set base: "/". ${PUSH_AND_PLAN}`,
  },
  tanstack_prerender_required: {
    paths: ["framework_config"],
    template: `"{{path}}" does not call tanstackStart({ prerender: { enabled: true } }), which the static TanStack Start runtime needs; enable prerender, or set runtime.mode: edge with the Cloudflare Vite plugin. ${PUSH_AND_PLAN}`,
  },
  tanstack_vite_plugins_required: {
    paths: ["framework_config"],
    template: `"{{path}}" does not follow the TanStack Start plugin contract: import tanstackStart from "@tanstack/react-start/plugin/vite"; on runtime edge also import cloudflare from "@cloudflare/vite-plugin" and call cloudflare({ viteEnvironment: { name: "ssr" } }) before tanstackStart(); on runtime static do not import the Cloudflare plugin. ${PUSH_AND_PLAN}`,
  },
  next_tailwind_turbopack_only: {
    paths: ["framework_config"],
    template: `"{{path}}" loads Tailwind CSS through the Turbopack rule "@tailwindcss/turbopack", which the Webpack build on ohmyho.st ignores, and the application root has no PostCSS configuration that Webpack reads, so the site would deploy without its Tailwind classes. Add postcss.config.mjs to the application root with export default { plugins: { "@tailwindcss/postcss": {} } } and remove the Turbopack rule. Use the package manager to add @tailwindcss/postcss to devDependencies at the same version as tailwindcss and to remove @tailwindcss/turbopack, so the lockfile records both. ${PUSH_AND_PLAN}`,
  },
  framework_version_unsupported: {
    paths: ["manifest", "lockfile"],
    fields: {
      package: FRAMEWORK_VERSION_PACKAGES,
      version: DECLARED_VERSION_FIELD,
      minimum: STABLE_VERSION_FIELD,
    },
    derived: { verb: { from: "path", text: { manifest: "declares", lockfile: "resolves" } } },
    template:
      '"{{path}}" {{verb}} {{package}} {{version}}, which ohmyho.st does not admit; use {{package}} {{minimum}} or a later stable release, update package.json and the lockfile, commit and push the change, then plan the new commit.',
  },
  framework_version_declaration_unsupported: {
    paths: ["manifest"],
    fields: { package: FRAMEWORK_VERSION_PACKAGES },
    template:
      '"{{path}}" declares {{package}} in a form ohmyho.st cannot check against its security minimum; declare an exact X.Y.Z version or a ^X.Y.Z or ~X.Y.Z range, update the lockfile, commit and push the change, then plan the new commit.',
  },
  framework_dependency_required: {
    paths: ["manifest"],
    fields: { package: FRAMEWORK_DEPENDENCY_PACKAGES },
    template:
      '"{{path}}" does not declare {{package}} in dependencies, which this framework and runtime need. Add it with the package manager so the lockfile records it, commit and push the change, then plan the new commit.',
  },
  react_version_exact_required: {
    paths: ["manifest"],
    fields: { package: REACT_PACKAGES },
    template:
      '"{{path}}" must declare {{package}} in dependencies at an exact version such as 19.1.0, without ^ or ~, for Next.js. Pin the version the lockfile installs, commit and push the change, then plan the new commit.',
  },
  build_script_unsupported: {
    paths: ["manifest"],
    fields: { framework: BUILD_FRAMEWORKS },
    derived: {
      script: {
        from: "framework",
        text: {
          nextjs:
            'exactly "next build" or "next build --webpack"; ohmyho.st adds the OpenNext build itself',
          "vite-static": VITE_BUILD_SCRIPT,
          "tanstack-start": VITE_BUILD_SCRIPT,
          astro: 'exactly "astro build"',
        },
      },
    },
    template:
      '"{{path}}" scripts.build is missing or not admitted for the {{framework}} adapter: it must be {{script}}. Move other steps into their own scripts, commit and push the change, then plan the new commit.',
  },
  better_auth_version_required: {
    paths: ["manifest"],
    template:
      '"{{path}}" must declare better-auth at exactly 1.7.7 in dependencies because ohmyhost.yaml sets auth.provider: better-auth. Pin that version or set auth.provider: none, commit and push the change, then plan the new commit.',
  },
  package_manifest_invalid: {
    paths: ["manifest"],
    template:
      '"{{path}}" is missing or is not one JSON object. Add package.json in the applicationRoot that ohmyhost.yaml names, or fix its syntax so the whole file parses as one object; commit and push the change, then plan the new commit.',
  },
  framework_unsupported: {
    paths: ["manifest"],
    template: `"{{path}}" declares none of astro, next, vite or @tanstack/react-start. Add the app's framework to dependencies, or set runtime.mode: functions in ohmyhost.yaml and add src/ohmyhost/worker.ts. ${PUSH_AND_PLAN}`,
  },
  framework_ambiguous: {
    paths: ["manifest"],
    template:
      '"{{path}}" declares competing application framework packages, so ohmyho.st cannot choose one framework. Remove the packages of the framework this application does not use, commit and push the change, then plan the new commit.',
  },
  lockfile_missing: {
    paths: ["manifest"],
    template:
      '"{{path}}" has no lockfile beside it. Install with the packageManager it names so package-lock.json, pnpm-lock.yaml, yarn.lock or bun.lock is written, commit and push the change, then plan the new commit.',
  },
  lockfile_ambiguous: {
    paths: ["manifest"],
    template:
      '"{{path}}" has more than one lockfile beside it. Keep only the lockfile of the packageManager it names and delete the others, commit and push the change, then plan the new commit.',
  },
  package_manager_missing: {
    paths: ["manifest"],
    template:
      '"{{path}}" has no packageManager field. Set it to name@X.Y.Z for the npm, pnpm, yarn or bun version that wrote the lockfile, commit and push the change, then plan the new commit.',
  },
  package_manager_invalid: {
    paths: ["manifest"],
    template:
      '"{{path}}" sets packageManager to a value ohmyho.st cannot use. Write npm, pnpm, yarn or bun, then @ and an exact X.Y.Z version without a +sha suffix, matching the lockfile; commit and push the change, then plan the new commit.',
  },
  package_manager_lockfile_mismatch: {
    paths: ["lockfile"],
    template:
      '"{{path}}" was not written by the packageManager that package.json names. Set packageManager to the manager of this lockfile, or replace the lockfile with one from the named manager; commit and push the change, then plan the new commit.',
  },
  package_manager_version_unsupported: {
    paths: ["manifest"],
    template: `"{{path}}" pins a version ohmyho.st cannot build with: Bun other than ${PINNED_BUN_VERSION}, the only Bun ohmyho.st builds with, or Yarn before 3.0.0, the first that runs the frozen install flags. Set packageManager to bun@${PINNED_BUN_VERSION} or to a Yarn version from 3.0.0 on, such as yarn@4.9.4, reinstall to update the lockfile, commit and push the change, then plan the new commit.`,
  },
  repository_configuration_invalid: {
    paths: ["repository_config"],
    template:
      '"{{path}}" does not match the ohmyho.st configuration schema. Run ohmyhost init --dry-run --json locally to see the exact field and fix, commit and push the change, then plan the new commit.',
  },
  runtime_mode_unsupported: {
    paths: ["repository_config"],
    fields: { framework: BUILD_FRAMEWORKS },
    derived: {
      mode: {
        from: "framework",
        text: {
          nextjs: "runtime.mode: edge",
          "vite-static":
            "runtime.mode: edge with src/ohmyhost/companion.ts when database, auth, mail, ai, browser, storage or functions.crons is set, and static otherwise",
          "tanstack-start":
            "runtime.mode: edge, or static without functions.crons, storage, ai and browser",
          astro: "runtime.mode: static for prerendered sites, or edge with the Cloudflare adapter",
        },
      },
    },
    template: `"{{path}}" sets a runtime.mode that the {{framework}} adapter cannot run with this configuration; use {{mode}}. ${PUSH_AND_PLAN}`,
  },
  build_output_unsupported: {
    paths: ["repository_config"],
    fields: { framework: BUILD_FRAMEWORKS },
    derived: {
      output: {
        from: "framework",
        text: {
          nextjs: ".open-next/assets",
          "vite-static": "dist",
          "tanstack-start": "dist/client",
          astro: "dist for static, or dist/client for edge",
        },
      },
    },
    template: `"{{path}}" sets a build.output that the {{framework}} adapter does not produce; set build.output: {{output}}. ${PUSH_AND_PLAN}`,
  },
  build_command_mismatch: {
    paths: ["repository_config"],
    template:
      '"{{path}}" build.install or build.command differs from the commands of the packageManager in package.json (for npm: npm ci --ignore-scripts and npm run build). ohmyhost init --dry-run --json prints the exact values; set them, commit and push the change, then plan the new commit.',
  },
  build_option_unsupported: {
    paths: ["repository_config"],
    template:
      '"{{path}}" sets a build option this runtime ignores: build.ssg_cache_max_mib and build.next_revalidate_path apply only to Next.js, and runtime.mode: functions takes only build.install. Remove the option, commit and push the change, then plan the new commit.',
  },
  application_root_missing: {
    paths: ["repository_config"],
    template:
      '"{{path}}" sets applicationRoot to a directory that is missing or empty in this commit. Set it to the directory that holds the app\'s package.json, or "." for the repository root; commit and push the change, then plan the new commit.',
  },
  framework_config_required: {
    paths: ["framework_config"],
    template:
      'This application has no "{{path}}". Add one framework config with that name and a .js, .mjs or .ts extension that exports its config as default, commit and push the change, then plan the new commit.',
  },
  framework_config_ambiguous: {
    paths: ["framework_config"],
    template:
      '"{{path}}" exists beside another variant with the same name and a .js, .mjs or .ts extension. Keep exactly one and delete the others, commit and push the change, then plan the new commit.',
  },
  framework_config_too_large: {
    paths: ["framework_config"],
    template:
      '"{{path}}" is larger than the 256 KiB ohmyho.st inspects. Keep the config small and move large data into imported modules, commit and push the change, then plan the new commit.',
  },
  framework_config_default_export_required: {
    paths: ["framework_config"],
    template:
      '"{{path}}" does not export its config as default. Use export default (next.config.js may assign module.exports instead), commit and push the change, then plan the new commit.',
  },
  next_output_unsupported: {
    paths: ["framework_config"],
    template:
      '"{{path}}" sets output: "export" or output: "standalone", which the Next.js edge runtime on ohmyho.st cannot serve. Remove the output setting, commit and push the change, then plan the new commit.',
  },
  next_base_path_unsupported: {
    paths: ["framework_config"],
    template: `"{{path}}" sets basePath or assetPrefix. ohmyho.st serves the app at the root origin: remove both or set them to "". ${PUSH_AND_PLAN}`,
  },
  companion_entry_required: {
    paths: ["module"],
    template:
      '"{{path}}" is missing. A Vite app with runtime.mode: edge or with database, auth, mail, ai, browser, storage or functions.crons needs this Worker module with export default { fetch }. Add it, or use runtime.mode: static without those settings; commit and push the change, then plan the new commit.',
  },
  worker_module_required: {
    paths: ["module"],
    template:
      '"{{path}}" is missing. runtime.mode: functions and functions.crons on Next.js or TanStack Start need this Worker module; export default { fetch, scheduled } with the handlers ohmyho.st invokes. Add it, commit and push the change, then plan the new commit.',
  },
  worker_module_fetch_handler_required: {
    paths: ["module"],
    template: `Worker module "{{path}}" exports no fetch handler; runtime.mode: functions serves every request and the health check through it. Add a fetch handler that receives request, env and ctx to its default export. ${PUSH_AND_PLAN}`,
  },
} as const satisfies Readonly<Record<string, DetailDefinition>>);

type DetailDefinitions = typeof FRAMEWORK_CONVERSION_DETAILS;
type CatalogDiagnosticCode = keyof DetailDefinitions;
type FieldValue<Grammar> = Grammar extends readonly (infer Value extends string)[] ? Value : string;
type DiagnosticFields<Definition> = Definition extends { readonly fields: infer Fields }
  ? { readonly [Field in keyof Fields]: FieldValue<Fields[Field]> }
  : unknown;

/** A typed refusal: its code, the file it names and the bounded fields its sentence needs. */
type CatalogDiagnostic = {
  [Code in CatalogDiagnosticCode]: Readonly<{ code: Code; path: string }> &
    DiagnosticFields<DetailDefinitions[Code]>;
}[CatalogDiagnosticCode];

export interface ConfigurationFieldIssue {
  readonly path: string;
  readonly expected: string;
}

export const CONFIGURATION_EXPECTATIONS = Object.freeze({
  yaml: "valid YAML",
  encoding: "UTF-8 YAML",
  required: "a required field",
  unknown: "remove this field",
  unique: "unique items",
  healthcheck: "a root-relative path without a query, fragment or dot segments",
  egress: "a public HTTPS origin on the default port",
  browser: "canonical public HTTPS origins (WSS is also allowed for connect)",
  cron: "a five-field UTC cron with an interval of at least five minutes",
});

const SCHEMA_EXPECTATION_KEYWORDS = [
  "type",
  "const",
  "enum",
  "pattern",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
] as const;

export function configurationExpectation(keyword: string, value: unknown): string | undefined {
  switch (keyword) {
    case "type":
      return String(value);
    case "const":
      return JSON.stringify(value);
    case "enum": {
      if (!Array.isArray(value)) return undefined;
      const choices = value.map((choice) => JSON.stringify(choice));
      return choices.length === 2
        ? choices.join(" or ")
        : `${choices.slice(0, -1).join(", ")}, or ${choices.at(-1)}`;
    }
    case "pattern":
      return `text matching ${String(value)}`;
    case "minLength":
      return `at least ${String(value)} character(s)`;
    case "maxLength":
      return `at most ${String(value)} character(s)`;
    case "minItems":
      return `at least ${String(value)} item(s)`;
    case "maxItems":
      return `at most ${String(value)} item(s)`;
    case "minimum":
      return `at least ${String(value)}`;
    case "maximum":
      return `at most ${String(value)}`;
    default:
      return undefined;
  }
}

function configurationExpectations(): ReadonlySet<string> {
  const expected = new Set<string>(Object.values(CONFIGURATION_EXPECTATIONS));
  const schemas: unknown[] = [configSchema];
  while (schemas.length > 0) {
    const node = schemas.pop();
    if (typeof node !== "object" || node === null) continue;
    const record = node as Record<string, unknown>;
    for (const keyword of SCHEMA_EXPECTATION_KEYWORDS) {
      if (!Object.hasOwn(record, keyword)) continue;
      const value = configurationExpectation(keyword, record[keyword]);
      if (value !== undefined) expected.add(value);
    }
    schemas.push(...Object.values(record));
  }
  return expected;
}

const EXPECTED_CONFIGURATION_VALUES = configurationExpectations();
export const CONFIGURATION_FIELD_PATH = /^(?:\$|(?:\/[A-Za-z0-9_-]{1,64})+)(?![\s\S])/u;
export const MAX_CONFIGURATION_FIELD_ISSUES = 200;

export type ConfigurationExample =
  | Readonly<{ framework: "functions"; package_manager: PackageManagerName; runtime: "functions" }>
  | Readonly<{ framework: "nextjs"; package_manager: PackageManagerName; runtime: "edge" }>
  | Readonly<{
      framework: "astro" | "vite-static" | "tanstack-start";
      package_manager: PackageManagerName;
      runtime: "static" | "edge";
    }>;

export type ConfigurationDiagnostic = Readonly<{
  code: "repository_configuration_invalid";
  path: "ohmyhost.yaml";
  fields: readonly ConfigurationFieldIssue[];
  example: ConfigurationExample | null;
}>;

export type SourceSyntaxDiagnostic = Readonly<{
  code: "source_syntax_error";
  path: string;
  line: number;
  column: number;
}>;

export type FrameworkConversionDiagnostic =
  | CatalogDiagnostic
  | ConfigurationDiagnostic
  | SourceSyntaxDiagnostic;

export type FrameworkConversionDiagnosticCode = FrameworkConversionDiagnostic["code"];

export function hasConfigurationFields(
  diagnostic: FrameworkConversionDiagnostic | null,
): diagnostic is ConfigurationDiagnostic {
  return diagnostic?.code === "repository_configuration_invalid" && "fields" in diagnostic;
}

function readConfigurationExample(value: unknown): ConfigurationExample | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { framework, package_manager, runtime } = value as Record<string, unknown>;
  if (
    Object.keys(value).length !== 3 ||
    !["framework", "package_manager", "runtime"].every((key) => Object.hasOwn(value, key)) ||
    typeof package_manager !== "string" ||
    !Object.hasOwn(PACKAGE_MANAGER_CONTRACTS, package_manager)
  )
    return null;
  const manager = package_manager as PackageManagerName;
  if (framework === "functions" && runtime === "functions")
    return Object.freeze({ framework, package_manager: manager, runtime });
  if (framework === "nextjs" && runtime === "edge")
    return Object.freeze({ framework, package_manager: manager, runtime });
  if (
    (framework === "astro" || framework === "vite-static" || framework === "tanstack-start") &&
    (runtime === "static" || runtime === "edge")
  )
    return Object.freeze({ framework, package_manager: manager, runtime });
  return null;
}

function readConfigurationDiagnostic(
  record: Readonly<Record<string, unknown>>,
): ConfigurationDiagnostic | null {
  const { path, fields, example } = record;
  if (
    Object.keys(record).length !== 4 ||
    !Object.hasOwn(record, "example") ||
    path !== "ohmyhost.yaml" ||
    !Array.isArray(fields) ||
    fields.length === 0 ||
    fields.length > MAX_CONFIGURATION_FIELD_ISSUES
  )
    return null;
  const parsedExample = readConfigurationExample(example);
  if (example !== null && parsedExample === null) return null;
  const parsedFields: ConfigurationFieldIssue[] = [];
  for (const field of fields) {
    if (typeof field !== "object" || field === null || Array.isArray(field)) return null;
    const { path, expected } = field as Record<string, unknown>;
    if (
      Object.keys(field).length !== 2 ||
      !Object.hasOwn(field, "path") ||
      !Object.hasOwn(field, "expected") ||
      typeof path !== "string" ||
      path.length > 240 ||
      !CONFIGURATION_FIELD_PATH.test(path) ||
      typeof expected !== "string" ||
      !EXPECTED_CONFIGURATION_VALUES.has(expected)
    )
      return null;
    parsedFields.push(Object.freeze({ path, expected }));
  }
  return Object.freeze({
    code: "repository_configuration_invalid",
    path,
    fields: Object.freeze(parsedFields),
    example: parsedExample,
  });
}

function isSourceCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 9_999_999
  );
}

const DETAIL_DEFINITIONS: Readonly<Record<CatalogDiagnosticCode, DetailDefinition>> =
  FRAMEWORK_CONVERSION_DETAILS;
const PLACEHOLDER = /\{\{([a-z]+)\}\}/gu;
const PATH_PATTERN = "[A-Za-z0-9_@()[\\]./${}-]{1,240}";
const SOURCE_SYNTAX_DETAIL = new RegExp(
  `^"(?<path>${PATH_PATTERN})" does not parse at line (?<line>[1-9][0-9]{0,6}), column (?<column>[1-9][0-9]{0,6})\\.$`,
  "u",
);

const SAFE_PATH = new RegExp(`^${PATH_PATTERN}$`, "u");
const MODULE_PATH = /^[A-Za-z0-9_@()[\]./${}-]+\.(?:astro|[cm]?[jt]sx?)$/u;
const FRAMEWORK_CONFIG_NAME = /^(?:astro|next|open-next|vite)\.config\.(?:js|mjs|ts)$/u;
// The public problem detail bound; every rendered sentence stays far below it.
const MAXIMUM_DETAIL_LENGTH = 2_000;
const DETAIL_PATTERNS = Object.freeze(
  Object.entries(DETAIL_DEFINITIONS).map(([code, definition]) =>
    Object.freeze({
      code: code as CatalogDiagnosticCode,
      pattern: detailPattern(definition),
    }),
  ),
);

function anchoredPattern(source: string): RegExp {
  return new RegExp(`^(?:${source})$`, "u");
}

function escapePattern(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
}

function detailPattern(definition: DetailDefinition): RegExp {
  const placed = new Set<string>();
  let pattern = "^";
  let offset = 0;
  for (const match of definition.template.matchAll(PLACEHOLDER)) {
    const name = match[1] as string;
    pattern += escapePattern(definition.template.slice(offset, match.index));
    pattern += placed.has(name)
      ? `\\k<${name}>`
      : `(?<${name}>${placeholderPattern(definition, name)})`;
    placed.add(name);
    offset = match.index + match[0].length;
  }
  return new RegExp(`${pattern}${escapePattern(definition.template.slice(offset))}$`, "u");
}

function placeholderPattern(definition: DetailDefinition, name: string): string {
  if (name === "path") return PATH_PATTERN;
  const grammar = definition.fields?.[name];
  if (grammar instanceof RegExp) return grammar.source.slice(1, -1);
  const values = grammar ?? Object.values(definition.derived?.[name]?.text ?? {});
  if (values.length === 0) throw new TypeError("Framework conversion detail template is invalid");
  return `(?:${[...new Set(values)].map(escapePattern).join("|")})`;
}

function pathClassOf(
  definition: DetailDefinition,
  path: string,
): FrameworkConversionPathClass | null {
  if (path === "ohmyhost.yaml" && definition.paths.includes("repository_config"))
    return "repository_config";
  if (
    !SAFE_PATH.test(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  )
    return null;
  const leaf = path.slice(path.lastIndexOf("/") + 1);
  return (
    definition.paths.find(
      (pathClass) =>
        (pathClass === "module" && MODULE_PATH.test(path)) ||
        (pathClass === "manifest" && leaf === PACKAGE_MANIFEST) ||
        (pathClass === "lockfile" && ALL_LOCKFILES.includes(leaf)) ||
        (pathClass === "framework_config" && FRAMEWORK_CONFIG_NAME.test(leaf)),
    ) ?? null
  );
}

function fieldMatches(grammar: FieldGrammar, value: unknown): boolean {
  if (typeof value !== "string") return false;
  return grammar instanceof RegExp ? grammar.test(value) : grammar.includes(value);
}

function isCatalogDiagnosticCode(value: unknown): value is CatalogDiagnosticCode {
  return typeof value === "string" && Object.hasOwn(DETAIL_DEFINITIONS, value);
}

/** Accepts exactly a catalog code, a path of that code's classes and its bounded fields. */
export function parseFrameworkConversionDiagnostic(
  value: unknown,
): FrameworkConversionDiagnostic | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, unknown>>;
  const code = Object.hasOwn(record, "code") ? record["code"] : undefined;
  const path = Object.hasOwn(record, "path") ? record["path"] : undefined;
  if (typeof path !== "string") return null;
  if (code === "source_syntax_error") {
    const { line, column } = record;
    return Object.keys(record).length === 4 &&
      Object.hasOwn(record, "line") &&
      Object.hasOwn(record, "column") &&
      pathClassOf({ paths: ["module"], template: "" }, path) !== null &&
      isSourceCoordinate(line) &&
      isSourceCoordinate(column)
      ? Object.freeze({ code, path, line, column })
      : null;
  }
  if (code === "repository_configuration_invalid" && Object.hasOwn(record, "fields"))
    return readConfigurationDiagnostic(record);
  if (!isCatalogDiagnosticCode(code)) return null;
  const definition = DETAIL_DEFINITIONS[code];
  const fields = Object.entries(definition.fields ?? {}).map(
    ([name, grammar]) =>
      [name, grammar, Object.hasOwn(record, name) ? record[name] : undefined] as const,
  );
  if (
    Object.keys(record).length !== fields.length + 2 ||
    pathClassOf(definition, path) === null ||
    fields.some(([, grammar, field]) => !fieldMatches(grammar, field))
  )
    return null;
  return Object.freeze(
    Object.fromEntries([
      ["code", code],
      ["path", path],
      ...fields.map(([name, , field]) => [name, field]),
    ]),
  ) as FrameworkConversionDiagnostic;
}

function requiredDiagnostic(value: unknown): FrameworkConversionDiagnostic {
  const diagnostic = parseFrameworkConversionDiagnostic(value);
  if (diagnostic === null) throw new TypeError("Framework conversion diagnostic is invalid");
  return diagnostic;
}

function renderDetail(diagnostic: FrameworkConversionDiagnostic): string {
  if (diagnostic.code === "source_syntax_error")
    return `"${diagnostic.path}" does not parse at line ${diagnostic.line}, column ${diagnostic.column}.`;
  const definition = DETAIL_DEFINITIONS[diagnostic.code];
  const values: Readonly<Record<string, unknown>> = diagnostic;
  const pathClass = pathClassOf(definition, diagnostic.path);
  return definition.template.replace(PLACEHOLDER, (_placeholder, name: string) => {
    const derived = definition.derived?.[name];
    const value =
      derived === undefined
        ? values[name]
        : derived.text[String(derived.from === "path" ? pathClass : values[derived.from])];
    if (typeof value !== "string")
      throw new TypeError("Framework conversion diagnostic is invalid");
    return value;
  });
}

/**
 * A customer source refusal: its message is the catalog detail of the typed diagnostic, which names
 * the file and its fix. It stays a TypeError, so callers that treat an adapter refusal as a
 * TypeError keep working.
 */
export class FrameworkConversionDiagnosticError extends TypeError {
  public readonly diagnostic: FrameworkConversionDiagnostic;

  public constructor(diagnostic: unknown) {
    const parsed = requiredDiagnostic(diagnostic);
    super(renderDetail(parsed));
    this.name = "FrameworkConversionDiagnosticError";
    this.diagnostic = parsed;
  }
}

export function frameworkConversionDetail(value: unknown): string | null {
  const diagnostic = parseFrameworkConversionDiagnostic(value);
  return diagnostic === null ? null : renderDetail(diagnostic);
}

/** The typed diagnostic whose rendering is exactly this detail, or null for any other text. */
export function frameworkConversionDiagnosticFromDetail(
  value: unknown,
): FrameworkConversionDiagnostic | null {
  if (typeof value !== "string" || value.length > MAXIMUM_DETAIL_LENGTH) return null;
  const syntax = SOURCE_SYNTAX_DETAIL.exec(value)?.groups;
  if (syntax !== undefined) {
    const parsed = parseFrameworkConversionDiagnostic({
      code: "source_syntax_error",
      path: syntax["path"],
      line: Number(syntax["line"]),
      column: Number(syntax["column"]),
    });
    return parsed !== null && renderDetail(parsed) === value ? parsed : null;
  }
  for (const { code, pattern } of DETAIL_PATTERNS) {
    const groups = pattern.exec(value)?.groups;
    if (groups === undefined) continue;
    const diagnostic = parseFrameworkConversionDiagnostic({
      code,
      path: groups["path"],
      ...Object.fromEntries(
        Object.keys(DETAIL_DEFINITIONS[code].fields ?? {}).map((name) => [name, groups[name]]),
      ),
    });
    if (diagnostic !== null && renderDetail(diagnostic) === value) return diagnostic;
  }
  return null;
}

export function parseFrameworkConversionDetail(value: unknown): string | null {
  const diagnostic = frameworkConversionDiagnosticFromDetail(value);
  return diagnostic === null ? null : renderDetail(diagnostic);
}

export function readSourceProblemDiagnostic(
  code: string,
  detail: unknown,
  configuration: unknown,
): FrameworkConversionDiagnostic | null {
  if (code === "framework_conversion_required") {
    const parsed = parseFrameworkConversionDiagnostic(configuration);
    if (hasConfigurationFields(parsed)) return parsed;
    const legacy = frameworkConversionDiagnosticFromDetail(detail);
    return legacy?.code === "source_syntax_error" ? null : legacy;
  }
  if (code === "source_syntax_error") {
    const parsed = frameworkConversionDiagnosticFromDetail(detail);
    return parsed?.code === "source_syntax_error" ? parsed : null;
  }
  return null;
}

/**
 * Places an application-relative diagnostic under its application root for the repository-wide
 * answer; ohmyhost.yaml stays at the repository root. Null when the rooted path is not admitted.
 */
export function rootFrameworkConversionDiagnostic(
  value: unknown,
  applicationRoot: string,
): FrameworkConversionDiagnostic | null {
  const diagnostic = parseFrameworkConversionDiagnostic(value);
  if (
    diagnostic === null ||
    applicationRoot === "." ||
    (diagnostic.code !== "source_syntax_error" &&
      DETAIL_DEFINITIONS[diagnostic.code].paths.includes("repository_config"))
  )
    return diagnostic;
  return parseFrameworkConversionDiagnostic({
    ...diagnostic,
    path: `${applicationRoot}/${diagnostic.path}`,
  });
}
