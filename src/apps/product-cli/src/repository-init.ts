import { createHash } from "node:crypto";
import { lstat, open, readFile, readdir, stat } from "node:fs/promises";
import { dirname, posix, resolve } from "node:path";

import {
  normalizeApplicationRoot,
  type ApplicationRoot,
} from "@ohmyhost/contracts/application-root";
import { parseOhmyhostConfigYaml, type OhmyhostConfig } from "@ohmyhost/contracts";
import {
  isAdmittedFrameworkBuildScript,
  PINNED_BUN_VERSION,
} from "@ohmyhost/contracts/framework-build-script";
import {
  classifyFrameworkVersion,
  FrameworkAdmissionError,
  managedCustomerAuthAdmissionIssue,
  resolveFrameworkConfig,
  resolvePackageManager,
  type AdmittedFramework,
  type FrameworkVersionAdmission,
  type FrameworkVersionClassification,
  type PackageManagerDescriptor,
} from "@ohmyhost/contracts/framework-admission";
import {
  classifyFrameworkFamily,
  type FrameworkFamilyClassification,
} from "@ohmyhost/contracts/framework-family";
import {
  admitExpandOnlyMigrations,
  DatabaseMigrationAdmissionError,
  type DatabaseMigrationAdmissionReason,
} from "@ohmyhost/contracts/database-migration-admission";

import cliPackage from "../package.json" with { type: "json" };

const MAXIMUM_PACKAGE_BYTES = 1024 * 1024;
const MAXIMUM_CONFIGURATION_BYTES = 64 * 1024;
const MAXIMUM_REPOSITORY_FILES = 20_000;
const SUPPORTED_BETTER_AUTH_VERSION = "1.7.1";
const PROJECT_PATTERN = /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/u;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".supabase",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "node_modules",
]);

export type RepositoryFramework = Exclude<FrameworkFamilyClassification, "ambiguous"> | "functions";
const WORKER_MODULE_PATH = "src/ohmyhost/worker.ts";
const MAXIMUM_SOURCE_BYTES = 2 * 1024 * 1024;
const SOURCE_MODULE_PATTERN = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const STORAGE_CLIENT_CALL_PATTERN = /\bcreatePrivateStorageClient\s*\(/u;
// Both database mistakes of 2026-09-18 are visible in the source before anything is built: one read
// a retired database binding, the other opened a socket driver. Neither can work in a customer Worker, so
// naming them here costs a customer minutes instead of a deployment that fails its health check.
const DATABASE_PRIVATE_BINDING_PATTERN =
  /\bHYPERDRIVE\b|\bconnectionString\b|\bDATABASE_URL\b|postgres(?:ql)?:\/\//u;
const DATABASE_SOCKET_DRIVER_PATTERN =
  /\bfrom\s*["'](?:pg|postgres|mysql2|pg-native)["']|\brequire\(\s*["'](?:pg|postgres|pg-native)["']/u;
// A comment and a type-only import name the client without ever constructing it, and the bare
// identifier of either reads like client code; drop them before looking for the call itself.
const INERT_SOURCE_PATTERN = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|\bimport\s+type\b[^;]*;/gu;

function callsStorageClient(source: string): boolean {
  return STORAGE_CLIENT_CALL_PATTERN.test(source.replaceAll(INERT_SOURCE_PATTERN, " "));
}

// Storage is reached through a private Service Binding plus the three values and the key that
// `createPrivateStorageClient` reads. No raw bucket binding is handed to customer code.
const STORAGE_RUNTIME_BINDINGS = Object.freeze([
  "OHMYHOST_ENVIRONMENT_ID",
  "OHMYHOST_PROJECT_ID",
  "OHMYHOST_STORAGE_GATEWAY",
  "OHMYHOST_STORAGE_GATEWAY_URL",
  "OHMYHOST_STORAGE_KEY",
]);
// The runtime release is published unchanged as `@amerged/ohmyhost-runtime`; this pinned alias keeps
// its import name and, unlike the website archive each release removes, stays installable.
const CUSTOMER_RUNTIME_SOURCE = `npm:@amerged/ohmyhost-runtime@${cliPackage.version}`;
const SCHEDULED_HANDLER_PATTERN = /\bscheduled\s*(?:\(|:|,|\})/u;
// The platform imports the module's default export; handlers that are only named exports are
// never invoked, so init blocks them before a build or a runtime rejection would.
const DEFAULT_EXPORT_PATTERN = /\bexport\s+default\b/u;

function defaultExportBlocker(modulePath: string): RepositoryInitBlocker {
  return {
    code: "worker_module_default_export_required",
    message: `${modulePath} has no default export. Export its handlers as the default export (export default { fetch, scheduled }); named exports are never invoked.`,
  };
}
type TanStackRuntimeAnalysis = "ambiguous" | "edge" | "static" | null;

export interface RepositoryInitBlocker {
  readonly code:
    | "build_command_unsupported"
    | "database_binding_private"
    | "database_driver_unsupported"
    | "build_script_missing"
    | "better_auth_version_unsupported"
    | "managed_auth_database_required"
    | "framework_ambiguous"
    | "framework_unsupported"
    | "framework_version_unsupported"
    | "migration_filename_noncanonical"
    | "migration_sql_not_admitted"
    | "next_adapter_unconfigured"
    | "package_manager_ambiguous"
    | "package_manager_unpinned"
    | "scheduled_functions_runtime_unsupported"
    | "scheduled_handler_missing"
    | "storage_client_missing"
    | "worker_module_default_export_required"
    | "worker_module_missing"
    | "workers_runtime_incompatible";
  readonly message: string;
}

export interface RepositoryInitInventory {
  readonly framework: RepositoryFramework;
  readonly packageManager: Readonly<{
    name: "bun" | "npm" | "pnpm" | "unknown" | "yarn";
    version: string | null;
    lockfile: string | null;
  }>;
  readonly apiRouteCount: number;
  readonly database: Readonly<{
    provider: "none" | "postgresql" | "supabase";
    migrationCount: number;
  }>;
  readonly auth: Readonly<{
    betterAuth: boolean;
    workos: boolean;
    auth0: boolean;
    supabase: boolean;
  }>;
  readonly edgeFunctions: Readonly<{ count: number }>;
  readonly storage: Readonly<{ r2: boolean; supabase: boolean }>;
  readonly mail: Readonly<{ detected: boolean }>;
  readonly functions: Readonly<{ crons: readonly string[] }>;
}

export interface RepositoryInitRuntimePackages {
  readonly betterAuth?: "1.7.1";
  /** Exact install source: an npm alias pinned to the published runtime of this client version. */
  readonly customerRuntime?: string;
}

export interface RepositoryInitViteCompanion {
  readonly schemaVersion: "ohmyhost.vite-api-companion/v1";
  readonly sourceEntryPoint: "src/ohmyhost/companion.ts";
  readonly requiredFiles: readonly ["src/ohmyhost/companion.ts"];
  readonly missingFiles: readonly string[];
  readonly packages: RepositoryInitRuntimePackages;
  readonly bindings: readonly string[];
  readonly artifact: Readonly<{
    readonly outputDirectory: ".ohmyhost/vite-companion";
    readonly entryPoint: ".ohmyhost/vite-companion/worker.js";
    readonly configPath: ".ohmyhost/vite-companion/wrangler.jsonc";
  }>;
}

export interface RepositoryInitResult {
  readonly status: "analyzed" | "initialized";
  readonly written: boolean;
  readonly configurationPath: "ohmyhost.yaml";
  readonly configurationSha256: string;
  readonly configurationYaml: string;
  readonly applicationRoot: ApplicationRoot;
  readonly applicationRootSource: "explicit" | "nested" | "repository";
  readonly inventory: RepositoryInitInventory;
  readonly compatibility: Readonly<{
    classification: FrameworkVersionClassification;
    frameworks: readonly Readonly<{
      framework: AdmittedFramework;
      version: string;
      classification: FrameworkVersionAdmission["classification"];
      reason: FrameworkVersionAdmission["reason"];
    }>[];
  }>;
  readonly blockers: readonly RepositoryInitBlocker[];
  readonly requirements: readonly string[];
  readonly companion: RepositoryInitViteCompanion | null;
  readonly worker: Readonly<{
    sourceEntryPoint: "src/ohmyhost/worker.ts";
    present: boolean;
    bindings: readonly string[];
    packages: RepositoryInitRuntimePackages;
  }> | null;
  /** What server code of any framework installs and reads once a capability is enabled. */
  readonly runtime: Readonly<{
    bindings: readonly string[];
    packages: RepositoryInitRuntimePackages;
  }> | null;
}

export class RepositoryInitError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryInitError";
  }
}

