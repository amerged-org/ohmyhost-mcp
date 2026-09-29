import { PINNED_BUN_VERSION } from "./framework-build-script.mjs";
import { managedCustomerAuthDatabaseMessage } from "./customer-auth-admission.js";
export { managedCustomerAuthAdmissionIssue } from "./customer-auth-admission.js";

export type PackageManagerName = "bun" | "npm" | "pnpm" | "yarn";

export type FrameworkAdmissionReason =
  | "ambiguous_config"
  | "ambiguous_lockfile"
  | "invalid_package_manager"
  | "missing_lockfile"
  | "missing_package_manager"
  | "package_manager_lockfile_mismatch"
  | "package_manager_version_unsupported";

export class FrameworkAdmissionError extends Error {
  public readonly code = "framework_admission_failed";

  public constructor(public readonly reason: FrameworkAdmissionReason) {
    super("Framework source is not admitted");
    this.name = "FrameworkAdmissionError";
  }
}

export interface PackageManagerInput {
  readonly packageManager: string | undefined;
  readonly files: readonly string[];
}

export interface PackageManagerDescriptor {
  readonly manager: PackageManagerName;
  readonly version: string;
  readonly lockfile:
    | "bun.lock"
    | "bun.lockb"
    | "package-lock.json"
    | "pnpm-lock.yaml"
    | "yarn.lock";
  readonly installCommand: string;
  readonly buildCommand: string;
}

interface PackageManagerContract {
  readonly lockfiles: readonly PackageManagerDescriptor["lockfile"][];
  readonly installCommand: string;
  readonly buildCommand: string;
}

