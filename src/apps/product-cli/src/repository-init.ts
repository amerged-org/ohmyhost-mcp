import { createHash } from "node:crypto";
import { lstat, open, readFile, readdir, stat } from "node:fs/promises";
import { dirname, posix, resolve } from "node:path";

import {
  normalizeApplicationRoot,
  type ApplicationRoot,
} from "@ohmyhost/contracts/application-root";
import { parseOhmyhostConfigYaml, type OhmyhostConfig } from "@ohmyhost/contracts";
import { isAdmittedFrameworkBuildScript } from "@ohmyhost/contracts/framework-build-script";
import {
  FrameworkAdmissionError,
  frameworkConversionDetail,
  resolveFrameworkConfig,
  resolvePackageManager,
  rootFrameworkConversionDiagnostic,
  type FrameworkConversionDiagnosticCode,
  type FrameworkVersionAdmission,
  type FrameworkVersionPackage,
  type FrameworkVersionStatus,
  type PackageManagerDescriptor,
} from "@ohmyhost/contracts/framework-admission";
import {
  databaseContractCodes,
  declaredDependencyNames,
  isDatabaseContractModule,
  MANAGED_BETTER_AUTH_VERSION,
  packageManagerDeclaration,
  parsePackageManifest,
  repositorySourceFindings,
  sourceWithoutComments,
  tanStackViteConfigRuntime,
  VITE_COMPANION_ENTRY_PATH,
  viteCompanionRequired,
  WORKER_MODULE_PATH,
  workerModuleFindings,
  type DatabaseContractCode,
  type FrameworkSourceLockfile,
  type PackageManifest,
  type TanStackRuntime,
} from "@ohmyhost/contracts/framework-source-rules";
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
// The largest source file ohmyho.st inspects; a larger lockfile resolves nothing.
const MAXIMUM_INSPECTED_FILE_BYTES = 5 * 1024 * 1024;
const MAXIMUM_REPOSITORY_FILES = 20_000;
const PROJECT_PATTERN = /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/u;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".open-next",
  ".supabase",
  ".turbo",
  ".vercel",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
]);
const UTF8 = new TextDecoder("utf-8", { fatal: true });