export class RepositoryInitBlockedError extends RepositoryInitError {
  public constructor(public readonly blockers: readonly RepositoryInitBlocker[]) {
    super("repository_init_blocked", "Repository initialization is blocked");
    this.name = "RepositoryInitBlockedError";
  }
}

export class RepositoryInitConflictError extends RepositoryInitError {
  public constructor() {
    super("repository_configuration_exists", "ohmyhost.yaml already exists");
    this.name = "RepositoryInitConflictError";
  }
}

export interface InitializeRepositoryInput {
  readonly directory: string;
  readonly project?: string;
  readonly root?: string;
  /**
   * The hosting region of the ohmyho.st project; storage.jurisdiction must equal it. Init runs
   * offline and cannot resolve the project itself, so the default is the platform default `us`.
   */
  readonly region?: "us" | "eu";
  readonly dryRun: boolean;
}

export async function initializeRepository(
  input: InitializeRepositoryInput,
): Promise<RepositoryInitResult> {
  const root = resolve(input.directory);
  await assertRepositoryRoot(root);
  const files = await collectRepositoryFiles(root);
  const selection = await selectApplicationRoot(root, files, input.root);
  const applicationDirectory = resolve(root, selection.applicationRoot);
  const applicationFiles = applicationRelativeFiles(files, selection.applicationRoot);
  const packageJson = await readPackageJson(applicationDirectory);
  const dependencies = dependencyNames(packageJson);
  const existingConfigurationYaml = await readExistingConfiguration(
    root,
    files,
    selection.applicationRoot,
  );
  const existingConfiguration =
    existingConfigurationYaml === null ? null : parseOhmyhostConfigYaml(existingConfigurationYaml);
  const framework = detectRepositoryFramework(
    dependencies,
    applicationFiles,
    existingConfiguration,
  );
  const packageManagerAdmission = packageManagerAdmissionFor(packageJson, applicationFiles);
  const packageManager = packageManagerInventory(
    packageManagerAdmission,
    packageJson,
    applicationFiles,
  );
  const frameworkConfigs = frameworkConfigurations(applicationFiles);
  const compatibility = frameworkCompatibility(packageJson, framework);
  const nextStandaloneOutput = await detectNextStandaloneOutput(
    applicationDirectory,
    framework,
    frameworkConfigs.next,
  );
  const tanStackRuntime = await detectTanStackRuntime(
    applicationDirectory,
    applicationFiles,
    framework,
    packageJson,
    frameworkConfigs.vite,
  );
  const project = projectName(input.project, packageJson);
  const repositoryAdmissionBlockers = repositoryBlockers(
    packageJson,
    framework,
    nextStandaloneOutput,
    tanStackRuntime,
    applicationFiles,
    packageManagerAdmission,
    frameworkConfigs,
    compatibility,
    existingConfiguration,
  );
  const supabaseMigrationCount = applicationFiles.filter((path) =>
    /^supabase\/migrations\/[^/]+\.sql$/u.test(path),
  ).length;
  const postgresMigrationRoot =
    existingConfiguration?.database?.migrations ?? "postgres/migrations";
  const postgresMigrationCount = applicationFiles.filter(
    (path) => path.startsWith(`${postgresMigrationRoot}/`) && path.endsWith(".sql"),
  ).length;
  const edgeFunctionNames = new Set(
    applicationFiles.flatMap((path) => {
      const match = path.match(/^supabase\/functions\/([^/]+)\//u);
      return match?.[1] === undefined || match[1].startsWith("_") ? [] : [match[1]];
    }),
  );
  const apiRouteCount = applicationFiles.filter((path) =>
    /^(?:src\/)?app\/api\/.+\/route\.(?:js|jsx|ts|tsx)$/u.test(path),
  ).length;
  const supabase = dependencies.has("@supabase/supabase-js") || dependencies.has("@supabase/ssr");
  const configuredDatabase = existingConfiguration?.database?.enabled === true;
  const databaseProvider =
    supabaseMigrationCount > 0
      ? "supabase"
      : postgresMigrationCount > 0 || configuredDatabase
        ? "postgresql"
        : "none";
  const migrationCount =
    databaseProvider === "supabase" ? supabaseMigrationCount : postgresMigrationCount;
  // Inventory remains evidence; an existing configuration selects the managed capabilities.
  const selectedDatabaseProvider =
    existingConfiguration === null ? databaseProvider : configuredDatabase ? "postgresql" : "none";
  const betterAuth =
    dependencies.has("better-auth") || existingConfiguration?.auth?.provider === "better-auth";
  const workos = [
    "@workos-inc/authkit-react",
    "@workos-inc/authkit-nextjs",
    "@workos/authkit-tanstack-react-start",
    "@workos-inc/node",
  ].some((name) => dependencies.has(name));
  const auth0 = ["@auth0/auth0-react", "@auth0/auth0-spa-js", "@auth0/nextjs-auth0", "auth0"].some(
    (name) => dependencies.has(name),
  );
  const mailDetected = [
    "@aws-sdk/client-sesv2",
    "@lovable.dev/email-js",
    "nodemailer",
    "resend",
  ].some((name) => dependencies.has(name));
  const r2 =
    existingConfiguration?.storage?.provider === "r2" ||
    (await detectR2Storage(applicationDirectory, applicationFiles));
  const supabaseStorage = applicationFiles.some((path) => path.startsWith("supabase/storage/"));
  const inventory: RepositoryInitInventory = Object.freeze({
    framework,
    packageManager: Object.freeze(packageManager),
    apiRouteCount,
    database: Object.freeze({ provider: databaseProvider, migrationCount }),
    auth: Object.freeze({ betterAuth, workos, auth0, supabase }),
    edgeFunctions: Object.freeze({ count: edgeFunctionNames.size }),
    storage: Object.freeze({ r2, supabase: supabaseStorage }),
    mail: Object.freeze({
      detected: mailDetected || existingConfiguration?.mail?.enabled === true,
    }),
    functions: Object.freeze({
      crons: Object.freeze([...(existingConfiguration?.functions?.crons ?? [])]),
    }),
  });
  const targetBetterAuth = existingConfiguration?.auth?.provider === "better-auth";
  // Mail stays an explicit choice: Better Auth or a detected mail package never enables it.
  const targetMail = existingConfiguration?.mail?.enabled === true;
  const targetStorage = r2 || supabaseStorage;
  const configuredCompanionRequired =
    existingConfiguration !== null &&
    (existingConfiguration.database?.enabled === true ||
      existingConfiguration.auth?.provider === "better-auth" ||
      existingConfiguration.mail?.enabled === true ||
      existingConfiguration.storage !== undefined ||
      (existingConfiguration.functions?.crons.length ?? 0) > 0);
  const companionRequired =
    framework === "vite" &&
    (existingConfiguration === null
      ? databaseProvider !== "none" ||
        targetBetterAuth ||
        targetMail ||
        targetStorage ||
        edgeFunctionNames.size > 0 ||
        applicationFiles.includes("src/ohmyhost/companion.ts")
      : configuredCompanionRequired);
  const generatedConfigurationYaml = renderConfiguration({
    project,
    framework,
    packageManager,
    databaseProvider,
    hasHealthcheck:
      applicationFiles.includes("src/app/api/health/route.ts") ||
      applicationFiles.includes("app/api/health/route.ts"),
    mailEnabled: targetMail,
    betterAuthEnabled: targetBetterAuth,
    storageEnabled: targetStorage,
    storageJurisdiction: input.region ?? "us",
    viteCompanionRequired: companionRequired,
    tanStackRuntime,
    applicationRoot: selection.applicationRoot,
  });
  const configurationYaml = existingConfigurationYaml ?? generatedConfigurationYaml;
  const capabilities: RuntimeCapabilities = Object.freeze({
    database: selectedDatabaseProvider !== "none",
    auth: targetBetterAuth,
    mail: targetMail,
    storage: targetStorage,
  });
  const companion = companionRequired
    ? viteCompanionScaffold(applicationFiles, capabilities)
    : null;
  const companionSourcePresent =
    companion !== null && applicationFiles.includes(companion.sourceEntryPoint);
  const migrationSqlAdmissionBlockers = await migrationSqlBlockers(
    applicationDirectory,
    applicationFiles,
    existingConfiguration?.database?.migrations,
    selectedDatabaseProvider,
  );
  const blockers = [
    ...repositoryAdmissionBlockers,
    ...(await workerModuleBlockers(framework, applicationDirectory, applicationFiles)),
    ...(await cronBlockers(
      framework,
      existingConfiguration,
      applicationDirectory,
      applicationFiles,
    )),
    ...(selectedDatabaseProvider === "none"
      ? []
      : migrationFilenameBlockers(
          applicationFiles,
          existingConfiguration?.database?.migrations,
          selectedDatabaseProvider,
        )),
    ...migrationSqlAdmissionBlockers,
    ...(await storageClientBlockers(existingConfiguration, applicationDirectory, applicationFiles)),
    ...(await databaseContractBlockers(
      existingConfiguration,
      applicationDirectory,
      applicationFiles,
    )),
  ].sort((left, right) => left.code.localeCompare(right.code));
  const requirements = requirementsFor(
    inventory,
    companion !== null && !companionSourcePresent,
    mailDetected,
    targetBetterAuth,
  );
  const configurationSha256 = createHash("sha256").update(configurationYaml).digest("hex");
  if (!input.dryRun) {
    if (blockers.length > 0) throw new RepositoryInitBlockedError(blockers);
    await createConfiguration(root, configurationYaml);
  }
  return Object.freeze({
    status: input.dryRun ? "analyzed" : "initialized",
    written: !input.dryRun,
    configurationPath: "ohmyhost.yaml",
    configurationSha256,
    configurationYaml,
    applicationRoot: selection.applicationRoot,
    applicationRootSource: selection.source,
    inventory,
    compatibility,
    blockers: Object.freeze(blockers),
    requirements: Object.freeze(requirements),
    companion,
    worker:
      framework === "functions"
        ? Object.freeze({
            sourceEntryPoint: WORKER_MODULE_PATH,
            present: applicationFiles.includes(WORKER_MODULE_PATH),
            ...runtimeContract(capabilities),
          })
        : null,
    // Next.js and TanStack Start have neither a companion nor a Worker module, and read it here.
    runtime: Object.values(capabilities).some(Boolean) ? runtimeContract(capabilities) : null,
  });
}

/** The functions runtime is selected by configuration, or by a Worker module without a framework. */
function detectRepositoryFramework(
  dependencies: ReadonlySet<string>,
  files: readonly string[],
  existingConfiguration: OhmyhostConfig | null,
): RepositoryFramework {
  const detected = detectFramework(dependencies);
  if (existingConfiguration?.runtime.mode === "functions") return "functions";
  if (detected === "unknown" && files.includes(WORKER_MODULE_PATH)) return "functions";
  return detected;
}

/** Declared crons need an edge or functions runtime and a scheduled handler in the Worker module. */
async function cronBlockers(
  framework: RepositoryFramework,
  config: OhmyhostConfig | null,
  applicationDirectory: string,
  files: readonly string[],
): Promise<RepositoryInitBlocker[]> {
  if ((config?.functions?.crons.length ?? 0) === 0) return [];
  const mode = config?.runtime.mode;
  const runtimeSupported =
    (mode === "edge" &&
      (framework === "vite" || framework === "nextjs" || framework === "tanstack-start")) ||
    (mode === "functions" && framework === "functions");
  if (!runtimeSupported) {
    return [
      {
        code: "scheduled_functions_runtime_unsupported",
        message:
          "functions.crons needs runtime.mode edge (Next.js, TanStack Start, or Vite with src/ohmyhost/companion.ts) or functions (src/ohmyhost/worker.ts) in ohmyhost.yaml. Change runtime.mode, or remove functions.crons.",
      },
    ];
  }
  const modulePath = framework === "vite" ? "src/ohmyhost/companion.ts" : WORKER_MODULE_PATH;
  const source = files.includes(modulePath)
    ? await readFile(resolve(applicationDirectory, modulePath), "utf8")
    : null;
  // The functions runtime reports a missing default export through workerModuleBlockers.
  if (framework !== "functions" && source !== null && !DEFAULT_EXPORT_PATTERN.test(source)) {
    return [defaultExportBlocker(modulePath)];
  }
  if (source === null || !SCHEDULED_HANDLER_PATTERN.test(source)) {
    return [
      {
        code: "scheduled_handler_missing",
        message: `Keep a scheduled handler in the default export of ${modulePath} to run the declared crons.`,
      },
    ];
  }
  return [];
}

/**
 * Declared storage is reached only through the private gateway client. A storage-enabled app whose
 * source never constructs that client deploys green and fails at its first upload, so name it here.
 */
async function storageClientBlockers(
  config: OhmyhostConfig | null,
  applicationDirectory: string,
  files: readonly string[],
): Promise<RepositoryInitBlocker[]> {
  if (config?.storage === undefined) return [];
  for (const path of files) {
    if (!SOURCE_MODULE_PATTERN.test(path)) continue;
    const absolute = resolve(applicationDirectory, path);
    const information = await stat(absolute);
    if (!information.isFile() || information.size > MAXIMUM_SOURCE_BYTES) continue;
    if (callsStorageClient(await readFile(absolute, "utf8"))) return [];
  }
  return [
    {
      code: "storage_client_missing",
      message:
        'ohmyhost.yaml declares storage, but no application source calls createPrivateStorageClient. Import it from "@ohmyhost/customer-runtime/storage" and build it in server code from OHMYHOST_STORAGE_GATEWAY, OHMYHOST_STORAGE_GATEWAY_URL, OHMYHOST_PROJECT_ID, OHMYHOST_ENVIRONMENT_ID and OHMYHOST_STORAGE_KEY, then reserve an upload, PUT the bytes to the returned signed URL, complete it, and serve reads with createSignedRead. There is no FILES bucket binding.',
    },
  ];
}

/**
 * A managed database is reached only through `createPrivateDatabaseClient`. A customer Worker gets
 * no connection string and cannot open a socket, so source that reaches for either builds green,
 * deploys, and fails its health check with nothing to explain it.
 */
async function databaseContractBlockers(
  config: OhmyhostConfig | null,
  applicationDirectory: string,
  files: readonly string[],
): Promise<RepositoryInitBlocker[]> {
  if (config?.database === undefined) return [];
  const blockers: RepositoryInitBlocker[] = [];
  for (const path of files) {
    if (!SOURCE_MODULE_PATTERN.test(path)) continue;
    const absolute = resolve(applicationDirectory, path);
    const information = await stat(absolute);
    if (!information.isFile() || information.size > MAXIMUM_SOURCE_BYTES) continue;
    const source = (await readFile(absolute, "utf8")).replaceAll(INERT_SOURCE_PATTERN, " ");
    if (DATABASE_PRIVATE_BINDING_PATTERN.test(source)) {
      blockers.push({
        code: "database_binding_private",
        message: `${path} reaches for a managed database connection string. HYPERDRIVE is retired; DATABASE_URL and postgres:// URLs never reach a customer Worker. Call the database with createPrivateDatabaseClient from "@ohmyhost/customer-runtime/database".`,
      });
    }
    if (DATABASE_SOCKET_DRIVER_PATTERN.test(source)) {
      blockers.push({
        code: "database_driver_unsupported",
        message: `${path} imports a PostgreSQL socket driver. Outbound connect() is disabled for customer Workers, so the driver can never open a connection. Call the database with createPrivateDatabaseClient from "@ohmyhost/customer-runtime/database".`,
      });
    }
  }
  return blockers;
}

/** The functions runtime is the customer's module alone; it must export its handlers by default. */
async function workerModuleBlockers(
  framework: RepositoryFramework,
  applicationDirectory: string,
  files: readonly string[],
): Promise<RepositoryInitBlocker[]> {
  if (framework !== "functions" || !files.includes(WORKER_MODULE_PATH)) return [];
  const source = await readFile(resolve(applicationDirectory, WORKER_MODULE_PATH), "utf8");
  return DEFAULT_EXPORT_PATTERN.test(source) ? [] : [defaultExportBlocker(WORKER_MODULE_PATH)];
}

function migrationFilenameBlockers(
  files: readonly string[],
  configuredPath: string | undefined,
  provider: RepositoryInitInventory["database"]["provider"],
): RepositoryInitBlocker[] {
  if (provider !== "postgresql") return [];
  const root = configuredPath ?? "postgres/migrations";
  const prefix = `${root}/`;
  const invalid = files
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length))
    .find(
      (path) => !/^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*\d{14}_[a-z0-9][a-z0-9_-]*\.sql$/u.test(path),
    );
  return invalid === undefined
    ? []
    : [
        {
          code: "migration_filename_noncanonical",
          message: `Migration file '${invalid}' in ${root} is not named YYYYMMDDHHMMSS_name.sql (14 digits, an underscore, then lowercase letters, digits, _ or -). Every file in that directory must match, README and .gitkeep included: rename or move it, keeping the run order.`,
        },
      ];
}