const PACKAGE_MANAGER_CONTRACTS: Readonly<Record<PackageManagerName, PackageManagerContract>> =
  Object.freeze({
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

const ALL_LOCKFILES = Object.freeze(
  Object.values(PACKAGE_MANAGER_CONTRACTS).flatMap(({ lockfiles }) => lockfiles),
);
const EXACT_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const PACKAGE_MANAGER_DECLARATION =
  /^(bun|npm|pnpm|yarn)@((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/u;

export function resolvePackageManager(input: PackageManagerInput): PackageManagerDescriptor {
  const presentLockfiles = ALL_LOCKFILES.filter((lockfile) => input.files.includes(lockfile));
  if (presentLockfiles.length === 0) throw new FrameworkAdmissionError("missing_lockfile");
  if (presentLockfiles.length !== 1) throw new FrameworkAdmissionError("ambiguous_lockfile");
  if (input.packageManager === undefined) {
    throw new FrameworkAdmissionError("missing_package_manager");
  }
  const declaration = PACKAGE_MANAGER_DECLARATION.exec(input.packageManager);
  if (declaration === null) throw new FrameworkAdmissionError("invalid_package_manager");
  const manager = declaration[1] as PackageManagerName;
  const version = declaration[2] as string;
  const contract = PACKAGE_MANAGER_CONTRACTS[manager];
  const lockfile = presentLockfiles[0] as PackageManagerDescriptor["lockfile"];
  if (!contract.lockfiles.includes(lockfile)) {
    throw new FrameworkAdmissionError("package_manager_lockfile_mismatch");
  }
  if (manager === "bun" && version !== PINNED_BUN_VERSION) {
    throw new FrameworkAdmissionError("package_manager_version_unsupported");
  }
  return Object.freeze({
    manager,
    version,
    lockfile,
    installCommand: contract.installCommand,
    buildCommand: contract.buildCommand,
  });
}

export function resolveFrameworkConfig(basename: string, files: readonly string[]): string | null {
  const supported = [`${basename}.js`, `${basename}.mjs`, `${basename}.ts`] as const;
  const matches = supported.filter((candidate) => files.includes(candidate));
  if (matches.length > 1) throw new FrameworkAdmissionError("ambiguous_config");
  return matches[0] ?? null;
}

export type AdmittedFramework = "nextjs" | "tanstack-start" | "vite";
export type FrameworkVersionClassification = "experimental" | "unsupported" | "verified";
export type FrameworkVersionReason =
  | "inside_admitted_window"
  | "invalid_version"
  | "outside_admitted_window"
  | "range_inside_admitted_window"
  | "verified_fixture";

export interface FrameworkVersionAdmission {
  readonly classification: FrameworkVersionClassification;
  readonly reason: FrameworkVersionReason;
}

const VERIFIED_VERSIONS: Readonly<Record<AdmittedFramework, ReadonlySet<string>>> = Object.freeze({
  vite: new Set(["5.4.21", "8.0.16", "8.2.2"]),
  "tanstack-start": new Set(["1.168.26", "1.168.49"]),
  nextjs: new Set(["15.5.23", "16.3.2"]),
});

export function classifyFrameworkVersion(
  framework: AdmittedFramework,
  version: string,
): FrameworkVersionAdmission {
  const parsed = parseVersionSpec(version);
  if (parsed === null) return versionAdmission("unsupported", "invalid_version");
  if (!insideAdmittedWindow(framework, parsed.version)) {
    return versionAdmission("unsupported", "outside_admitted_window");
  }
  if (!parsed.exact) {
    return versionAdmission("experimental", "range_inside_admitted_window");
  }
  return VERIFIED_VERSIONS[framework].has(version)
    ? versionAdmission("verified", "verified_fixture")
    : versionAdmission("experimental", "inside_admitted_window");
}

type VersionTuple = readonly [major: number, minor: number, patch: number];

function parseVersionSpec(
  version: string,
): Readonly<{ exact: boolean; version: VersionTuple }> | null {
  const exact = EXACT_VERSION.exec(version);
  const match =
    exact ?? (/^[~^](.*)$/u.exec(version)?.[1] ? EXACT_VERSION.exec(version.slice(1)) : null);
  if (match === null) return null;
  const tuple = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  return tuple.every(Number.isSafeInteger)
    ? Object.freeze({ exact: exact !== null, version: tuple })
    : null;
}

function insideAdmittedWindow(framework: AdmittedFramework, version: VersionTuple): boolean {
  switch (framework) {
    case "vite":
      return compareVersions(version, [5, 4, 0]) >= 0 && compareVersions(version, [8, 2, 2]) <= 0;
    case "tanstack-start":
      return (
        compareVersions(version, [1, 168, 26]) >= 0 && compareVersions(version, [1, 168, 49]) <= 0
      );
    case "nextjs":
      return (
        (version[0] === 15 && version[1] === 5) ||
        (compareVersions(version, [16, 0, 0]) >= 0 && compareVersions(version, [16, 3, 4]) <= 0)
      );
  }
}

function compareVersions(left: VersionTuple, right: VersionTuple): number {
  const majorDifference = left[0] - right[0];
  if (majorDifference !== 0) return majorDifference;
  const minorDifference = left[1] - right[1];
  return minorDifference !== 0 ? minorDifference : left[2] - right[2];
}

function versionAdmission(
  classification: FrameworkVersionClassification,
  reason: FrameworkVersionReason,
): FrameworkVersionAdmission {
  return Object.freeze({ classification, reason });
}

export type FrameworkConversionDiagnosticCode =
  | "managed_auth_database_required"
  | "database_binding_private"
  | "database_driver_unsupported"
  | "source_syntax_invalid"
  | "worker_module_default_export_required"
  | "scheduled_handler_required"
  | "framework_base_path_unsupported"
  | "tanstack_prerender_required"
  | "tanstack_vite_plugins_required"
  | "next_cache_components_unsupported";

export interface FrameworkConversionDiagnostic {
  readonly code: FrameworkConversionDiagnosticCode;
  readonly path: string;
}

const PUSH_AND_PLAN = "Commit and push the change, then plan the new commit.";

// Detail texts are the customer-facing sentence for one diagnostic; parseFrameworkConversionDetail
// recognizes exactly these sentences so a client can map a detail back to its typed diagnostic.
const FRAMEWORK_CONVERSION_DETAILS: Readonly<
  Record<
    FrameworkConversionDiagnosticCode,
    Readonly<{ render(path: string): string; pattern: RegExp }>
  >
> = Object.freeze({
  managed_auth_database_required: Object.freeze({
    render: managedCustomerAuthDatabaseMessage,
    pattern:
      /^"([^"]+)" selects the managed Better Auth bridge, which requires the managed PostgreSQL database\. Set database\.enabled: true with an admitted migrations path, or set auth\.provider: none and keep the application-owned authentication configuration\. Commit and push the change, then plan the new commit\.$/u,
  }),
  database_binding_private: Object.freeze({
    render: (path: string) =>
      `"${path}" reads a database connection string (DATABASE_URL, HYPERDRIVE, connectionString or a postgres:// URL); none reaches a customer Worker. Call the database with createPrivateDatabaseClient from "@ohmyhost/customer-runtime/database". ${PUSH_AND_PLAN}`,
    pattern:
      /^"([^"]+)" reads a database connection string \(DATABASE_URL, HYPERDRIVE, connectionString or a postgres:\/\/ URL\); none reaches a customer Worker\. Call the database with createPrivateDatabaseClient from "@ohmyhost\/customer-runtime\/database"\. Commit and push the change, then plan the new commit\.$/u,
  }),
  database_driver_unsupported: Object.freeze({
    render: (path: string) =>
      `"${path}" imports a database socket driver (pg, postgres, pg-native or mysql2); customer Workers cannot open sockets. Call the database with createPrivateDatabaseClient from "@ohmyhost/customer-runtime/database". ${PUSH_AND_PLAN}`,
    pattern:
      /^"([^"]+)" imports a database socket driver \(pg, postgres, pg-native or mysql2\); customer Workers cannot open sockets\. Call the database with createPrivateDatabaseClient from "@ohmyhost\/customer-runtime\/database"\. Commit and push the change, then plan the new commit\.$/u,
  }),
  source_syntax_invalid: Object.freeze({
    render: (path: string) =>
      `Invalid JavaScript or TypeScript in "${path}". Fix the file, commit and push the change, then plan the new commit.`,
    pattern:
      /^Invalid JavaScript or TypeScript in "([^"]+)"\. Fix the file, commit and push the change, then plan the new commit\.$/u,
  }),
  worker_module_default_export_required: Object.freeze({
    render: (path: string) =>
      `Worker module "${path}" has no default export. Export default { fetch, scheduled } with the handlers ohmyho.st invokes; named exports are never called. ${PUSH_AND_PLAN}`,
    pattern:
      /^Worker module "([^"]+)" has no default export\. Export default \{ fetch, scheduled \} with the handlers ohmyho\.st invokes; named exports are never called\. Commit and push the change, then plan the new commit\.$/u,
  }),
  scheduled_handler_required: Object.freeze({
    render: (path: string) =>
      `functions.crons is declared but "${path}" exports no scheduled handler. Add scheduled(controller, env, ctx) to its default export, commit and push the change, then plan the new commit.`,
    pattern:
      /^functions\.crons is declared but "([^"]+)" exports no scheduled handler\. Add scheduled\(controller, env, ctx\) to its default export, commit and push the change, then plan the new commit\.$/u,
  }),
  framework_base_path_unsupported: Object.freeze({
    render: (path: string) =>
      `"${path}" sets a Vite base. ohmyho.st serves the app at the root origin: remove base or set base: "/". ${PUSH_AND_PLAN}`,
    pattern:
      /^"([^"]+)" sets a Vite base\. ohmyho\.st serves the app at the root origin: remove base or set base: "\/"\. Commit and push the change, then plan the new commit\.$/u,
  }),
  tanstack_prerender_required: Object.freeze({
    render: (path: string) =>
      `"${path}" does not call tanstackStart({ prerender: { enabled: true } }), which the static TanStack Start runtime needs; enable prerender, or set runtime.mode: edge with the Cloudflare Vite plugin. ${PUSH_AND_PLAN}`,
    pattern:
      /^"([^"]+)" does not call tanstackStart\(\{ prerender: \{ enabled: true \} \}\), which the static TanStack Start runtime needs; enable prerender, or set runtime\.mode: edge with the Cloudflare Vite plugin\. Commit and push the change, then plan the new commit\.$/u,
  }),
  tanstack_vite_plugins_required: Object.freeze({
    render: (path: string) =>
      `"${path}" does not follow the TanStack Start plugin contract: import tanstackStart from "@tanstack/react-start/plugin/vite"; on runtime edge also import cloudflare from "@cloudflare/vite-plugin" and call cloudflare({ viteEnvironment: { name: "ssr" } }) before tanstackStart(); on runtime static do not import the Cloudflare plugin. ${PUSH_AND_PLAN}`,
    pattern:
      /^"([^"]+)" does not follow the TanStack Start plugin contract: import tanstackStart from "@tanstack\/react-start\/plugin\/vite"; on runtime edge also import cloudflare from "@cloudflare\/vite-plugin" and call cloudflare\(\{ viteEnvironment: \{ name: "ssr" \} \}\) before tanstackStart\(\); on runtime static do not import the Cloudflare plugin\. Commit and push the change, then plan the new commit\.$/u,
  }),
  next_cache_components_unsupported: Object.freeze({
    render: (path: string) =>
      `"${path}" sets cacheComponents: true, which ohmyho.st does not support; remove it or set it to false. ${PUSH_AND_PLAN}`,
    pattern:
      /^"([^"]+)" sets cacheComponents: true, which ohmyho\.st does not support; remove it or set it to false\. Commit and push the change, then plan the new commit\.$/u,
  }),
});