export type RepositoryFramework = Exclude<FrameworkFamilyClassification, "ambiguous"> | "functions";
const MAXIMUM_SOURCE_BYTES = 2 * 1024 * 1024;
const SOURCE_MODULE_PATTERN = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const STORAGE_CLIENT_CALL_PATTERN = /\bcreatePrivateStorageClient\s*\(/u;
// The catalog names a module only by a path of its grammar; a file name with a space, for example,
// is not one, so its blocker carries the path beside a sentence that does not quote it.
const UNNAMED_MODULE_MESSAGES: Readonly<Record<DatabaseContractCode, string>> = Object.freeze({
  database_binding_private:
    'The module at path reads a database connection string (DATABASE_URL, HYPERDRIVE, connectionString or a postgres:// URL); none reaches a customer Worker. Call the database with createPrivateDatabaseClient from "@ohmyhost/customer-runtime/database". Commit and push the change, then plan the new commit.',
  database_driver_unsupported:
    'The module at path imports a database socket driver (pg, postgres, pg-native or mysql2); customer Workers cannot open sockets. Call the database with createPrivateDatabaseClient from "@ohmyhost/customer-runtime/database". Commit and push the change, then plan the new commit.',
});

// Only a call constructs the client; a comment or a type-only import never does.
function callsStorageClient(source: string): boolean {
  return STORAGE_CLIENT_CALL_PATTERN.test(sourceWithoutComments(source));
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

/** A catalog code, which planning answers with the same sentence, or a check only init runs. */
export type RepositoryInitBlockerCode =
  | FrameworkConversionDiagnosticCode
  | "migration_filename_noncanonical"
  | "migration_sql_not_admitted"
  | "storage_client_missing";

export interface RepositoryInitBlocker {
  readonly code: RepositoryInitBlockerCode;
  /** The file to change, relative to the repository root; null when no single file is at fault. */
  readonly path: string | null;
  readonly message: string;
}

/** One governed framework package, judged by its lockfile resolution or else its declaration. */
export interface RepositoryInitFrameworkVersion {
  readonly package: FrameworkVersionPackage;
  readonly declared: string;
  /** The version package-lock.json or pnpm-lock.yaml resolves; null when none resolves it. */
  readonly resolved: string | null;
  /** A pending range is admitted; the build checks the version its frozen install installs. */
  readonly status: FrameworkVersionStatus;
  /** The lowest admitted release of the judged version's line. */
  readonly minimum: string;
}

export type RepositoryInitPendingCode =
  | "framework_build"
  | "frozen_install"
  | "installed_version"
  | "project_state"
  | "reachable_runtime_sources";

/** A check only ohmyho.st runs. It never blocks init and never changes its exit code. */
export interface RepositoryInitPending {
  readonly code: RepositoryInitPendingCode;
  readonly message: string;
}

const PENDING_CHECKS: Readonly<Record<RepositoryInitPendingCode, string>> = Object.freeze({
  installed_version:
    "compatibility.frameworks lists a version range that no lockfile ohmyho.st reads (package-lock.json v2/v3 or pnpm-lock.yaml v6/v9) resolves. Planning admits it; after the frozen install, the build checks the installed version against the same security minimum.",
  frozen_install:
    "The build installs dependencies from the committed lockfile with the frozen install of the packageManager in package.json, without lifecycle scripts; init installs nothing.",
  framework_build:
    "The build itself (scripts.build with the ohmyho.st adapter build, or the Worker bundle of the functions runtime) runs only on ohmyho.st; a clean init does not prove that it succeeds.",
  reachable_runtime_sources:
    "Planning walks the runtime sources the build reaches for Workers-incompatible imports, database socket drivers and syntax errors; init does not walk them.",
  project_state:
    "Planning also checks the project itself, such as its region against storage.jurisdiction, shared data, the mail sender domain and credits; init runs offline without it.",
});

export interface RepositoryInitInventory {
  readonly framework: RepositoryFramework;
  readonly packageManager: Readonly<{
    name: "bun" | "npm" | "pnpm" | "unknown" | "yarn";
    version: string | null;
    lockfile: string | null;
    /** The commands ohmyho.st runs and build.install and build.command name; null when refused. */
    installCommand: string | null;
    buildCommand: string | null;
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
  readonly betterAuth?: typeof MANAGED_BETTER_AUTH_VERSION;
  /** Exact install source: an npm alias pinned to the published runtime of this client version. */
  readonly customerRuntime?: string;
}

export interface RepositoryInitViteCompanion {
  readonly schemaVersion: "ohmyhost.vite-api-companion/v1";
  readonly sourceEntryPoint: typeof VITE_COMPANION_ENTRY_PATH;
  readonly requiredFiles: readonly [typeof VITE_COMPANION_ENTRY_PATH];
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
  readonly compatibility: Readonly<{ frameworks: readonly RepositoryInitFrameworkVersion[] }>;
  /** Ordered as planning judges the source, so the first blocker is the refusal planning answers. */
  readonly blockers: readonly RepositoryInitBlocker[];
  readonly pending: readonly RepositoryInitPending[];
  readonly requirements: readonly string[];
  readonly companion: RepositoryInitViteCompanion | null;
  readonly worker: Readonly<{
    sourceEntryPoint: typeof WORKER_MODULE_PATH;
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
  const manifest = packageJson.manifest;
  const dependencies = declaredDependencyNames(manifest);
  const existing = await readExistingConfiguration(root, files, selection.applicationRoot);
  const existingConfiguration = existing?.configuration ?? null;
  const framework = detectRepositoryFramework(
    dependencies,
    applicationFiles,
    existingConfiguration,
  );
  const packageManagerAdmission = packageManagerAdmissionFor(manifest, applicationFiles);
  const packageManager = packageManagerInventory(
    packageManagerAdmission,
    manifest,
    applicationFiles,
  );
  const frameworkConfig = await readFrameworkConfig(
    applicationDirectory,
    applicationFiles,
    framework,
  );
  const project = projectName(input.project, manifest);
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
  // TanStack Start binds storage only on edge, as a Vite app does through its companion.
  const tanStackRuntime =
    framework !== "tanstack-start"
      ? null
      : targetStorage
        ? "edge"
        : proposedTanStackRuntime(frameworkConfig, dependencies);
  const companionRequired =
    framework === "vite" &&
    (existingConfiguration === null
      ? databaseProvider !== "none" ||
        targetBetterAuth ||
        targetMail ||
        targetStorage ||
        edgeFunctionNames.size > 0 ||
        applicationFiles.includes(VITE_COMPANION_ENTRY_PATH)
      : viteCompanionRequired(existingConfiguration));
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
  const configurationYaml = existing?.yaml ?? generatedConfigurationYaml;
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
  // Planning stops at an invalid ohmyhost.yaml, and so does init: nothing else can be judged.
  const { blockers, versions } =
    existing !== null && existing.blocker !== null
      ? { blockers: [existing.blocker], versions: [] }
      : await judgeSource({
          framework,
          config: existingConfiguration,
          applicationDirectory,
          files: applicationFiles,
          applicationRoot: selection.applicationRoot,
          provider: selectedDatabaseProvider,
          texts: sourceTexts(files, selection.applicationRoot, configurationYaml, [
            ["package.json", packageJson.text],
            ...lockfileTexts(
              await readResolvingLockfile(applicationDirectory, packageManagerAdmission),
            ),
            ...(frameworkConfig === null
              ? []
              : [[frameworkConfig.path, frameworkConfig.text] as const]),
          ]),
        });
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
    compatibility: Object.freeze({
      frameworks: Object.freeze(
        versions.map((version) =>
          Object.freeze({
            package: version.package,
            declared: version.declared,
            resolved: version.resolved,
            status: version.status,
            minimum: version.minimum,
          }),
        ),
      ),
    }),
    blockers: Object.freeze(blockers),
    pending: pendingChecks(versions),
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

/** What the local source checks read: the application, its files and the parsed configuration. */
interface SourceCheckContext {
  readonly framework: RepositoryFramework;
  readonly config: OhmyhostConfig | null;
  readonly applicationDirectory: string;
  /** Every application file, relative to the application root. */
  readonly files: readonly string[];
  readonly applicationRoot: ApplicationRoot;
}

/**
 * Every blocker of a source with a valid or proposed configuration, in the order planning judges:
 * migration filenames, the shared source rules, the Worker module handlers and the database
 * contract; init's own storage client and migration SQL checks come last.
 */
async function judgeSource(
  context: SourceCheckContext &
    Readonly<{
      provider: RepositoryInitInventory["database"]["provider"];
      texts: ReadonlyMap<string, string | null>;
    }>,
): Promise<
  Readonly<{
    blockers: readonly RepositoryInitBlocker[];
    versions: readonly FrameworkVersionAdmission[];
  }>
> {
  const source = repositorySourceFindings(context.texts);
  return {
    blockers: [
      ...migrationFilenameBlockers(context, context.provider),
      ...source.findings.map((finding) => requiredCatalogBlocker(finding, context.applicationRoot)),
      ...(await workerModuleBlockers(context)),
      ...(await databaseContractBlockers(context, context.provider)),
      ...(await storageClientBlockers(context)),
      ...(await migrationSqlBlockers(context, context.provider)),
    ],
    versions: source.versions,
  };
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

/**
 * The texts the shared source rules read, keyed by repository path: the configuration init judges
 * and the given application files. Every other file counts by its path alone.
 */
function sourceTexts(
  files: readonly string[],
  applicationRoot: ApplicationRoot,
  configurationYaml: string,
  applicationTexts: readonly (readonly [string, string | null])[],
): ReadonlyMap<string, string | null> {
  const texts = new Map<string, string | null>(files.map((path) => [path, null]));
  texts.set("ohmyhost.yaml", configurationYaml);
  for (const [path, text] of applicationTexts)
    texts.set(repositoryPath(applicationRoot, path), text);
  return texts;
}

function lockfileTexts(
  lockfile: FrameworkSourceLockfile | null,
): readonly (readonly [string, string])[] {
  return lockfile === null ? [] : [[lockfile.name, lockfile.text]];
}

/** The path of an application file relative to the repository root. */
function repositoryPath(applicationRoot: ApplicationRoot, path: string): string {
  return applicationRoot === "." ? path : `${applicationRoot}/${path}`;
}

/** A catalog diagnostic as a blocker: its repository-relative file and the sentence planning uses. */
function catalogBlocker(
  diagnostic: unknown,
  applicationRoot: ApplicationRoot,
): RepositoryInitBlocker | null {
  const rooted = rootFrameworkConversionDiagnostic(diagnostic, applicationRoot);
  const message = frameworkConversionDetail(rooted);
  return rooted === null || message === null
    ? null
    : Object.freeze({ code: rooted.code, path: rooted.path, message });
}

/** The blocker of a diagnostic whose file always has a catalog path, such as a shared finding. */
function requiredCatalogBlocker(
  diagnostic: unknown,
  applicationRoot: ApplicationRoot,
): RepositoryInitBlocker {
  const blocker = catalogBlocker(diagnostic, applicationRoot);
  if (blocker === null) throw new TypeError("Repository init diagnostic is invalid");
  return blocker;
}

/**
 * The Worker module handlers planning requires, judged by the same shared rule: the functions
 * runtime serves requests through its module, and declared crons need a scheduled handler in the
 * module that runs them. The shared source rules name a missing module or an unsupported runtime.
 */
async function workerModuleBlockers(context: SourceCheckContext): Promise<RepositoryInitBlocker[]> {
  const { config, framework, files } = context;
  const mode = config?.runtime.mode;
  const scheduled =
    (config?.functions?.crons.length ?? 0) > 0 &&
    ((mode === "edge" &&
      (framework === "vite" || framework === "nextjs" || framework === "tanstack-start")) ||
      (mode === "functions" && framework === "functions"));
  const path = framework === "vite" ? VITE_COMPANION_ENTRY_PATH : WORKER_MODULE_PATH;
  if ((framework !== "functions" && !scheduled) || !files.includes(path)) return [];
  const source = await readFile(resolve(context.applicationDirectory, path), "utf8");
  return workerModuleFindings({ path, source, fetch: framework === "functions", scheduled }).map(
    (finding) => requiredCatalogBlocker(finding, context.applicationRoot),
  );
}

/**
 * Declared storage is reached only through the private gateway client. A storage-enabled app whose
 * source never constructs that client deploys green and fails at its first upload, so name it here.
 */
async function storageClientBlockers(
  context: SourceCheckContext,
): Promise<RepositoryInitBlocker[]> {
  if (context.config?.storage === undefined) return [];
  for (const path of context.files) {
    if (!SOURCE_MODULE_PATTERN.test(path)) continue;
    const absolute = resolve(context.applicationDirectory, path);
    const information = await stat(absolute);
    if (!information.isFile() || information.size > MAXIMUM_SOURCE_BYTES) continue;
    if (callsStorageClient(await readFile(absolute, "utf8"))) return [];
  }
  return [
    {
      code: "storage_client_missing",
      path: null,
      message:
        'ohmyhost.yaml declares storage, but no application source calls createPrivateStorageClient. Import it from "@ohmyhost/customer-runtime/storage" and build it in server code from OHMYHOST_STORAGE_GATEWAY, OHMYHOST_STORAGE_GATEWAY_URL, OHMYHOST_PROJECT_ID, OHMYHOST_ENVIRONMENT_ID and OHMYHOST_STORAGE_KEY, then reserve an upload, PUT the bytes to the returned signed URL, complete it, and serve reads with createSignedRead. There is no FILES bucket binding.',
    },
  ];
}

/**
 * A managed database is reached only through `createPrivateDatabaseClient`. A customer Worker gets
 * no connection string and cannot open a socket, so source that reaches for either builds green,
 * deploys, and fails its health check with nothing to explain it. Once the judged configuration
 * enables the database, init scans every module of the kinds planning judges, reachable or not.
 */
async function databaseContractBlockers(
  context: SourceCheckContext,
  provider: RepositoryInitInventory["database"]["provider"],
): Promise<RepositoryInitBlocker[]> {
  if (provider === "none") return [];
  const blockers: RepositoryInitBlocker[] = [];
  for (const path of context.files) {
    if (!isDatabaseContractModule(path)) continue;
    const absolute = resolve(context.applicationDirectory, path);
    const information = await stat(absolute);
    if (!information.isFile() || information.size > MAXIMUM_SOURCE_BYTES) continue;
    for (const code of databaseContractCodes(await readFile(absolute, "utf8")))
      blockers.push(
        catalogBlocker({ code, path }, context.applicationRoot) ??
          Object.freeze({
            code,
            path: repositoryPath(context.applicationRoot, path),
            message: UNNAMED_MODULE_MESSAGES[code],
          }),
      );
  }
  return blockers;
}

function migrationFilenameBlockers(
  context: SourceCheckContext,
  provider: RepositoryInitInventory["database"]["provider"],
): RepositoryInitBlocker[] {
  if (provider !== "postgresql") return [];
  const root = context.config?.database?.migrations ?? "postgres/migrations";
  const prefix = `${root}/`;
  const invalid = context.files
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
          path: repositoryPath(context.applicationRoot, `${prefix}${invalid}`),
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
  context: SourceCheckContext,
  provider: RepositoryInitInventory["database"]["provider"],
): Promise<RepositoryInitBlocker[]> {
  if (provider !== "postgresql") return [];
  const root = context.config?.database?.migrations ?? "postgres/migrations";
  const prefix = `${root}/`;
  const migrationPaths = context.files
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
        body: new Uint8Array(await readFile(resolve(context.applicationDirectory, root, path))),
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
        path: repositoryPath(context.applicationRoot, `${prefix}${migration.path}`),
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
        path: null,
        message: `The migration set is not admitted (${error.reason}): ${MIGRATION_REJECTION[error.reason]}`,
      },
    ];
  }
}

/** The pending checks of one analysis: the fixed list, led by the unresolved versions if any. */
function pendingChecks(
  versions: readonly FrameworkVersionAdmission[],
): readonly RepositoryInitPending[] {
  const codes: readonly RepositoryInitPendingCode[] = [
    ...(versions.some(({ status }) => status === "pending") ? ["installed_version" as const] : []),
    "frozen_install",
    "framework_build",
    "reachable_runtime_sources",
    "project_state",
  ];
  return Object.freeze(codes.map((code) => Object.freeze({ code, message: PENDING_CHECKS[code] })));
}

type ExistingConfiguration = Readonly<
  | { yaml: string; configuration: OhmyhostConfig; blocker: null }
  | { yaml: string; configuration: null; blocker: RepositoryInitBlocker }
>;

async function readExistingConfiguration(
  repositoryRoot: string,
  repositoryFiles: readonly string[],
  applicationRoot: ApplicationRoot,
): Promise<ExistingConfiguration | null> {
  if (!repositoryFiles.includes("ohmyhost.yaml")) return null;
  const configurationPath = resolve(repositoryRoot, "ohmyhost.yaml");
  const information = await stat(configurationPath);
  if (!information.isFile() || information.size > MAXIMUM_CONFIGURATION_BYTES) {
    throw new RepositoryInitError(
      "repository_configuration_invalid",
      "ohmyhost.yaml must be one regular file of at most 64 KiB",
    );
  }
  const bytes = await readFile(configurationPath);
  const text = utf8(bytes);
  const yaml = text ?? new TextDecoder().decode(bytes);
  let parsed;
  try {
    if (text === null) throw new TypeError("ohmyhost.yaml is not valid UTF-8");
    parsed = parseOhmyhostConfigYaml(text);
  } catch (error) {
    // Planning refuses a non-UTF-8 or schema-invalid ohmyhost.yaml and points here: the blocker
    // keeps the reason, such as the offending field the parser names.
    const reason = (
      error instanceof TypeError ? error.message : "ohmyhost.yaml is invalid"
    ).replace(/\.$/u, "");
    return Object.freeze({
      yaml,
      configuration: null,
      blocker: Object.freeze({
        code: "repository_configuration_invalid",
        path: "ohmyhost.yaml",
        message: `${reason}. Fix that in ohmyhost.yaml and run init again; init never rewrites an existing ohmyhost.yaml, so do not delete it.`,
      }),
    });
  }
  if (parsed.applicationRoot !== applicationRoot) {
    throw new RepositoryInitError(
      "repository_configuration_root_mismatch",
      `ohmyhost.yaml sets applicationRoot to '${parsed.applicationRoot}', but init selected '${applicationRoot}'. Run 'ohmyhost init --root ${parsed.applicationRoot} --dry-run --json', or correct applicationRoot.`,
    );
  }
  return Object.freeze({ yaml, configuration: parsed, blocker: null });
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
  const framework = detectFramework(declaredDependencyNames(packageJson.manifest));
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
  const framework = detectFramework(declaredDependencyNames(packageJson.manifest));
  if (framework === "unknown") return files.includes(WORKER_MODULE_PATH);
  return hasDirectSafeBuildCommand(packageJson.manifest, framework);
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

async function tryReadPackageJson(root: string): Promise<PackageJson | null> {
  try {
    return await readPackageJson(root);
  } catch {
    return null;
  }
}

function hasDirectSafeBuildCommand(
  manifest: PackageManifest,
  framework: RepositoryFramework,
): boolean {
  const scripts = manifest["scripts"];
  if (!isRecord(scripts) || typeof scripts["build"] !== "string") return false;
  return (
    (framework === "nextjs" || framework === "vite" || framework === "tanstack-start") &&
    isAdmittedFrameworkBuildScript(framework, scripts["build"])
  );
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

/** package.json as the shared rules read it: its UTF-8 text and the object it parses to. */
interface PackageJson {
  readonly text: string;
  readonly manifest: PackageManifest;
}

async function readPackageJson(root: string): Promise<PackageJson> {
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
  const text = utf8(await readFile(path));
  const manifest = text === null ? null : parsePackageManifest(text);
  if (text === null || manifest === null) {
    throw new RepositoryInitError("package_manifest_invalid", "package.json is invalid");
  }
  return Object.freeze({ text, manifest });
}

function utf8(bytes: Uint8Array): string | null {
  try {
    return UTF8.decode(bytes);
  } catch {
    return null;
  }
}

/** At most the inspection bound of a file's leading bytes, and whether they are the whole file. */
async function readLeadingBytes(
  path: string,
): Promise<Readonly<{ bytes: Uint8Array; complete: boolean }>> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const bytes = new Uint8Array(Math.min(size, MAXIMUM_INSPECTED_FILE_BYTES));
    const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, 0);
    return Object.freeze({ bytes: bytes.subarray(0, bytesRead), complete: bytesRead === size });
  } finally {
    await handle.close();
  }
}

/**
 * The lockfile whose resolution decides the framework versions: package-lock.json or
 * pnpm-lock.yaml of the admitted package manager. Any other lockfile, a larger one or one that is
 * not UTF-8 leaves every version to its declaration; lockfile content never blocks.
 */
async function readResolvingLockfile(
  applicationDirectory: string,
  admission: PackageManagerDescriptor | FrameworkAdmissionError,
): Promise<FrameworkSourceLockfile | null> {
  if (
    admission instanceof FrameworkAdmissionError ||
    (admission.lockfile !== "package-lock.json" && admission.lockfile !== "pnpm-lock.yaml")
  )
    return null;
  const { bytes, complete } = await readLeadingBytes(
    resolve(applicationDirectory, admission.lockfile),
  );
  const text = complete ? utf8(bytes) : null;
  return text === null ? null : Object.freeze({ name: admission.lockfile, text });
}

/** The framework config the shared rules judge: its application-relative path and UTF-8 text. */
interface FrameworkConfigText {
  readonly path: string;
  /** null when the bytes are not UTF-8, which the rules refuse as invalid source. */
  readonly text: string | null;
}

async function readFrameworkConfig(
  applicationDirectory: string,
  files: readonly string[],
  framework: RepositoryFramework,
): Promise<FrameworkConfigText | null> {
  if (framework !== "nextjs" && framework !== "vite" && framework !== "tanstack-start") return null;
  let path: string | null;
  try {
    path = resolveFrameworkConfig(framework === "nextjs" ? "next.config" : "vite.config", files);
  } catch (error) {
    // The shared rules name the ambiguous variants; none of them is judged.
    if (error instanceof FrameworkAdmissionError) return null;
    throw error;
  }
  if (path === null) return null;
  const { bytes, complete } = await readLeadingBytes(resolve(applicationDirectory, path));
  // A config beyond the inspection bound is refused by its size alone, which its leading text has.
  return Object.freeze({ path, text: complete ? utf8(bytes) : new TextDecoder().decode(bytes) });
}

/**
 * The TanStack Start runtime init proposes: the one whose plugin contract the Vite config follows,
 * otherwise edge when package.json declares the Cloudflare Vite plugin and static without it. The
 * shared rules then name what the config still lacks for that runtime.
 */
function proposedTanStackRuntime(
  config: FrameworkConfigText | null,
  dependencies: ReadonlySet<string>,
): TanStackRuntime {
  const followed =
    config === null || config.text === null ? null : tanStackViteConfigRuntime(config.text);
  return followed ?? (dependencies.has("@cloudflare/vite-plugin") ? "edge" : "static");
}

function detectFramework(dependencies: ReadonlySet<string>): RepositoryFramework {
  const classification = classifyFrameworkFamily(dependencies);
  return classification === "ambiguous" ? "unknown" : classification;
}

function packageManagerAdmissionFor(
  manifest: PackageManifest,
  files: readonly string[],
): PackageManagerDescriptor | FrameworkAdmissionError {
  try {
    return resolvePackageManager({ packageManager: packageManagerDeclaration(manifest), files });
  } catch (error) {
    if (error instanceof FrameworkAdmissionError) return error;
    throw error;
  }
}

function packageManagerInventory(
  admission: PackageManagerDescriptor | FrameworkAdmissionError,
  manifest: PackageManifest,
  files: readonly string[],
): RepositoryInitInventory["packageManager"] {
  if (!(admission instanceof FrameworkAdmissionError)) {
    return {
      name: admission.manager,
      version: admission.version,
      lockfile: admission.lockfile,
      installCommand: admission.installCommand,
      buildCommand: admission.buildCommand,
    };
  }
  const declaration = packageManagerDeclaration(manifest);
  const match =
    declaration === undefined ? null : /^(bun|npm|pnpm|yarn)@([^\s]+)$/u.exec(declaration);
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
    installCommand: null,
    buildCommand: null,
  };
}

function projectName(explicit: string | undefined, manifest: PackageManifest): string {
  const packageName = manifest["name"];
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
  readonly tanStackRuntime: TanStackRuntime | null;
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

function databaseMigrationPath(provider: RepositoryInitInventory["database"]["provider"]) {
  if (provider === "supabase") return "postgres/migrations";
  if (provider === "postgresql") return "postgres/migrations";
  return null;
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
      ...(capabilities.auth ? { betterAuth: MANAGED_BETTER_AUTH_VERSION } : {}),
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
  const sourceEntryPoint = VITE_COMPANION_ENTRY_PATH;
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