/** What each rejection reason of the expand-only migration gate means, and how to satisfy it. */
const MIGRATION_REJECTION: Readonly<Record<DatabaseMigrationAdmissionReason, string>> = {
  destructive:
    "It contains DROP, TRUNCATE, INSERT, UPDATE, DELETE, BEGIN/COMMIT/ROLLBACK, CREATE OR REPLACE, or ALTER TABLE other than ADD; move row changes to 'ohmyhost database write'.",
  provider_specific:
    "It mentions supabase, CREATE POLICY, ROW LEVEL SECURITY, the auth. or storage. schema, or the anon, authenticated or service_role role; comments count.",
  unsupported:
    "It has a statement other than CREATE TABLE, TYPE, DOMAIN, SEQUENCE, VIEW, MATERIALIZED VIEW, TRIGGER, INDEX or FUNCTION, ALTER TABLE ... ADD, COMMENT ON, CREATE SCHEMA IF NOT EXISTS auth|extensions|private or CREATE EXTENSION IF NOT EXISTS pgcrypto|btree_gist|unaccent; or a function not in LANGUAGE sql or plpgsql, SECURITY DEFINER without SET search_path, or the word ohmyhost, comments included.",
  invalid:
    "It is empty, not UTF-8 with LF line endings, has a BOM or NUL byte or an unterminated quote or comment, or exceeds 256 KiB (at most 128 files and 2 MiB in total).",
};