/**
 * An adapter rule that `init` does not check. It stays a TypeError, so every existing caller that
 * treats an adapter refusal as a TypeError keeps working, and carries the typed diagnostic whose
 * detail names the file and its fix.
 */
export class FrameworkConversionDiagnosticError extends TypeError {
  public readonly diagnostic: FrameworkConversionDiagnostic;

  public constructor(diagnostic: unknown) {
    const parsed = parseFrameworkConversionDiagnostic(diagnostic);
    if (parsed === null) throw new TypeError("Framework conversion diagnostic is invalid");
    super(FRAMEWORK_CONVERSION_DETAILS[parsed.code].render(parsed.path));
    this.name = "FrameworkConversionDiagnosticError";
    this.diagnostic = parsed;
  }
}

function isFrameworkConversionDiagnosticCode(
  value: unknown,
): value is FrameworkConversionDiagnosticCode {
  return typeof value === "string" && Object.hasOwn(FRAMEWORK_CONVERSION_DETAILS, value);
}

export function parseFrameworkConversionDiagnostic(
  value: unknown,
): FrameworkConversionDiagnostic | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const path = record["path"];
  const code = record["code"];
  if (
    Object.keys(record).length !== 2 ||
    !isFrameworkConversionDiagnosticCode(code) ||
    typeof path !== "string" ||
    path.length > 240 ||
    (code === "managed_auth_database_required"
      ? path !== "ohmyhost.yaml"
      : !/^[A-Za-z0-9_@()[\]./-]+\.(?:[cm]?[jt]sx?)$/u.test(path)) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  )
    return null;
  return Object.freeze({ code, path });
}

export function frameworkConversionDetail(value: unknown): string | null {
  const diagnostic = parseFrameworkConversionDiagnostic(value);
  return diagnostic === null
    ? null
    : FRAMEWORK_CONVERSION_DETAILS[diagnostic.code].render(diagnostic.path);
}

export function parseFrameworkConversionDetail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  for (const [code, detail] of Object.entries(FRAMEWORK_CONVERSION_DETAILS)) {
    const match = detail.pattern.exec(value);
    if (match !== null) return frameworkConversionDetail({ code, path: match[1] });
  }
  return null;
}