async function migrationSqlBlockers(
  applicationDirectory: string,
  files: readonly string[],
  configuredPath: string | undefined,
  provider: RepositoryInitInventory["database"]["provider"],
): Promise<RepositoryInitBlocker[]> {
  if (provider !== "postgresql") return [];
  const root = configuredPath ?? "postgres/migrations";
  const prefix = `${root}/`;
  const migrationPaths = files
    .filter((path) => path.startsWith(prefix) && path.endsWith(".sql"))
    .map((path) => path.slice(prefix.length));
  if (
    migrationPaths.some(
      (path) => !/^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*\d{14}_[a-z0-9][a-z0-9_-]*\.sql$/u.test(path),
    )
  ) {
    return [];
  }
  const migrations = await Promise.all(
    migrationPaths.map(async (path) =>
      Object.freeze({
        path,
        body: new Uint8Array(await readFile(resolve(applicationDirectory, root, path))),
      }),
    ),
  );
  const blockers: RepositoryInitBlocker[] = [];
  for (const migration of migrations) {
    try {
      admitExpandOnlyMigrations([migration]);
    } catch (error) {
      if (!(error instanceof DatabaseMigrationAdmissionError)) throw error;
      blockers.push({
        code: "migration_sql_not_admitted",
        message: `PostgreSQL migration '${migration.path}' is not admitted (${error.reason}): ${MIGRATION_REJECTION[error.reason]} Migrations are expand-only. Fix the file before its first deployment; never edit a migration a deployment already applied.`,
      });
    }
  }
  if (blockers.length > 0) return blockers;
  try {
    admitExpandOnlyMigrations(migrations);
    return [];
  } catch (error) {
    if (!(error instanceof DatabaseMigrationAdmissionError)) throw error;
    return [
      {
        code: "migration_sql_not_admitted",
        message: `The migration set is not admitted (${error.reason}): ${MIGRATION_REJECTION[error.reason]}`,
      },
    ];
  }
}

async function readExistingConfiguration(
  repositoryRoot: string,
  repositoryFiles: readonly string[],
  applicationRoot: ApplicationRoot,
) {
  if (!repositoryFiles.includes("ohmyhost.yaml")) return null;
  const configurationPath = resolve(repositoryRoot, "ohmyhost.yaml");
  const information = await stat(configurationPath);
  if (!information.isFile() || information.size > MAXIMUM_CONFIGURATION_BYTES) {
    throw new RepositoryInitError(
      "repository_configuration_invalid",
      "ohmyhost.yaml must be one regular file of at most 64 KiB",
    );
  }
  const configuration = await readFile(configurationPath, "utf8");
  let parsed;
  try {
    parsed = parseOhmyhostConfigYaml(configuration);
  } catch (error) {
    // The parser names the offending key; dropping it left the agent nothing to fix.
    throw new RepositoryInitError(
      "repository_configuration_invalid",
      error instanceof TypeError ? error.message : "ohmyhost.yaml is invalid",
    );
  }
  if (parsed.applicationRoot !== applicationRoot) {
    throw new RepositoryInitError(
      "repository_configuration_root_mismatch",
      `ohmyhost.yaml sets applicationRoot to '${parsed.applicationRoot}', but init selected '${applicationRoot}'. Run 'ohmyhost init --root ${parsed.applicationRoot} --dry-run --json', or correct applicationRoot.`,
    );
  }
  return configuration;
}

interface ApplicationRootSelection {
  readonly applicationRoot: ApplicationRoot;
  readonly source: RepositoryInitResult["applicationRootSource"];
}

const APPLICATION_LOCKFILES = Object.freeze([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

async function selectApplicationRoot(
  repositoryRoot: string,
  repositoryFiles: readonly string[],
  explicitRoot: string | undefined,
): Promise<ApplicationRootSelection> {
  if (explicitRoot !== undefined) {
    let applicationRoot: ApplicationRoot;
    try {
      applicationRoot = normalizeApplicationRoot(explicitRoot);
    } catch {
      throw new RepositoryInitError(
        "application_root_invalid",
        "Application root must be a canonical repository-relative POSIX path.",
      );
    }
    if (!(await isRealDirectory(resolve(repositoryRoot, applicationRoot)))) {
      throw new RepositoryInitError(
        "application_root_missing",
        `Application root '${applicationRoot}' does not exist as a real directory.`,
      );
    }
    if (!(await isApplicationCandidate(repositoryRoot, repositoryFiles, applicationRoot))) {
      throw new RepositoryInitError(
        "application_root_unsupported",
        `Application root '${applicationRoot}' is not a self-contained supported application.`,
      );
    }
    return Object.freeze({ applicationRoot, source: "explicit" });
  }

  const repositoryApplicationRoot = normalizeApplicationRoot();
  const repositoryIsCandidate = await isApplicationCandidate(
    repositoryRoot,
    repositoryFiles,
    repositoryApplicationRoot,
  );
  if (
    repositoryIsCandidate &&
    (await hasDirectApplicationShape(repositoryRoot, repositoryFiles, repositoryApplicationRoot))
  ) {
    return Object.freeze({
      applicationRoot: repositoryApplicationRoot,
      source: "repository",
    });
  }
  const candidates: ApplicationRoot[] = [];
  for (const path of repositoryFiles) {
    if (path === "package.json" || !path.endsWith("/package.json")) continue;
    const candidate = candidateRootForPackage(path);
    if (
      candidate !== null &&
      (await isApplicationCandidate(repositoryRoot, repositoryFiles, candidate))
    ) {
      candidates.push(candidate);
    }
  }
  if (candidates.length === 0) {
    if (repositoryIsCandidate) {
      return Object.freeze({
        applicationRoot: repositoryApplicationRoot,
        source: "repository",
      });
    }
    throw new RepositoryInitError(
      "application_root_not_found",
      "No self-contained supported application root was found.",
    );
  }
  if (candidates.length > 1) {
    throw new RepositoryInitError(
      "application_root_ambiguous",
      `Multiple application roots were found: ${candidates.join(", ")}. Use --root to select one.`,
    );
  }
  const applicationRoot = candidates[0];
  if (applicationRoot === undefined) {
    throw new RepositoryInitError(
      "application_root_not_found",
      "No self-contained supported application root was found.",
    );
  }
  return Object.freeze({ applicationRoot, source: "nested" });
}

function candidateRootForPackage(path: string): ApplicationRoot | null {
  const value = path.slice(0, -"/package.json".length);
  try {
    return normalizeApplicationRoot(value);
  } catch {
    return null;
  }
}

async function isApplicationCandidate(
  repositoryRoot: string,
  repositoryFiles: readonly string[],
  applicationRoot: ApplicationRoot,
): Promise<boolean> {
  const applicationDirectory = resolve(repositoryRoot, applicationRoot);
  if (!(await isRealDirectory(applicationDirectory))) return false;
  const files = applicationRelativeFiles(repositoryFiles, applicationRoot);
  if (!files.includes("package.json")) return false;
  const packageJson = await tryReadPackageJson(applicationDirectory);
  if (packageJson === null) return false;
  const framework = detectFramework(dependencyNames(packageJson));
  return framework !== "unknown" || files.includes(WORKER_MODULE_PATH);
}

async function hasDirectApplicationShape(
  repositoryRoot: string,
  repositoryFiles: readonly string[],
  applicationRoot: ApplicationRoot,
): Promise<boolean> {
  const applicationDirectory = resolve(repositoryRoot, applicationRoot);
  const files = applicationRelativeFiles(repositoryFiles, applicationRoot);
  if (APPLICATION_LOCKFILES.filter((lockfile) => files.includes(lockfile)).length !== 1) {
    return false;
  }
  const packageJson = await tryReadPackageJson(applicationDirectory);
  if (packageJson === null) return false;
  const framework = detectFramework(dependencyNames(packageJson));
  if (framework === "unknown") return files.includes(WORKER_MODULE_PATH);
  return hasDirectSafeBuildCommand(packageJson, framework);
}

async function isRealDirectory(path: string): Promise<boolean> {
  try {
    const information = await lstat(path);
    return information.isDirectory() && !information.isSymbolicLink();
  } catch {
    return false;
  }
}

function applicationRelativeFiles(
  repositoryFiles: readonly string[],
  applicationRoot: ApplicationRoot,
): string[] {
  if (applicationRoot === ".") return [...repositoryFiles];
  const prefix = `${applicationRoot}/`;
  return repositoryFiles
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length));
}

async function tryReadPackageJson(root: string): Promise<Record<string, unknown> | null> {
  try {
    return await readPackageJson(root);
  } catch {
    return null;
  }
}

function hasDirectSafeBuildCommand(
  packageJson: Record<string, unknown>,
  framework: RepositoryFramework,
): boolean {
  const scripts = packageJson["scripts"];
  if (!isRecord(scripts) || typeof scripts["build"] !== "string") return false;
  return (
    (framework === "nextjs" || framework === "vite" || framework === "tanstack-start") &&
    isAdmittedFrameworkBuildScript(framework, scripts["build"])
  );
}

/** The package.json build-script blocker, quoting at most 200 characters of the rejected script. */
function buildScriptMessage(framework: RepositoryFramework, command: string): string {
  const quoted = command.slice(0, 200);
  if (framework === "nextjs")
    return `package.json scripts.build must be exactly "next build" or "next build --webpack", not "${quoted}". Move other steps into their own scripts, then commit and push.`;
  return `package.json scripts.build must be "vite build", optionally joined with && to exactly one "tsc", "tsc -b", "tsc --build" or "tsc --noEmit" stage before or after it, not "${quoted}". Move other steps into their own scripts, then commit and push.`;
}

async function assertRepositoryRoot(root: string): Promise<void> {
  let information;
  try {
    information = await lstat(root);
  } catch {
    throw new RepositoryInitError("repository_not_found", "Repository directory does not exist");
  }
  if (information.isSymbolicLink()) {
    throw new RepositoryInitError("repository_symlink_forbidden", "Repository root is a symlink");
  }
  if (!information.isDirectory()) {
    throw new RepositoryInitError("repository_not_directory", "Repository path is not a directory");
  }
  // A Git worktree uses a .git file; never read or follow that file's target.
  for (let ancestor = root; ; ancestor = dirname(ancestor)) {
    let marker;
    try {
      marker = await lstat(resolve(ancestor, ".git"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new RepositoryInitError(
          "repository_unreadable",
          "Could not determine the Git repository root",
        );
      }
    }
    if (marker !== undefined) {
      if (ancestor !== root) {
        throw new RepositoryInitError(
          "repository_root_required",
          "Run ohmyhost init from the Git repository root and select the application directory with --root; ohmyhost.yaml must be at the repository root.",
        );
      }
      return;
    }
    if (dirname(ancestor) === ancestor) return;
  }
}

async function collectRepositoryFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const directories = [""];
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory === undefined) break;
    for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
      const relative = directory === "" ? entry.name : posix.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new RepositoryInitError(
          "repository_symlink_forbidden",
          "Repository symlinks are forbidden",
        );
      }
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) directories.push(relative);
        continue;
      }
      if (!entry.isFile()) {
        throw new RepositoryInitError("repository_entry_unsafe", "Repository entry is unsafe");
      }
      files.push(relative);
      if (files.length > MAXIMUM_REPOSITORY_FILES) {
        throw new RepositoryInitError("repository_too_large", "Repository file limit exceeded");
      }
    }
  }
  return files.sort();
}

async function readPackageJson(root: string): Promise<Record<string, unknown>> {
  const path = resolve(root, "package.json");
  let information;
  try {
    information = await stat(path);
  } catch {
    throw new RepositoryInitError("package_manifest_missing", "package.json is required");
  }
  if (!information.isFile() || information.size > MAXIMUM_PACKAGE_BYTES) {
    throw new RepositoryInitError("package_manifest_invalid", "package.json is invalid");
  }
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(value)) throw new TypeError();
    return value;
  } catch {
    throw new RepositoryInitError("package_manifest_invalid", "package.json is invalid");
  }
}

function dependencyNames(packageJson: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const value = packageJson[field];
    if (!isRecord(value)) continue;
    for (const [name, version] of Object.entries(value)) {
      if (typeof version === "string" && version.length > 0) names.add(name);
    }
  }
  return names;
}

function detectFramework(dependencies: ReadonlySet<string>): RepositoryFramework {
  const classification = classifyFrameworkFamily(dependencies);
  return classification === "ambiguous" ? "unknown" : classification;
}

function packageManagerAdmissionFor(
  packageJson: Record<string, unknown>,
  files: readonly string[],
): PackageManagerDescriptor | FrameworkAdmissionError {
  try {
    return resolvePackageManager({
      packageManager:
        typeof packageJson["packageManager"] === "string"
          ? packageJson["packageManager"]
          : undefined,
      files,
    });
  } catch (error) {
    if (error instanceof FrameworkAdmissionError) return error;
    throw error;
  }
}

function packageManagerInventory(
  admission: PackageManagerDescriptor | FrameworkAdmissionError,
  packageJson: Record<string, unknown>,
  files: readonly string[],
): RepositoryInitInventory["packageManager"] {
  if (!(admission instanceof FrameworkAdmissionError)) {
    return {
      name: admission.manager,
      version: admission.version,
      lockfile: admission.lockfile,
    };
  }
  const declaration = packageJson["packageManager"];
  const match =
    typeof declaration === "string" ? /^(bun|npm|pnpm|yarn)@([^\s]+)$/u.exec(declaration) : null;
  const lockfile = APPLICATION_LOCKFILES.find((candidate) => files.includes(candidate)) ?? null;
  const inferredName =
    lockfile === "package-lock.json"
      ? "npm"
      : lockfile === "pnpm-lock.yaml"
        ? "pnpm"
        : lockfile === "yarn.lock"
          ? "yarn"
          : lockfile === "bun.lock" || lockfile === "bun.lockb"
            ? "bun"
            : "unknown";
  return {
    name: match === null ? inferredName : (match[1] as "bun" | "npm" | "pnpm" | "yarn"),
    version: match?.[2] ?? null,
    lockfile,
  };
}

interface FrameworkConfigurations {
  readonly next: string | null;
  readonly openNext: string | null;
  readonly vite: string | null;
  readonly ambiguous: readonly ("next" | "open-next" | "vite")[];
}

function frameworkConfigurations(files: readonly string[]): FrameworkConfigurations {
  const ambiguous: ("next" | "open-next" | "vite")[] = [];
  const resolve = (basename: "next.config" | "open-next.config" | "vite.config") => {
    try {
      return resolveFrameworkConfig(basename, files);
    } catch (error) {
      if (!(error instanceof FrameworkAdmissionError) || error.reason !== "ambiguous_config") {
        throw error;
      }
      ambiguous.push(basename.slice(0, -".config".length) as "next" | "open-next" | "vite");
      return null;
    }
  };
  return Object.freeze({
    next: resolve("next.config"),
    openNext: resolve("open-next.config"),
    vite: resolve("vite.config"),
    ambiguous: Object.freeze(ambiguous),
  });
}

/** The package.json dependency that carries each admitted framework's version. */
const FRAMEWORK_PACKAGE: Readonly<Record<AdmittedFramework, string>> = {
  nextjs: "next",
  "tanstack-start": "@tanstack/react-start",
  vite: "vite",
};

function frameworkCompatibility(
  packageJson: Record<string, unknown>,
  framework: RepositoryFramework,
): RepositoryInitResult["compatibility"] {
  const targets: readonly Readonly<{ framework: AdmittedFramework; packageName: string }>[] =
    framework === "tanstack-start"
      ? [
          { framework: "tanstack-start", packageName: FRAMEWORK_PACKAGE["tanstack-start"] },
          { framework: "vite", packageName: FRAMEWORK_PACKAGE.vite },
        ]
      : framework === "nextjs"
        ? [{ framework: "nextjs", packageName: FRAMEWORK_PACKAGE.nextjs }]
        : framework === "vite"
          ? [{ framework: "vite", packageName: FRAMEWORK_PACKAGE.vite }]
          : [];
  const frameworks = targets.map(({ framework: targetFramework, packageName }) => {
    const version = dependencyVersion(packageJson, packageName) ?? "";
    return Object.freeze({
      framework: targetFramework,
      version,
      ...classifyFrameworkVersion(targetFramework, version),
    });
  });
  const classification: FrameworkVersionClassification = frameworks.some(
    (entry) => entry.classification === "unsupported",
  )
    ? "unsupported"
    : frameworks.some((entry) => entry.classification === "experimental")
      ? "experimental"
      : frameworks.length > 0 || framework === "functions"
        ? "verified"
        : "unsupported";
  return Object.freeze({ classification, frameworks: Object.freeze(frameworks) });
}

function projectName(explicit: string | undefined, packageJson: Record<string, unknown>): string {
  const packageName = packageJson["name"];
  const inferred =
    typeof packageName === "string"
      ? (packageName.split("/").at(-1) ?? "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, "-")
          .replace(/^-+|-+$/gu, "")
      : packageName;
  const value = explicit ?? inferred;
  if (typeof value !== "string" || value.length > 63 || !PROJECT_PATTERN.test(value)) {
    throw new RepositoryInitError(
      "project_name_invalid",
      "Provide a lowercase project slug with --project",
    );
  }
  return value;
}

function repositoryBlockers(
  packageJson: Record<string, unknown>,
  framework: RepositoryFramework,
  nextStandaloneOutput: boolean,
  tanStackRuntime: TanStackRuntimeAnalysis,
  files: readonly string[],
  packageManagerAdmission: PackageManagerDescriptor | FrameworkAdmissionError,
  frameworkConfigs: FrameworkConfigurations,
  compatibility: RepositoryInitResult["compatibility"],
  existingConfiguration: OhmyhostConfig | null,
): RepositoryInitBlocker[] {
  const blockers: RepositoryInitBlocker[] = [];
  if (framework === "unknown") {
    blockers.push({
      code: "framework_unsupported",
      message:
        "Declare exactly one supported Vite, TanStack Start, or Next.js framework, or add src/ohmyhost/worker.ts for the functions runtime.",
    });
  }
  if (framework === "functions" && !files.includes(WORKER_MODULE_PATH)) {
    blockers.push({
      code: "worker_module_missing",
      message: `The functions runtime needs ${WORKER_MODULE_PATH} exporting fetch and optional scheduled handlers.`,
    });
  }
  if (tanStackRuntime === "ambiguous") {
    blockers.push({
      code: "framework_ambiguous",
      message:
        'TanStack Start needs one vite.config.js, .mjs or .ts that selects a mode. Static: tanstackStart({ prerender: { enabled: true } }) from "@tanstack/react-start/plugin/vite" and no "@cloudflare/vite-plugin". Server: cloudflare({ viteEnvironment: { name: "ssr" } }) from "@cloudflare/vite-plugin" listed before tanstackStart() in plugins, with @cloudflare/vite-plugin, @tanstack/react-router, @tanstack/react-start, react, react-dom, @vitejs/plugin-react and vite in package.json.',
    });
  }
  const relevantAmbiguousConfigs = frameworkConfigs.ambiguous.filter((config) =>
    framework === "nextjs" ? config === "next" || config === "open-next" : config === "vite",
  );
  for (const config of relevantAmbiguousConfigs) {
    blockers.push({
      code: "framework_ambiguous",
      message: `Keep exactly one supported ${config}.config.js, ${config}.config.mjs, or ${config}.config.ts file.`,
    });
  }
  if (
    packageManagerAdmission instanceof FrameworkAdmissionError &&
    packageManagerAdmission.reason === "ambiguous_lockfile"
  ) {
    blockers.push({
      code: "package_manager_ambiguous",
      message: "Keep exactly one supported lockfile in the application root.",
    });
  } else if (packageManagerAdmission instanceof FrameworkAdmissionError) {
    blockers.push({
      code: "package_manager_unpinned",
      message:
        packageManagerAdmission.reason === "package_manager_version_unsupported"
          ? `This build image runs Bun ${PINNED_BUN_VERSION}; pin packageManager to bun@${PINNED_BUN_VERSION} and commit its matching lockfile. Repeating the unchanged version cannot work.`
          : "Declare one exact npm, pnpm, Yarn, or Bun packageManager version and commit its matching lockfile.",
    });
  } else if (
    existingConfiguration !== null &&
    (existingConfiguration.build.install !== packageManagerAdmission.installCommand ||
      ("command" in existingConfiguration.build &&
        existingConfiguration.build.command !== packageManagerAdmission.buildCommand))
  ) {
    blockers.push({
      code: "build_command_unsupported",
      message: `ohmyhost.yaml build.install must be exactly "${packageManagerAdmission.installCommand}"${
        "command" in existingConfiguration.build
          ? ` and build.command "${packageManagerAdmission.buildCommand}"`
          : ""
      } for the packageManager in package.json. Set them, then commit and push.`,
    });
  }
  if (compatibility.classification === "unsupported" && compatibility.frameworks.length > 0) {
    const unsupported = compatibility.frameworks
      .filter((entry) => entry.classification === "unsupported")
      .map((entry) => `${FRAMEWORK_PACKAGE[entry.framework]}@${entry.version || "missing"}`)
      .join(", ");
    blockers.push({
      code: "framework_version_unsupported",
      message: `${unsupported} is outside the versions ohmyho.st builds: next 15.5.x or 16.0.0–16.3.4, vite 5.4.0–8.2.2, @tanstack/react-start 1.168.26–1.168.49, as an exact version or a ^ or ~ range whose base version is inside. Pin a version in that range in package.json, update the lockfile, commit and push.`,
    });
  }
  const scripts = packageJson["scripts"];
  const scriptRecord = isRecord(scripts) ? scripts : {};
  if (framework === "functions") {
    // The functions runtime installs dependencies and bundles the Worker module itself.
  } else if (
    !isRecord(scripts) ||
    typeof scripts["build"] !== "string" ||
    scripts["build"].length === 0
  ) {
    blockers.push({ code: "build_script_missing", message: "Declare a non-empty build script." });
  } else if (!hasDirectSafeBuildCommand(packageJson, framework)) {
    blockers.push({
      code: "build_command_unsupported",
      message: buildScriptMessage(framework, scripts["build"]),
    });
  }
  const betterAuthVersion = dependencyVersion(packageJson, "better-auth");
  const managedAuthIssue = managedCustomerAuthAdmissionIssue(existingConfiguration);
  if (managedAuthIssue !== null) blockers.push(managedAuthIssue);
  if (
    existingConfiguration?.auth?.provider === "better-auth" &&
    betterAuthVersion !== null &&
    betterAuthVersion !== SUPPORTED_BETTER_AUTH_VERSION
  ) {
    blockers.push({
      code: "better_auth_version_unsupported",
      message: "Pin better-auth to exactly 1.7.1 before enabling portable customer auth.",
    });
  }
  if (framework === "nextjs") {
    const dependencies = isRecord(packageJson["dependencies"]) ? packageJson["dependencies"] : {};
    const nextBuild =
      scriptRecord["build"] === "next build" || scriptRecord["build"] === "next build --webpack";
    const nextPackageConfigured =
      nextBuild &&
      compatibility.frameworks[0]?.classification !== "unsupported" &&
      exactVersion(dependencies["react"]) &&
      exactVersion(dependencies["react-dom"]) &&
      frameworkConfigs.next !== null;
    const nextConfigured =
      nextPackageConfigured && frameworkConfigs.ambiguous.every((config) => config !== "open-next");
    if (nextStandaloneOutput) {
      blockers.push({
        code: "workers_runtime_incompatible",
        message:
          "Next.js output: standalone does not function on Workers. Remove the output setting from the Next.js config, commit the change, then create a new plan.",
      });
    }
    if (!nextConfigured) {
      blockers.push({
        code: "next_adapter_unconfigured",
        message:
          'Next.js needs scripts.build exactly "next build" or "next build --webpack", react and react-dom at exact versions such as "19.1.0" (no ^ or ~), next within 15.5.x or 16.0.0–16.3.4, and exactly one next.config.js, .mjs or .ts, with at most one open-next.config file. ohmyho.st adds the OpenNext build itself; do not make it the build script.',
      });
    }
  }
  return blockers.sort((left, right) => left.code.localeCompare(right.code));
}

function exactVersion(value: unknown): boolean {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value);
}

function dependencyVersion(packageJson: Record<string, unknown>, name: string): string | null {
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const dependencies = packageJson[field];
    if (!isRecord(dependencies)) continue;
    const version = dependencies[name];
    if (typeof version === "string" && version.length > 0) return version;
  }
  return null;
}

function renderConfiguration(input: {
  readonly project: string;
  readonly framework: RepositoryFramework;
  readonly packageManager: RepositoryInitInventory["packageManager"];
  readonly databaseProvider: RepositoryInitInventory["database"]["provider"];
  readonly hasHealthcheck: boolean;
  readonly mailEnabled: boolean;
  readonly betterAuthEnabled: boolean;
  readonly storageEnabled: boolean;
  readonly storageJurisdiction: "us" | "eu";
  readonly viteCompanionRequired: boolean;
  readonly tanStackRuntime: TanStackRuntimeAnalysis;
  readonly applicationRoot: ApplicationRoot;
}): string {
  const descriptor = packageManagerDescriptorFromInventory(input.packageManager);
  const install = descriptor?.installCommand ?? "pnpm install --frozen-lockfile --ignore-scripts";
  const command = descriptor?.buildCommand ?? "pnpm run build";

  let output = "dist";
  if (input.framework === "nextjs") output = ".open-next/assets";
  else if (input.framework === "tanstack-start") output = "dist/client";

  let mode = "auto";
  if (input.framework === "functions") mode = "functions";
  else if (
    input.framework === "nextjs" ||
    input.tanStackRuntime === "edge" ||
    input.viteCompanionRequired
  )
    mode = "edge";
  else if (input.framework === "vite" || input.tanStackRuntime === "static") mode = "static";
  const migrations = databaseMigrationPath(input.databaseProvider);
  return [
    "version: 1",
    `project: ${input.project}`,
    ...(input.applicationRoot === "." ? [] : [`applicationRoot: ${input.applicationRoot}`]),
    "build:",
    `  install: ${install}`,
    ...(input.framework === "functions" ? [] : [`  command: ${command}`, `  output: ${output}`]),
    "runtime:",
    `  mode: ${mode}`,
    ...(input.hasHealthcheck ? ["  healthcheck: /api/health"] : []),
    "database:",
    `  enabled: ${String(input.databaseProvider !== "none")}`,
    ...(migrations === null ? [] : [`  migrations: ${migrations}`]),
    "auth:",
    `  provider: ${input.betterAuthEnabled ? "better-auth" : "none"}`,
    "mail:",
    `  enabled: ${String(input.mailEnabled)}`,
    ...(input.storageEnabled
      ? [
          "storage:",
          "  provider: r2",
          `  jurisdiction: ${input.storageJurisdiction}`,
          "  public: false",
        ]
      : []),
    "",
  ].join("\n");
}

function packageManagerDescriptorFromInventory(
  packageManager: RepositoryInitInventory["packageManager"],
): PackageManagerDescriptor | null {
  if (
    packageManager.name === "unknown" ||
    packageManager.version === null ||
    packageManager.lockfile === null
  ) {
    return null;
  }
  try {
    return resolvePackageManager({
      packageManager: `${packageManager.name}@${packageManager.version}`,
      files: [packageManager.lockfile],
    });
  } catch {
    return null;
  }
}

async function detectNextStandaloneOutput(
  root: string,
  framework: RepositoryFramework,
  nextConfigPath: string | null,
): Promise<boolean> {
  if (framework !== "nextjs" || nextConfigPath === null) return false;
  const path = resolve(root, nextConfigPath);
  const information = await stat(path);
  if (!information.isFile() || information.size > MAXIMUM_CONFIGURATION_BYTES) return false;
  return declaresStandaloneOutput(await readFile(path, "utf8"));
}

function declaresStandaloneOutput(source: string): boolean {
  const tokens = sourceTokens(source);
  return tokens.some(
    (token, index) =>
      token === "output" && tokens[index + 1] === ":" && tokens[index + 2] === "standalone",
  );
}

function sourceTokens(source: string): readonly string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      index = end === -1 ? source.length : end + 1;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) return Object.freeze([]);
      index = end + 2;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      let value = "";
      index += 1;
      while (index < source.length && source[index] !== character) {
        if (source[index] === "\\" && source[index + 1] !== undefined) index += 1;
        value += source[index] ?? "";
        index += 1;
      }
      if (source[index] !== character) return Object.freeze([]);
      tokens.push(value);
      index += 1;
      continue;
    }
    if (character !== undefined && /[A-Za-z_$]/u.test(character)) {
      const start = index;
      index += 1;
      while (/[A-Za-z0-9_$]/u.test(source[index] ?? "")) index += 1;
      tokens.push(source.slice(start, index));
      continue;
    }
    if (character !== undefined && "{}[]():,.".includes(character)) tokens.push(character);
    index += 1;
  }
  return Object.freeze(tokens);
}

function databaseMigrationPath(provider: RepositoryInitInventory["database"]["provider"]) {
  if (provider === "supabase") return "postgres/migrations";
  if (provider === "postgresql") return "postgres/migrations";
  return null;
}

async function detectTanStackRuntime(
  root: string,
  files: readonly string[],
  framework: RepositoryFramework,
  packageJson: Record<string, unknown>,
  viteConfigPath: string | null,
): Promise<TanStackRuntimeAnalysis> {
  if (framework !== "tanstack-start") return null;
  if (viteConfigPath === null) return "ambiguous";
  const path = resolve(root, viteConfigPath);
  const information = await stat(path);
  if (!information.isFile() || information.size > MAXIMUM_PACKAGE_BYTES) return "ambiguous";
  const source = await readFile(path, "utf8");
  const tokens = sourceTokens(source);
  if (isCompleteTanStackStatic(tokens)) return "static";
  if (isCompleteTanStackEdgePackage(packageJson) && isCompleteTanStackEdgeConfig(tokens)) {
    return "edge";
  }
  return "ambiguous";
}

function isCompleteTanStackStatic(tokens: readonly string[]): boolean {
  return (
    hasNamedSourceImport(tokens, "tanstackStart", "@tanstack/react-start/plugin/vite") &&
    !hasSourceModuleImport(tokens, "@cloudflare/vite-plugin") &&
    hasNestedObjectValue(tokens, "tanstackStart", "prerender", "enabled", "true")
  );
}

function isCompleteTanStackEdgePackage(packageJson: Record<string, unknown>): boolean {
  return (
    dependencyVersion(packageJson, "@cloudflare/vite-plugin") !== null &&
    ["@tanstack/react-router", "@tanstack/react-start", "react", "react-dom"].every(
      (name) => dependencyVersion(packageJson, name) !== null,
    ) &&
    ["@vitejs/plugin-react", "vite"].every((name) => dependencyVersion(packageJson, name) !== null)
  );
}

function isCompleteTanStackEdgeConfig(tokens: readonly string[]): boolean {
  const cloudflareCall = sourceCallIndex(tokens, "cloudflare");
  const tanStackCall = sourceCallIndex(tokens, "tanstackStart");
  return (
    hasNamedSourceImport(tokens, "cloudflare", "@cloudflare/vite-plugin") &&
    hasNamedSourceImport(tokens, "tanstackStart", "@tanstack/react-start/plugin/vite") &&
    cloudflareCall !== -1 &&
    tanStackCall !== -1 &&
    cloudflareCall < tanStackCall &&
    hasNestedObjectValue(tokens, "cloudflare", "viteEnvironment", "name", "ssr")
  );
}

function hasNamedSourceImport(
  tokens: readonly string[],
  name: string,
  moduleName: string,
): boolean {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] !== "import") continue;
    const fromIndex = tokens.findIndex((token, candidate) => candidate > index && token === "from");
    if (fromIndex === -1) return false;
    if (tokens[fromIndex + 1] === moduleName && tokens.slice(index + 1, fromIndex).includes(name)) {
      return true;
    }
    index = fromIndex;
  }
  return false;
}

function hasSourceModuleImport(tokens: readonly string[], moduleName: string): boolean {
  return tokens.some((token, index) => token === "from" && tokens[index + 1] === moduleName);
}

function sourceCallIndex(tokens: readonly string[], name: string): number {
  return tokens.findIndex((token, index) => token === name && tokens[index + 1] === "(");
}

function hasNestedObjectValue(
  tokens: readonly string[],
  call: string,
  outerProperty: string,
  innerProperty: string,
  expectedValue: string,
): boolean {
  const callIndex = sourceCallIndex(tokens, call);
  if (callIndex === -1 || tokens[callIndex + 2] !== "{") return false;
  const callEnd = matchingSourceDelimiter(tokens, callIndex + 2, "{", "}");
  const outer = directSourceObjectProperty(tokens, callIndex + 2, callEnd, outerProperty);
  if (outer === null || outer.value !== "object") return false;
  return (
    directSourceObjectProperty(tokens, outer.start, outer.end, innerProperty)?.value ===
    expectedValue
  );
}

function directSourceObjectProperty(
  tokens: readonly string[],
  start: number,
  end: number,
  name: string,
): Readonly<{ start: number; end: number; value: string }> | null {
  let depth = 0;
  for (let index = start + 1; index < end; index += 1) {
    const value = tokens[index];
    if (value === "{" || value === "[" || value === "(") depth += 1;
    if (value === "}" || value === "]" || value === ")") depth -= 1;
    if (depth !== 0 || value !== name || tokens[index + 1] !== ":") continue;
    if (tokens[index + 2] === "{") {
      const candidateEnd = matchingSourceDelimiter(tokens, index + 2, "{", "}");
      return Object.freeze({ start: index + 2, end: candidateEnd, value: "object" });
    }
    return Object.freeze({
      start: index + 2,
      end: index + 2,
      value: tokens[index + 2] ?? "",
    });
  }
  return null;
}

function matchingSourceDelimiter(
  tokens: readonly string[],
  start: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index] === open) depth += 1;
    if (tokens[index] === close) depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function requirementsFor(
  inventory: RepositoryInitInventory,
  viteCompanion: boolean,
  mailConversionRequired: boolean,
  managedAuthSelected: boolean,
): string[] {
  const requirements = new Set<string>();
  if (inventory.framework === "nextjs") requirements.add("nextjs-adapter");
  if (inventory.database.provider === "supabase") requirements.add("supabase-postgres-conversion");
  if (
    (inventory.auth.betterAuth && !managedAuthSelected) ||
    inventory.auth.supabase ||
    inventory.auth.workos ||
    inventory.auth.auth0
  )
    requirements.add("application-auth-review");
  if (inventory.edgeFunctions.count > 0) requirements.add("edge-function-conversion");
  if (inventory.storage.supabase) requirements.add("r2-storage-conversion");
  if (mailConversionRequired) requirements.add("transactional-email");
  if (viteCompanion) requirements.add("vite-api-companion");
  return [...requirements].sort();
}

async function detectR2Storage(root: string, files: readonly string[]): Promise<boolean> {
  const configs = files.filter((path) => /(?:^|\/)wrangler\.(?:jsonc?|toml)$/u.test(path));
  for (const config of configs) {
    const path = resolve(root, config);
    const information = await stat(path);
    if (!information.isFile() || information.size > MAXIMUM_CONFIGURATION_BYTES) continue;
    const source = await readFile(path, "utf8");
    if (/\br2_buckets\b/u.test(source)) return true;
  }
  return false;
}

type RuntimeCapabilities = Readonly<{
  database: boolean;
  auth: boolean;
  mail: boolean;
  storage: boolean;
}>;

/** The runtime values and install sources a server module needs, identical for every server runtime. */
function runtimeContract(capabilities: RuntimeCapabilities): Readonly<{
  bindings: readonly string[];
  packages: RepositoryInitRuntimePackages;
}> {
  return Object.freeze({
    bindings: Object.freeze(
      [
        ...(capabilities.auth ? ["BETTER_AUTH_SECRET"] : []),
        ...(capabilities.storage ? STORAGE_RUNTIME_BINDINGS : []),
        ...(capabilities.database ? ["OHMYHOST_DATABASE"] : []),
        ...(capabilities.mail ? ["OHMYHOST_MAIL_KEY"] : []),
      ].sort(),
    ),
    packages: Object.freeze({
      ...(capabilities.auth ? { betterAuth: "1.7.1" as const } : {}),
      // A database project was told to install pg, which cannot open a socket from a Worker at all,
      // and was never offered the package that actually holds the client it needs.
      ...(capabilities.database || capabilities.storage || capabilities.mail
        ? { customerRuntime: CUSTOMER_RUNTIME_SOURCE }
        : {}),
    }),
  });
}

function viteCompanionScaffold(
  files: readonly string[],
  capabilities: RuntimeCapabilities,
): RepositoryInitViteCompanion {
  const sourceEntryPoint = "src/ohmyhost/companion.ts" as const;
  const contract = runtimeContract(capabilities);
  return Object.freeze({
    schemaVersion: "ohmyhost.vite-api-companion/v1" as const,
    sourceEntryPoint,
    requiredFiles: Object.freeze([sourceEntryPoint] as const),
    missingFiles: Object.freeze(files.includes(sourceEntryPoint) ? [] : [sourceEntryPoint]),
    packages: contract.packages,
    bindings: contract.bindings,
    artifact: Object.freeze({
      outputDirectory: ".ohmyhost/vite-companion" as const,
      entryPoint: ".ohmyhost/vite-companion/worker.js" as const,
      configPath: ".ohmyhost/vite-companion/wrangler.jsonc" as const,
    }),
  });
}

async function createConfiguration(root: string, configuration: string): Promise<void> {
  let handle;
  try {
    handle = await open(resolve(root, "ohmyhost.yaml"), "wx", 0o600);
    await handle.writeFile(configuration, "utf8");
    await handle.sync();
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") throw new RepositoryInitConflictError();
    if (error instanceof RepositoryInitError) throw error;
    throw new RepositoryInitError("repository_write_failed", "Could not create ohmyhost.yaml");
  } finally {
    await handle?.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
