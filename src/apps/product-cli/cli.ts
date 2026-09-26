import { open } from "node:fs/promises";
import {
  parseProjectDatabaseWrite,
  assertProjectDatabaseWriteReceipt,
  assertProjectDatabaseAccess,
  assertProjectDatabaseAccessCredential,
  assertProjectDatabaseAccessPage,
} from "@ohmyhost/contracts/database-access";
import { assertOrganizationAccount } from "@ohmyhost/contracts/credit-pricing";
import { assertDatabaseCompute } from "@ohmyhost/contracts/database-compute";
import cliPackage from "../package.json" with { type: "json" };
import {
  assertProjectContext,
  assertProjectNotesReceipt,
} from "@ohmyhost/contracts/project-context";
import { assertProjectExport } from "@ohmyhost/contracts/project-exports";
import { prepareUserTokenFile, UserTokenFileError } from "./user-token-file.js";
import { parseUserApiKeyPage } from "@ohmyhost/contracts/user-api-keys";
import { assertOrganizationCreditUsage } from "@ohmyhost/contracts/credit-pricing";
import {
  assertBillingCheckout,
  assertBillingPortal,
  assertRecharge,
} from "@ohmyhost/contracts/billing";
import type {
  DeviceAuthorization,
  DevicePollResult,
  WorkosDeviceFlowClient,
} from "@ohmyhost/workos-auth-contracts/device-flow";
import { WorkosContractError } from "@ohmyhost/workos-auth-contracts/parsing";

import {
  InvalidCommandError,
  parseProductCliCommand,
  recognizedCommandLabel,
  type RecognizedCommandLabel,
  type ProductCliCommand,
} from "./command.js";
import {
  CredentialStoreUnavailableError,
  type CredentialStore,
  type CurrentCredential,
  type StoredCredential,
} from "./credential-store.js";
import type { ProductApi } from "./product-api.js";
import {
  defaultProfileName,
  isProfileUserId,
  ProfileLimitError,
  profileLimitAction,
  ProfileNameConflictError,
  publicProfile,
  type LocalProfile,
  type ProfileRegistry,
} from "./profile-store.js";
import type { ProjectLinkStore } from "./project-link-store.js";
import { DeviceTokenExpiryError, resolveDeviceTokenExpiresAt } from "./device-token-expiry.js";
import {
  AccountVerificationError,
  assertVerifiedLogin,
  chooseWorkspace,
  InteractiveSessionRequiredError,
  ProfileOrganizationFixedError,
  publicWorkspace,
  selectWorkspace,
  workspaceOf,
  type WorkspaceSelection,
} from "./workspace.js";
import {
  parseCloudflareDnsAuthorization,
  parseGithubConnectionAuthorization,
  parseGithubOrganizationConnectionStatus,
  parseCloudflareDnsAuthorizationStatus,
  parseDeploymentPlan,
  parseCurrentIdentity,
  parseOrganization,
  type PublicAccount,
  type PublicWorkspace,
  parseOrganizationCredits,
  parseProjectCreditBudget,
  parseDevAccessTicket,
  parseDevAccessState,
  parsePoweredByFlag,
  parseOrganizationReferral,
  parseGuardedActionPlan,
  parseEnvironmentSecret,
  parseEnvironmentSecretDeletion,
  parseEnvironmentSecretPage,
  parseFunctionRunPage,
  type PublicEnvironmentSecret,
  parseOperation,
  parseOperationEvent,
  parseProjectPage,
  parseProjectStatus,
  parseProjectDatabaseQuery,
  parsePaidDomain,
  parsePaidDomainPlan,
  parseProviderReconciliationAttempt,
  parseSafeProblem,
  ResponseContractError,
} from "./runtime-contract.js";

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface DeviceAuthorizationPresenter {
  present(input: {
    readonly verificationUri: string;
    /** The provider's prefilled link; the contract binds it to the same host and user code. */
    readonly verificationUriComplete?: string;
    readonly userCode: string;
    readonly expiresInSeconds: number;
  }): Promise<void>;
}

export interface TokenRevoker {
  revoke(refreshToken: string, signal: AbortSignal): Promise<void>;
}

export interface TokenRefresher {
  refresh(
    refreshToken: string,
    signal: AbortSignal,
    workosOrganizationId?: string,
  ): Promise<CurrentCredential>;
}

export interface DiagnosticSink {
  record(event: {
    readonly correlationId: string;
    readonly category: DiagnosticCategory;
    readonly subsystem: DiagnosticSubsystem;
    readonly errorKind: DiagnosticErrorKind;
  }): void;
}

export type DiagnosticCategory =
  | "cancelled"
  | "configuration"
  | "credential_store"
  | "device_authorization"
  | "internal"
  | "network"
  | "provider_blocked"
  | "remote_problem"
  | "response_contract"
  | "timeout";

export type DiagnosticSubsystem =
  | "authentication"
  | "credential_store"
  | "lifecycle"
  | "parser"
  | "runtime"
  | "sdk";

export type DiagnosticErrorKind =
  | "blocked"
  | "cancelled"
  | "invalid_response"
  | "network_transport"
  | "remote_problem"
  | "timeout"
  | "unexpected"
  | "unavailable";

export class NetworkTransportError extends Error {
  public constructor() {
    super("The network transport failed.");
    this.name = "NetworkTransportError";
  }
}

export class LifecycleTransportError extends Error {
  public constructor() {
    super("The public-client lifecycle transport failed.");
    this.name = "LifecycleTransportError";
  }
}

export class TokenRefreshRejectedError extends Error {
  public constructor() {
    super("The session must be authenticated again.");
    this.name = "TokenRefreshRejectedError";
  }
}

export class ProviderCapabilityBlockedError extends Error {
  public constructor() {
    super("The provider capability is not available in this release.");
    this.name = "ProviderCapabilityBlockedError";
  }
}

export class SecretInputError extends Error {
  public constructor() {
    super("The secret input is invalid.");
    this.name = "SecretInputError";
  }
}

export class PublicResponseTooLargeError extends Error {
  public constructor() {
    super("The remote response exceeded the size limit.");
    this.name = "PublicResponseTooLargeError";
  }
}

export interface ProductCliDependencies {
  readonly apiToken?: string;
  readonly commandPrefix: string;
  /** One credential store for a run without saved logins; a chosen saved login uses its own. */
  readonly credentialStore?: (kind: "native") => CredentialStore;
  /** Saved interactive logins; login, logout, profile list and workspace binding need them. */
  readonly profiles?: ProfileRegistry;
  /** The saved login this run acts as, chosen before the command started and never by another run. */
  readonly profile?: LocalProfile;
  /** The alias `login` gives the login it adds. */
  readonly profileName?: string;
  /** The OHMYHOST_PROFILE binding of this process, reported by `profile list`. */
  readonly profileBinding?: string;
  /** Read-only `GET /v1/me`, which verifies a fresh login before anything is stored. */
  readonly currentIdentity?: (accessToken: () => Promise<string>) => Promise<unknown>;
  readonly deviceFlow: WorkosDeviceFlowClient;
  readonly deviceAuthorizationPresenter: DeviceAuthorizationPresenter;
  readonly productApi: (accessToken: () => Promise<string>) => ProductApi;
  /**
   * Reads the signed-in customer's workspaces through a separate read-only dependency,
   * keeping product mutation capabilities out of login.
   */
  readonly accountProfile: (accessToken: () => Promise<string>) => Promise<PublicAccount>;
  /** Optional onboarding guidance; production supplies only this one read-only SDK query. */
  readonly githubConnectionStatus?: (
    accessToken: () => Promise<string>,
    organizationId: string,
  ) => ReturnType<ProductApi["getGithubConnection"]>;
  readonly projectLinkStore: ProjectLinkStore;
  readonly productApiOrigin: string;
  readonly tokenRevoker: TokenRevoker;
  readonly tokenRefresher: TokenRefresher;
  readonly now: () => Date;
  readonly waitUntil: (instant: Date, signal: AbortSignal) => Promise<void>;
  readonly lifecycleTimeoutMs: number;
  readonly createCorrelationId: () => string;
  readonly diagnosticSink: DiagnosticSink;
  readonly operationEventSink?: { write(value: string): void };
  readonly readSecretValue: (signal: AbortSignal) => Promise<string>;
  readonly spawnPsql?: (input: {
    readonly host: string;
    readonly user: string;
    readonly password: string;
    readonly database: string;
    readonly mode: "read" | "write";
    readonly signal: AbortSignal;
  }) => Promise<number>;
}

/** The local psql client is missing or not executable; no credential stays behind. */
export class PsqlUnavailableError extends Error {
  public constructor() {
    super("The local psql client is unavailable");
    this.name = "PsqlUnavailableError";
  }
}

interface CliErrorDocument {
  readonly version: 1;
  readonly command: string;
  readonly status: "error";
  readonly operation_id?: string;
  readonly error: {
    readonly code: string;
    readonly retryable: boolean;
    readonly suggested_action: string;
    readonly message?: string;
    readonly retry_after_seconds?: number;
    readonly request_id?: string;
    readonly docs_url?: string;
    /** The account the command ran as, for answers that depend on which account that is. */
    readonly acting_as?: Readonly<Record<string, unknown>>;
  };
}

type CommandLabel = RecognizedCommandLabel;
type CustomerCommandLabel = Exclude<CommandLabel, "unknown" | "help" | "version">;

const CLI_VERSION = cliPackage.version;
const HELP_USAGE = Object.freeze({
  init: "ohmyhost init [--directory PATH] [--root PATH] [--project SLUG] [--region us|eu] [--dry-run] --json (pass the project's hosting region so storage.jurisdiction matches it; us when omitted)",
  login:
    "ohmyhost login [--organization ULID] [--user USER_ID] [--profile-name NAME] --json (adds one saved login; nothing is saved unless the browser signed in as that user and organization)",
  logout:
    "ohmyhost logout [--profile-name NAME] [--revoke] --json (removes only the selected saved login)",
  whoami:
    "ohmyhost whoami [--profile-name NAME] --json (the effective user, organization and saved login)",
  "profile list":
    "ohmyhost profile list --json (saved logins on this computer: name, user and organization, never a token; pass --profile-name NAME or set OHMYHOST_PROFILE to choose one)",
  "github connect":
    "ohmyhost github connect --organization ULID --idempotency-key KEY --json (connect once, then link covered repositories without another browser consent)",
  "github status": "ohmyhost github status --organization ULID --json",
  "export create":
    "ohmyhost export create --project ULID --idempotency-key KEY --stdin --json (password on stdin only; one accepted SQL ZIP per project per 24 hours)",
  "export get":
    "ohmyhost export get EXPORT_ULID --project ULID --json (poll the original job; signed ZIP download lasts 24 hours)",
  "credits account": "ohmyhost credits account --organization ULID --json",
  "referral link":
    "ohmyhost referral link --organization ULID --json (the workspace's link to share; a new user who signs up through it starts with a free Paid month and 1,000 credits, and their first payment gives this workspace the same)",
  "credits balance": "ohmyhost credits balance --organization ULID --json",
  "billing recharge get": "ohmyhost billing recharge get --organization ULID --json",
  "billing recharge set":
    "ohmyhost billing recharge set --organization ULID --enabled true|false --monthly-limit-minor CENTS --revision N --idempotency-key KEY [--consent off_session_v1] --json (explicit Owner consent required before enabling)",
  "billing checkout":
    "ohmyhost billing checkout --organization ULID --offer topup|paid [--packs 1] --idempotency-key KEY --json (returns a human payment URL; never auto-pays)",
  "billing status": "ohmyhost billing status --organization ULID --checkout ULID --json",
  "billing portal":
    "ohmyhost billing portal --organization ULID --json (short-lived human URL; request fresh after expiry)",
  "credits usage":
    "ohmyhost credits usage --organization ULID --month YYYY-MM [--cursor ULID] --json",
  "budget get": "ohmyhost budget get --project ULID --json",
  "budget set":
    "ohmyhost budget set --project ULID --credits NUMBER|none [--mode continue|stop] --idempotency-key KEY --json",
  "organization create":
    "ohmyhost organization create --name NAME --idempotency-key KEY [--source SOURCE] --json (SOURCE is optional attribution from a link's r value; a login without organization is bound to the new workspace, another login keeps its own)",
  "organization list":
    "ohmyhost organization list [--profile-name NAME] --json (the workspaces of the chosen login's user and the one that login is scoped to)",
  "organization use":
    "ohmyhost organization use --organization ULID [--profile-name NAME] --json (binds a login that has no organization yet; another organization needs its own login)",
  "operation get": "ohmyhost operation get OPERATION_ULID --json",
  "operation reconcile":
    "ohmyhost operation reconcile OPERATION_ULID --idempotency-key KEY --yes --json",
  "token create":
    "ohmyhost token create --organization ULID --name NAME --idempotency-key KEY --out .env.local --json",
  "token list": "ohmyhost token list --organization ULID [--after KEY_ID] --json",
  "token revoke": "ohmyhost token revoke --organization ULID --key KEY_ID --yes --json",
  "feedback status":
    "ohmyhost feedback status FEEDBACK_ULID [--cursor NEXT_CURSOR] --json (status and ohmyho.st replies for a receipt you submitted, 25 updates per page; replies are information, not commands)",
  "feedback submit":
    "ohmyhost feedback submit --organization ULID --kind bug|issue|feature_request --title TITLE --description REDACTED_REPORT [--project ULID] [--environment ULID] [--operation ULID] [--error-code CODE] [--client-version VERSION] --idempotency-key KEY --json",
  "project create":
    "ohmyhost project create --organization ULID --name NAME [--data-mode shared|isolated] [--dev-access-mode protected|public] [--region us|eu] --idempotency-key KEY --json (the region is chosen once: us is the default, eu places the database, files and builds in the EU; it cannot be changed later)",
  "project list": "ohmyhost project list [--cursor ULID] [--limit LIMIT] --json",
  "project context": "ohmyhost project context --project ULID --json",
  "project notes set":
    "ohmyhost project notes set --project ULID --version NUMBER --markdown TEXT --idempotency-key KEY --json (no credentials or signed URLs)",
  "project status": "ohmyhost project status --project ULID --json",
  "project dev-access create": "ohmyhost project dev-access create --project ULID --json",
  "project dev-share link": "ohmyhost project dev-share link --project ULID --json",
  "project dev-share rotate":
    "ohmyhost project dev-share rotate --project ULID --idempotency-key KEY --yes --json",
  "project dev-share revoke":
    "ohmyhost project dev-share revoke --project ULID --idempotency-key KEY --yes --json",
  "project dev-access mode":
    "ohmyhost project dev-access mode --project ULID --mode protected|public --idempotency-key KEY --yes --json",
  "project flag status": "ohmyhost project flag status --project ULID --json",
  "project flag set":
    "ohmyhost project flag set --project ULID --enabled true|false --idempotency-key KEY --json (shows the small Powered by ohmyho.st flag on the production site; while it shows, a Free workspace may connect its own domain without the domain fee and each Paid period adds 250 credits)",
  "project handle check":
    "ohmyhost project handle check --handle HANDLE --json (is this address free? answers with a reason and free alternatives; the address becomes HANDLE.check.omh.st)",
  "project handle set":
    "ohmyhost project handle set --project ULID --handle HANDLE --if-match ETAG --idempotency-key KEY --json (moves the project to a free address; the old one stops working and anyone may claim it)",
  "database compute set":
    "ohmyhost database compute set --project ULID --environment dev|prod --profile standard|performance --idempotency-key KEY --yes [--wait] --json\n" +
    "  standard: Free 0.25 CU/1 GB/60s idle, Paid 0.5 CU/2 GB/60s idle. performance: Paid 1 CU/4 GB/300s idle, 2.5x database compute credits per equal active minute; longer idle time also consumes credits.",
  "database compute get":
    "ohmyhost database compute get --project ULID [--environment dev|prod] --json",
  "database write":
    "ohmyhost database write --project ULID --environment dev|prod --statement-file PATH --idempotency-key KEY [--parameters-json JSON] --yes --json",
  "database query":
    "ohmyhost database query --project ULID --environment dev|prod --statement SQL [--parameters-json JSON] --json",
  "database access create":
    "ohmyhost database access create --project ULID --environment dev|prod [--mode read|write] [--ttl 5m|1h|24h|SECONDS] [--label TEXT] --yes --json\n" +
    "  The connection URI is shown once. Use it immediately, never store it in files, notes or source, and revoke it when finished.",
  "database access list":
    "ohmyhost database access list --project ULID [--environment dev|prod] --json",
  "database access revoke":
    "ohmyhost database access revoke --project ULID --access ULID --yes --json",
  "database psql":
    "ohmyhost database psql --project ULID --environment dev|prod [--mode read|write] [--ttl 5m|1h|24h|SECONDS] [--json] (starts local psql with a temporary credential and revokes it on exit)",
  link: "ohmyhost link --project ULID --repository-owner OWNER --repository-name REPOSITORY --idempotency-key KEY --json (uses the workspace GitHub connection and waits for the source-link operation)",
  "source auto-deploy set":
    "ohmyhost source auto-deploy set --project ULID --branch BRANCH --enabled true|false --idempotency-key KEY --json",
  "source auto-deploy status": "ohmyhost source auto-deploy status --project ULID --json",
  "domain cloudflare authorize":
    "ohmyhost domain cloudflare authorize --project ULID --zone ZONE --idempotency-key KEY --json",
  "domain cloudflare status": "ohmyhost domain cloudflare status --project ULID --json",
  "domain cloudflare apply":
    "ohmyhost domain cloudflare apply --project ULID --idempotency-key KEY --yes --wait --json",
  "domain paid plan": "ohmyhost domain paid plan --project ULID --hostname HOST --json",
  "domain paid apply":
    "ohmyhost domain paid apply --project ULID --hostname HOST --idempotency-key KEY --yes --json",
  "domain paid status": "ohmyhost domain paid status --project ULID --json",
  "domain paid delete":
    "ohmyhost domain paid delete --project ULID --hostname HOST --idempotency-key KEY --yes --json",
  plan: "ohmyhost plan --project ULID --commit SHA [--environment dev|prod] --json",
  deploy:
    "ohmyhost deploy --project ULID (--plan-id ULID | --commit SHA [--environment dev|prod]) --idempotency-key KEY --yes [--wait] --json",
  logs: "ohmyhost logs OPERATION_ULID --follow --json",
  "deployment logs": "ohmyhost deployment logs --project ULID --deployment ULID --follow --json",
  "rollback plan": "ohmyhost rollback plan --project ULID --deployment DEPLOYMENT_ULID --json",
  rollback:
    "ohmyhost rollback --project ULID --deployment DEPLOYMENT_ULID --if-match ETAG --confirmation-token TOKEN --idempotency-key KEY --yes --json",
  "deployment promote plan":
    "ohmyhost deployment promote plan --project ULID --deployment DEV_DEPLOYMENT_ULID --json",
  "deployment promote":
    "ohmyhost deployment promote --project ULID --deployment DEV_DEPLOYMENT_ULID --if-match ETAG --confirmation-token TOKEN --idempotency-key KEY --yes [--wait] --json",
  "delete plan": "ohmyhost delete plan --project ULID --json",
  delete:
    "ohmyhost delete --project ULID --if-match ETAG --confirmation-token TOKEN --idempotency-key KEY --yes --json",
  "secret list": "ohmyhost secret list --project ULID --environment ENVIRONMENT_ULID --json",
  "function runs":
    "ohmyhost function runs --project ULID --environment ENVIRONMENT_ULID [--limit 1-100] --json",
  "secret set":
    "printf '%s' \"$SECRET_VALUE\" | ohmyhost secret set NAME --project ULID --environment ENVIRONMENT_ULID --idempotency-key KEY [--profile-user USER_ID --profile-organization ULID | --token-user USER_ID --token-organization ULID] --stdin [--wait] --json (with --profile-user and --profile-organization the saved login that runs it must belong to that user and organization; with --token-user and --token-organization it runs only with an OHMYHOST_TOKEN of that user and organization, never with a saved login)",
  "secret delete":
    "ohmyhost secret delete NAME --project ULID --environment ENVIRONMENT_ULID --idempotency-key KEY [--wait] --json",
  "mail setup":
    "ohmyhost mail setup --project ULID --environment ULID --domain DOMAIN --sending true --receiving false --idempotency-key KEY --json",
  "mail status": "ohmyhost mail status --project ULID --environment ULID --json",
  "mail webhook set":
    "ohmyhost mail webhook set --project ULID --environment ULID --url HTTPS_URL --idempotency-key KEY --json",
  "mail webhook verify":
    "ohmyhost mail webhook verify --project ULID --environment ULID --idempotency-key KEY --json",
  "mail webhook disable":
    "ohmyhost mail webhook disable --project ULID --environment ULID --idempotency-key KEY --json",
  "mail messages list":
    "ohmyhost mail messages list --project ULID --environment ULID [--after ULID] --json",
  "mail messages get":
    "ohmyhost mail messages get --project ULID --environment ULID --message ULID --json",
  "mail messages retry":
    "ohmyhost mail messages retry --project ULID --environment ULID --message ULID --idempotency-key KEY --json",
  "mail domain set":
    "ohmyhost mail domain set --project ULID --environment ULID --domain DOMAIN --sending true --receiving false --idempotency-key KEY --json",
  "mail domain status": "ohmyhost mail domain status --project ULID --environment ULID --json",
  "mail domain delete":
    "ohmyhost mail domain delete --project ULID --environment ULID --idempotency-key KEY --yes --json",
} satisfies Readonly<Record<CustomerCommandLabel, string>>);

const HELP_COMMANDS = Object.freeze(
  Object.entries(HELP_USAGE).map(([command, usage]) => Object.freeze({ command, usage })),
);

export const cliMetadataResult = (kind: "help" | "version", topic?: string): CliResult =>
  kind === "help"
    ? success("help", {
        status: "succeeded",
        cli_version: CLI_VERSION,
        usage: "ohmyhost <command> [options] [--profile-name NAME] --json",
        environment:
          "OHMYHOST_ENVIRONMENT=development|production (default: production); OHMYHOST_PROFILE=NAME binds this process to one saved login",
        commands: HELP_COMMANDS.filter((entry) => !topic || entry.command === topic),
      })
    : success("version", { status: "succeeded", cli_version: CLI_VERSION });

class ProductCliFailure extends Error {
  public constructor(
    public readonly exitCode: number,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly suggestedAction: string,
    public readonly operation?: ReturnType<typeof parseOperation>,
  ) {
    super(code);
    this.name = "ProductCliFailure";
  }
}

export class ProductCli {
  /** The saved login of this run; binding a login without organization replaces it. */
  #profile: LocalProfile | undefined;

  public constructor(private readonly dependencies: ProductCliDependencies) {
    this.#profile = dependencies.profile;
  }

  public async run(
    argv: readonly string[],
    signal = new AbortController().signal,
  ): Promise<CliResult> {
    let command: ProductCliCommand;
    try {
      command = parseProductCliCommand(argv);
    } catch (error) {
      if (error instanceof InvalidCommandError) {
        return failure(
          recognizedCommandLabel(argv),
          2,
          "invalid_command",
          false,
          "Check 'ohmyhost --help'.",
        );
      }
      this.recordDiagnostic({
        category: "internal",
        subsystem: "parser",
        errorKind: "unexpected",
      });
      return failure("unknown", 1, "internal_error", false, "Retry the command.");
    }
    return this.runCommand(command, signal);
  }

  public async runCommand(
    command: ProductCliCommand,
    signal = new AbortController().signal,
  ): Promise<CliResult> {
    const name = parsedCommandName(command);
    try {
      throwIfAborted(signal);
      if (command.kind === "help" || command.kind === "version")
        return cliMetadataResult(command.kind, command.kind === "help" ? command.topic : undefined);
      if (command.kind === "init") throw new ProviderCapabilityBlockedError();
      if (
        this.dependencies.apiToken !== undefined &&
        (command.kind === "organization-create" ||
          command.kind === "organization-list" ||
          command.kind === "organization-use")
      ) {
        // A user API token is bound to one workspace and cannot read the account profile.
        throw new InteractiveSessionRequiredError();
      }
      if (command.kind === "profile-list") return await this.listProfiles();
      if (command.kind === "login")
        return await this.login(command.organizationId, command.userId, signal);
      if (command.kind === "logout") {
        return await this.logout(command.credentialStore, command.revoke, signal);
      }
      if (command.kind === "github-connect" || command.kind === "github-status") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        if (command.kind === "github-status") {
          const github = parseGithubOrganizationConnectionStatus(
            await api.getGithubConnection(command.organizationId),
          );
          if (
            github.connection !== null &&
            github.connection.organization_id !== command.organizationId
          )
            throw new ResponseContractError();
          return success(name, {
            status: github.status,
            github,
            ...(github.status === "connected"
              ? {}
              : { next_action: this.githubConnectAction(command.organizationId) }),
          });
        }
        const authorization = parseGithubConnectionAuthorization(await api.connectGithub(command));
        if (
          authorization.connection !== null &&
          authorization.connection.organization_id !== command.organizationId
        )
          throw new ResponseContractError();
        return success(name, {
          status: authorization.status,
          authorization,
          ...(authorization.status === "connected"
            ? {}
            : {
                next_action:
                  authorization.status === "pending"
                    ? "Open authorization_url in your GitHub profile, then repeat this exact command and key to observe the connection."
                    : authorization.status === "authorizing"
                      ? "GitHub authorization is processing. Repeat this exact command and key; do not replay the callback."
                      : "Resolve last_failure, then run github connect for this same workspace with a new idempotency key.",
              }),
        });
      }
      if (command.kind === "whoami") return await this.getCurrentIdentity(command, signal);
      if (
        command.kind === "token-create" ||
        command.kind === "token-list" ||
        command.kind === "token-revoke"
      ) {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        if (command.kind === "token-list")
          return success(name, {
            status: "listed",
            tokens: parseUserApiKeyPage(await api.listUserApiKeys(command)),
          });
        if (command.kind === "token-revoke") {
          await api.revokeUserApiKey(command);
          return success(name, { status: "revoked", key_id: command.keyId });
        }
        const file = await prepareUserTokenFile(command.outputPath);
        try {
          return success(name, {
            status: "stored",
            ...(await file.save(await api.createUserApiKey(command))),
          });
        } finally {
          await file.close();
        }
      }
      if (command.kind === "billing-recharge-get" || command.kind === "billing-recharge-set") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const recharge =
          command.kind === "billing-recharge-get"
            ? await api.getBillingRecharge(command.organizationId)
            : await api.configureBillingRecharge(command);
        try {
          assertRecharge(recharge);
        } catch {
          throw new ResponseContractError();
        }
        return success(name, { status: "succeeded", recharge });
      }
      if (
        command.kind === "billing-checkout" ||
        command.kind === "billing-status" ||
        command.kind === "billing-portal"
      ) {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const result =
          command.kind === "billing-checkout"
            ? await api.createBillingCheckout(command)
            : command.kind === "billing-status"
              ? await api.getBillingCheckout(command)
              : await api.createBillingPortal(command.organizationId);
        try {
          if (command.kind === "billing-portal") assertBillingPortal(result);
          else assertBillingCheckout(result);
        } catch {
          throw new ResponseContractError();
        }
        return success(name, { status: "succeeded", billing: result });
      }
      if (command.kind === "referral-link") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const referral = parseOrganizationReferral(
          await api.getOrganizationReferral(command.organizationId),
        );
        return success("referral link", { status: "succeeded", referral });
      }
      if (command.kind === "credits-account") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const account = await api.getOrganizationAccount(command.organizationId);
        assertOrganizationAccount(account);
        return success("credits account", { status: "succeeded", account });
      }
      if (command.kind === "credits-balance") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        return success("credits balance", {
          status: "succeeded",
          credits: parseOrganizationCredits(
            await api.getOrganizationCredits(command.organizationId),
          ),
        });
      }
      if (command.kind === "credits-usage") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const usage = await api.getOrganizationCreditUsage(command);
        try {
          assertOrganizationCreditUsage(usage);
        } catch {
          throw new ResponseContractError();
        }
        return success("credits usage", { status: "succeeded", usage });
      }
      if (command.kind === "budget-get" || command.kind === "budget-set") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const value =
          command.kind === "budget-get"
            ? await api.getProjectCreditBudget(command.projectId)
            : await api.setProjectCreditBudget(command);
        return success(command.kind === "budget-get" ? "budget get" : "budget set", {
          status: "succeeded",
          budget: parseProjectCreditBudget(value),
        });
      }
      if (command.kind === "organization-create") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const organization = parseOrganization(
          await api.createOrganization({
            name: command.name,
            ...(command.signupSource === undefined ? {} : { signupSource: command.signupSource }),
            idempotencyKey: command.idempotencyKey,
          }),
        );
        const selection = chooseWorkspace(
          (await api.getAccountProfile()).organizations,
          organization.id,
        );
        if (selection.outcome !== "selected")
          throw new ProductCliFailure(
            2,
            "organization_not_found",
            true,
            `The new workspace is not yet readable for this account. Run '${this.dependencies.commandPrefix} organization use --organization ${organization.id} --json' again.`,
          );
        const current = this.#profile;
        // A login in another organization keeps it: the new workspace gets its own login, so no
        // other agent that uses this login is moved into the new workspace.
        if (
          current !== undefined &&
          current.organizationId !== null &&
          current.organizationId !== organization.id
        )
          return success("organization create", {
            status: "succeeded",
            organization,
            selected: current.organizationId,
            profile: publicProfile(current),
            next_action: `Run '${this.dependencies.commandPrefix} login --organization ${organization.id} --user ${current.userId} --json' to add a login for the new workspace as the same user; profile ${current.name} stays in organization ${current.organizationId}.`,
          });
        // A created workspace is only usable once it is in the access token, so bind it now.
        const profile = await this.bindOrganization(selection.organization, signal);
        return success("organization create", {
          status: "succeeded",
          organization,
          selected: organization.id,
          profile: publicProfile(profile),
          next_action: `Run '${this.dependencies.commandPrefix} whoami --json' to confirm the selected workspace, then create a project.`,
          ...(await this.githubNextAction(
            await this.authenticatedApi(command.credentialStore, signal),
            organization.id,
          )),
        });
      }
      if (command.kind === "organization-list") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const account = await api.getAccountProfile();
        return success("organization list", {
          status: "listed",
          organizations: account.organizations.map(publicWorkspace),
          selected: this.#profile?.organizationId ?? null,
        });
      }
      if (command.kind === "organization-use") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const selection = chooseWorkspace(
          (await api.getAccountProfile()).organizations,
          command.organizationId,
        );
        if (selection.outcome !== "selected") throw this.unknownWorkspace(selection);
        const profile = await this.bindOrganization(selection.organization, signal);
        return success("organization use", {
          status: "selected",
          organization: publicWorkspace(selection.organization),
          selected: selection.organization.id,
          profile: publicProfile(profile),
          ...(await this.githubNextAction(
            await this.authenticatedApi(command.credentialStore, signal),
            selection.organization.id,
          )),
        });
      }
      if (command.kind === "operation-get") {
        return await this.getOperation(command, signal);
      }
      if (command.kind === "operation-reconcile") {
        return await this.reconcileOperation(command, signal);
      }
      if (command.kind === "export-create") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const password = await this.dependencies.readSecretValue(signal);
        if (password.trim().length === 0 || new TextEncoder().encode(password).length > 1024)
          throw new SecretInputError();
        const operation = parseOperation(
          await api.createProjectExport({
            projectId: command.projectId,
            idempotencyKey: command.idempotencyKey,
            password,
          }),
        );
        return success("export create", { status: operation.state, operation });
      }
      if (command.kind === "export-get") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const result = await api.getProjectExport({
          projectId: command.projectId,
          exportId: command.exportId,
        });
        assertProjectExport(result);
        return success("export get", { status: result.state, export: result });
      }
      if (command.kind === "feedback-status") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const feedback = await api.getFeedback(command.feedbackId, command.cursor);
        return success("feedback status", { status: "succeeded", feedback });
      }
      if (command.kind === "feedback-submit") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        return success("feedback submit", {
          status: "succeeded",
          feedback: await api.submitFeedback(command),
        });
      }
      if (command.kind === "project-create") return await this.createProject(command, signal);
      if (command.kind === "project-list") return await this.listProjects(command, signal);
      if (command.kind === "project-handle-check")
        return await this.checkProjectHandle(command, signal);
      if (command.kind === "project-handle-set")
        return await this.changeProjectHandle(command, signal);
      if (command.kind === "database-compute-set") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        let operation = parseOperation(await api.changeDatabaseCompute(command));
        if (command.wait) operation = await this.waitForOperation(api, operation, signal);
        return success("database compute set", {
          status: command.wait ? "completed" : "accepted",
          operation,
        });
      }
      if (command.kind === "database-compute-get") {
        const api = await this.authenticatedApi(command.credentialStore, signal),
          compute = await api.getDatabaseCompute(command);
        assertDatabaseCompute(compute);
        return success("database compute get", { status: "succeeded", compute });
      }
      if (command.kind === "project-context") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const context = await api.getProjectContext(command.projectId);
        assertProjectContext(context);
        return success("project context", { status: "succeeded", context });
      }
      if (command.kind === "project-notes-set") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const notes = await api.setProjectNotes(command);
        assertProjectNotesReceipt(notes);
        return success("project notes set", { status: "succeeded", notes });
      }
      if (command.kind === "project-status") return await this.getProjectStatus(command, signal);
      if (command.kind === "project-dev-access-create")
        return await this.createDevAccessTicket(command, signal);
      if (command.kind === "project-flag-status" || command.kind === "project-flag-set") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const flag = parsePoweredByFlag(
          command.kind === "project-flag-status"
            ? await api.getPoweredByFlag(command.projectId)
            : await api.setPoweredByFlag(
                command.projectId,
                command.enabled,
                command.idempotencyKey,
              ),
        );
        return success(
          command.kind === "project-flag-status" ? "project flag status" : "project flag set",
          { status: "succeeded", flag },
        );
      }
      if (
        command.kind === "project-dev-share-link" ||
        command.kind === "project-dev-share-rotate" ||
        command.kind === "project-dev-share-revoke" ||
        command.kind === "project-dev-access-mode-set"
      ) {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const state = parseDevAccessState(
          command.kind === "project-dev-share-link"
            ? await api.ensureDevShareLink(command.projectId)
            : command.kind === "project-dev-share-rotate"
              ? await api.rotateDevShareLink(command.projectId, command.idempotencyKey)
              : command.kind === "project-dev-share-revoke"
                ? await api.revokeDevShareLink(command.projectId, command.idempotencyKey)
                : await api.setDevAccessMode(
                    command.projectId,
                    command.mode,
                    command.idempotencyKey,
                  ),
        );
        return success(
          command.kind === "project-dev-share-link"
            ? "project dev-share link"
            : command.kind === "project-dev-share-rotate"
              ? "project dev-share rotate"
              : command.kind === "project-dev-share-revoke"
                ? "project dev-share revoke"
                : "project dev-access mode",
          { status: "succeeded", state },
        );
      }
      if (command.kind === "database-write") {
        const file = await open(command.statementFile, "r"),
          buffer = Buffer.alloc(65_537);
        let statement: string;
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.size > 65_536) throw new InvalidCommandError();
          let length = 0;
          while (length < buffer.length) {
            const read = await file.read(buffer, length, buffer.length - length, null);
            if (read.bytesRead === 0) break;
            length += read.bytesRead;
          }
          if (length > 65_536) throw new InvalidCommandError();
          statement = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
        } finally {
          buffer.fill(0);
          await file.close();
        }
        const body = parseProjectDatabaseWrite({
          environment: command.environment,
          statement,
          parameters: command.parameters,
        });
        const api = await this.authenticatedApi(command.credentialStore, signal);
        const result = await api.writeProjectDatabase({
          ...body,
          projectId: command.projectId,
          idempotencyKey: command.idempotencyKey,
        });
        assertProjectDatabaseWriteReceipt(result);
        if (result.state === "failed")
          return {
            exitCode: 7,
            stdout: `${JSON.stringify({ version: 1, command: "database write", status: "error", operation_id: result.operation_id, error: result.error })}\n`,
            stderr: "",
          };
        return success("database write", {
          status: result.state,
          operation_id: result.operation_id,
          result,
        });
      }
      if (command.kind === "database-query")
        return await this.queryProjectDatabase(command, signal);
      if (command.kind === "database-access-create")
        return await this.createDatabaseAccess(command, signal);
      if (command.kind === "database-access-list")
        return await this.listDatabaseAccess(command, signal);
      if (command.kind === "database-access-revoke")
        return await this.revokeDatabaseAccess(command, signal);
      if (command.kind === "database-psql") return await this.runProjectPsql(command, signal);
      if (command.kind === "link") return await this.linkSource(command, signal);
      if (command.kind === "source-auto-deploy-set")
        return await this.configureAutoDeploy(command, signal);
      if (command.kind === "source-auto-deploy-status")
        return await this.getAutoDeploy(command, signal);
      if (command.kind === "domain-cloudflare-authorize")
        return await this.authorizeCloudflareDns(command, signal);
      if (command.kind === "domain-cloudflare-status")
        return await this.getCloudflareDnsStatus(command, signal);
      if (command.kind === "domain-cloudflare-apply")
        return await this.applyProjectDomains(command, signal);
      if (command.kind === "paid-domain-plan") return await this.planPaidDomain(command, signal);
      if (command.kind === "paid-domain-apply") return await this.applyPaidDomain(command, signal);
      if (command.kind === "paid-domain-status") return await this.getPaidDomain(command, signal);
      if (command.kind === "paid-domain-delete")
        return await this.deletePaidDomain(command, signal);
      if (command.kind === "plan") return await this.planDeployment(command, signal);
      if (command.kind === "deploy") return await this.deploy(command, signal);
      if (command.kind === "logs") return await this.logs(command, signal);
      if (command.kind === "deployment-logs") return await this.deploymentLogs(command, signal);
      if (command.kind === "rollback-plan") return await this.planRollback(command, signal);
      if (command.kind === "rollback") return await this.rollback(command, signal);
      if (command.kind === "promotion-plan") return await this.planPromotion(command, signal);
      if (command.kind === "promote") return await this.promote(command, signal);
      if (command.kind === "delete-plan") return await this.planDelete(command, signal);
      if (command.kind === "delete") return await this.deleteProject(command, signal);
      if (command.kind === "secret-list") return await this.listEnvironmentSecrets(command, signal);
      if (command.kind === "function-runs") return await this.listFunctionRuns(command, signal);
      if (command.kind === "secret-set") return await this.putEnvironmentSecret(command, signal);
      if (command.kind === "managed-mail") {
        const api = await this.authenticatedApi(command.credentialStore, signal);
        if (!api.managedMail) throw new Error("Mail unavailable");
        return success(command.label, { mail: await api.managedMail(command.request) });
      }
      return await this.deleteEnvironmentSecret(command, signal);
    } catch (error) {
      if (error instanceof UserTokenFileError)
        return failure(name, 3, error.code, false, error.message);
      if (error instanceof InteractiveSessionRequiredError)
        return failure(
          name,
          2,
          "interactive_login_required",
          false,
          `A user API token cannot create, list or select a workspace. Run '${this.dependencies.commandPrefix} login --json' in a process without OHMYHOST_TOKEN.`,
        );
      if (error instanceof ProfileLimitError)
        return failure(
          name,
          2,
          "profile_limit_reached",
          false,
          profileLimitAction(this.dependencies.commandPrefix),
        );
      this.recordDiagnostic(diagnosticDescriptor(error, signal));
      return classifyFailure(name, error, signal, this.context());
    }
  }

  private githubConnectAction(organizationId: string): string {
    return `Run '${this.dependencies.commandPrefix} github connect --organization ${organizationId} --idempotency-key KEY --json' once, then link repositories covered by the installation.`;
  }

  private async githubNextAction(
    api: Pick<ProductApi, "getGithubConnection">,
    organizationId: string,
  ): Promise<Readonly<Record<string, string>>> {
    // Optional onboarding guidance must not turn a completed login into failure when
    // a scoped key cannot read source connections or the status endpoint is unavailable.
    try {
      const github = parseGithubOrganizationConnectionStatus(
        await api.getGithubConnection(organizationId),
      );
      if (github.connection !== null && github.connection.organization_id !== organizationId)
        throw new ResponseContractError();
      return github.status === "connected"
        ? {}
        : { next_action: this.githubConnectAction(organizationId) };
    } catch {
      return {};
    }
  }

  private async getCurrentIdentity(
    command: Extract<ProductCliCommand, { kind: "whoami" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const identity = parseCurrentIdentity(await api.getCurrentIdentity());
    // A session signed in before a workspace could be selected carries none, and then every
    // project call answers with an empty page that reads like an empty account. Repair it here,
    // where an agent looks first, instead of leaving the emptiness to be misread later.
    if (identity.organization_ids.length > 0 || this.dependencies.apiToken !== undefined)
      return success("whoami", {
        status: "authenticated",
        identity,
        context: this.context(),
        ...(identity.organization_ids.length === 1 && identity.organization_ids[0] !== undefined
          ? await this.githubNextAction(api, identity.organization_ids[0])
          : {}),
      });
    const selection = chooseWorkspace((await api.getAccountProfile()).organizations, undefined);
    if (selection.outcome === "selected") {
      await this.bindOrganization(selection.organization, signal);
      return success("whoami", {
        status: "authenticated",
        identity: parseCurrentIdentity(await api.getCurrentIdentity()),
        organization: publicWorkspace(selection.organization),
        selected: selection.organization.id,
        context: this.context(),
        ...(await this.githubNextAction(api, selection.organization.id)),
      });
    }
    return success("whoami", {
      status: "authenticated",
      identity,
      context: this.context(),
      organizations:
        selection.outcome === "choice_required" ? selection.organizations.map(publicWorkspace) : [],
      next_action: this.workspaceAction(selection),
    });
  }

  /** Which account this run acts as, without any credential. */
  private context(): Readonly<Record<string, unknown>> {
    if (this.dependencies.apiToken !== undefined) return { credential: "environment_token" };
    return {
      credential: "profile",
      profile: this.#profile === undefined ? null : publicProfile(this.#profile),
    };
  }

  /** The next step for a login that has no organization yet. */
  private workspaceAction(selection: WorkspaceSelection): string {
    const prefix = this.dependencies.commandPrefix;
    const named = this.#profile === undefined ? "" : ` --profile-name ${this.#profile.name}`;
    return selection.outcome === "choice_required"
      ? `Ask the customer which workspace to use, then run '${prefix} organization use --organization ULID${named} --json'.`
      : `Run '${prefix} organization create --name NAME --idempotency-key KEY${named} --json' to create the first workspace.`;
  }

  private async listProfiles(): Promise<CliResult> {
    const profiles = this.dependencies.profiles;
    if (profiles === undefined) throw new ProviderCapabilityBlockedError();
    return success("profile list", {
      status: "listed",
      profiles: (await profiles.list()).map(publicProfile),
      bound: this.dependencies.profileBinding ?? null,
      environment_token: this.dependencies.apiToken !== undefined,
    });
  }

  private recordDiagnostic(
    event: Omit<Parameters<DiagnosticSink["record"]>[0], "correlationId">,
  ): void {
    try {
      this.dependencies.diagnosticSink.record({
        correlationId: this.dependencies.createCorrelationId(),
        ...event,
      });
    } catch {
      // Diagnostics are best-effort and must never replace the stable command result.
    }
  }

  // The reviewed boundary proof parses this signature, so keep its parameters brace-free.
  private async login(
    organizationId: string | undefined,
    expectedUserId: string | undefined,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const profiles = this.dependencies.profiles;
    const readIdentity = this.dependencies.currentIdentity;
    if (profiles === undefined || readIdentity === undefined)
      throw new ProviderCapabilityBlockedError();
    // A device code lives five minutes and the provider offers no way to lengthen it, so the
    // sign-in outlives the code instead: while this window lasts, a lapsed code is replaced.
    const signInDeadline = this.dependencies.now().getTime() + SIGN_IN_WINDOW_MS;
    let session = await this.dependencies.deviceFlow.authorize();
    await presentAuthorization(
      this.dependencies.deviceAuthorizationPresenter,
      session.authorization,
    );
    await this.dependencies.waitUntil(
      new Date(this.dependencies.now().getTime() + session.authorization.intervalSeconds * 1_000),
      signal,
    );
    for (;;) {
      throwIfAborted(signal);
      let result: DevicePollResult;
      try {
        result = await session.poll();
      } catch (error) {
        // A timer may fire a fraction before the instant it was given, and the session then
        // refuses the poll. That is not a failed sign-in: wait out the interval and ask again,
        // instead of telling the customer their authorization failed before anyone was asked.
        if (!(error instanceof WorkosContractError)) throw error;
        // The code aged out while the customer was still on their way. Nobody refused, so issue
        // the next one and show it, rather than ending a sign-in that can still succeed.
        if (error.code === "expired_token" && this.dependencies.now().getTime() < signInDeadline) {
          session = await this.dependencies.deviceFlow.authorize();
          await presentAuthorization(
            this.dependencies.deviceAuthorizationPresenter,
            session.authorization,
          );
          await this.dependencies.waitUntil(
            new Date(
              this.dependencies.now().getTime() + session.authorization.intervalSeconds * 1_000,
            ),
            signal,
          );
          continue;
        }
        if (error.code !== "poll_too_soon") throw error;
        await this.dependencies.waitUntil(
          new Date(
            this.dependencies.now().getTime() + session.authorization.intervalSeconds * 1_000,
          ),
          signal,
        );
        continue;
      }
      throwIfAborted(signal);
      if (result.state === "pending") {
        await this.dependencies.waitUntil(result.nextPollAt, signal);
        continue;
      }
      let expiresAt: string;
      try {
        expiresAt = resolveDeviceTokenExpiresAt(
          result.tokens.accessToken,
          result.tokens.expiresInSeconds,
          this.dependencies.now(),
        );
      } catch (error) {
        if (!(error instanceof DeviceTokenExpiryError)) throw error;
        throw new ProductCliFailure(
          4,
          "device_token_expiry_missing",
          false,
          "Run login again; the authorization response was incomplete.",
        );
      }
      // Nothing is stored before the browser's account is verified, so a wrong, refused or
      // cancelled sign-in leaves every saved login, and every command using one, as it was.
      const signedIn: CurrentCredential = {
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        expiresAt,
      };
      const account = await this.dependencies.accountProfile(async () => signedIn.accessToken);
      if (!isProfileUserId(account.userId)) throw this.unverifiedLogin();
      if (expectedUserId !== undefined && account.userId !== expectedUserId)
        throw new ProductCliFailure(
          4,
          "login_account_mismatch",
          false,
          `The browser signed in as user ${account.userId}, not ${expectedUserId}. Nothing was saved and every saved login is unchanged. Sign out of ohmyho.st in that browser or use the browser profile of ${expectedUserId}, then run '${this.dependencies.commandPrefix} login${organizationId === undefined ? "" : ` --organization ${organizationId}`} --user ${expectedUserId} --json' again.`,
        );
      const selection = chooseWorkspace(account.organizations, organizationId);
      if (selection.outcome === "not_a_member") throw this.unknownWorkspace(selection);
      // The workspace lives in the access token, so a chosen one is requested before storing.
      const credential =
        selection.outcome === "selected"
          ? await runBounded(
              (bounded) =>
                this.dependencies.tokenRefresher.refresh(
                  signedIn.refreshToken,
                  bounded,
                  selection.organization.workos_id,
                ),
              signal,
              this.dependencies.lifecycleTimeoutMs,
            )
          : signedIn;
      const identity = await readIdentity(async () => credential.accessToken);
      const scopedId =
        selection.outcome === "selected"
          ? selection.organization.id
          : (parseCurrentIdentity(identity).organization_ids[0] ?? null);
      const organization =
        scopedId === null
          ? null
          : account.organizations.find((candidate) => candidate.id === scopedId);
      if (organization === undefined) throw this.unverifiedLogin();
      try {
        assertVerifiedLogin(identity, account.userId, scopedId);
      } catch (error) {
        if (error instanceof AccountVerificationError) throw this.unverifiedLogin();
        throw error;
      }
      const login = {
        userId: account.userId,
        organizationId: scopedId,
        organizationName: organization?.name ?? null,
      };
      const profile: LocalProfile = {
        name: this.dependencies.profileName ?? defaultProfileName(await profiles.list(), login),
        ...login,
      };
      try {
        await profiles.save(
          profile,
          organization === null
            ? credential
            : {
                ...credential,
                workosOrganizationId: organization.workos_id,
                organizationId: organization.id,
              },
        );
      } catch (error) {
        if (!(error instanceof ProfileNameConflictError)) throw error;
        throw new ProductCliFailure(
          2,
          "profile_name_conflict",
          false,
          `The name ${profile.name} already belongs to the saved login of user ${error.profile.userId} in organization ${String(error.profile.organizationId ?? "none")}. Nothing was saved. Choose another --profile-name, or remove that login with '${this.dependencies.commandPrefix} logout --profile-name ${profile.name} --json' first.`,
        );
      }
      this.#profile = profile;
      const readGithubConnection = this.dependencies.githubConnectionStatus;
      if (organization !== null)
        return success("login", {
          status: "authenticated",
          organization: publicWorkspace(organization),
          profile: publicProfile(profile),
          ...(readGithubConnection === undefined
            ? {}
            : await this.githubNextAction(
                {
                  getGithubConnection: (selectedOrganizationId) =>
                    readGithubConnection(
                      async () => credential.accessToken,
                      selectedOrganizationId,
                    ),
                },
                organization.id,
              )),
        });
      return success("login", {
        status: "authenticated",
        organization: null,
        profile: publicProfile(profile),
        organizations:
          selection.outcome === "choice_required"
            ? selection.organizations.map(publicWorkspace)
            : [],
        next_action: this.workspaceAction(selection),
      });
    }
  }

  /** The provider answered with another account than the one this login requested. */
  private unverifiedLogin(): ProductCliFailure {
    return new ProductCliFailure(
      4,
      "login_verification_failed",
      true,
      `The signed-in account could not be verified; nothing was saved. Run '${this.dependencies.commandPrefix} login --json' again.`,
    );
  }

  /**
   * Bind the login of this run, which has no organization yet, to one of its user's organizations.
   * A login that already has one keeps it; another organization is its own login.
   */
  private async bindOrganization(
    organization: PublicWorkspace,
    signal: AbortSignal,
  ): Promise<LocalProfile> {
    const profiles = this.dependencies.profiles;
    const profile = this.#profile;
    if (profiles === undefined || profile === undefined)
      throw new InteractiveSessionRequiredError();
    let bound: LocalProfile;
    try {
      bound = await runBounded(
        (bounded) =>
          selectWorkspace(
            {
              store: profiles.credential(profile),
              refresher: this.dependencies.tokenRefresher,
              profiles,
              profile,
            },
            organization,
            bounded,
            (accessToken) =>
              this.dependencies.productApi(async () => accessToken).getCurrentIdentity(),
          ),
        signal,
        this.dependencies.lifecycleTimeoutMs,
      );
    } catch (error) {
      if (error instanceof AccountVerificationError) throw this.unverifiedLogin();
      if (!(error instanceof ProfileOrganizationFixedError)) throw error;
      throw new ProductCliFailure(
        2,
        "profile_organization_fixed",
        false,
        `Profile ${profile.name} stays signed in to organization ${String(profile.organizationId)}. Run '${this.dependencies.commandPrefix} login --organization ${organization.id} --user ${profile.userId} --json' to add a separate login for ${organization.id} as the same user; a saved login never switches organizations.`,
      );
    }
    this.#profile = bound;
    return bound;
  }

  private unknownWorkspace(selection: WorkspaceSelection): ProductCliFailure {
    return new ProductCliFailure(
      2,
      "organization_not_found",
      false,
      `You are not a member of that workspace. Run '${this.dependencies.commandPrefix} organization list --json' and choose one of ${String(selection.outcome === "not_a_member" ? selection.organizations.length : 0)}.`,
    );
  }

  private async logout(
    credentialStore: "native",
    revoke: boolean,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const store = this.store(credentialStore);
    const removed = this.#profile === undefined ? {} : { profile: publicProfile(this.#profile) };
    if (!revoke) {
      await this.forgetLogin(store);
      return success("logout", { status: "logged_out", ...removed });
    }
    const credential = await store.read();
    let revocationError: unknown;
    try {
      if (credential !== undefined) {
        await runBounded(
          (bounded) => this.dependencies.tokenRevoker.revoke(credential.refreshToken, bounded),
          signal,
          this.dependencies.lifecycleTimeoutMs,
        );
      }
    } catch (error) {
      revocationError = error;
    } finally {
      await this.forgetLogin(store);
    }
    if (revocationError !== undefined) {
      if (isCancellation(revocationError) && signal.aborted) throw revocationError;
      if (revocationError instanceof ProviderCapabilityBlockedError) {
        throw new ProductCliFailure(
          9,
          "blocked_prerequisite",
          false,
          "Remote token revocation is not available in this release.",
        );
      }
      if (isTimeout(revocationError)) {
        throw new ProductCliFailure(
          8,
          "request_timeout",
          true,
          "Remote revocation timed out; local credentials were removed.",
        );
      }
      if (revocationError instanceof LifecycleTransportError) {
        throw new ProductCliFailure(
          6,
          "token_revocation_failed",
          true,
          "Remote revocation failed; the local credential was removed.",
        );
      }
      throw revocationError;
    }
    return success("logout", { status: "logged_out", ...removed });
  }

  /** The credential store of this run's saved login; it follows a binding made during the run. */
  private store(kind: "native"): CredentialStore {
    const profiles = this.dependencies.profiles;
    if (profiles !== undefined && this.#profile !== undefined)
      return profiles.credential(this.#profile);
    if (this.dependencies.credentialStore === undefined)
      throw new ProductCliFailure(5, "authentication_required", false, this.loginAction());
    return this.dependencies.credentialStore(kind);
  }

  /** Removes only this run's saved login; every other saved login stays untouched. */
  private async forgetLogin(store: CredentialStore): Promise<void> {
    const profiles = this.dependencies.profiles;
    if (profiles !== undefined && this.#profile !== undefined) await profiles.remove(this.#profile);
    else await store.clear();
  }

  /** How to sign this run's login in again, naming its organization and alias when known. */
  private loginAction(): string {
    const profile = this.#profile;
    return `Run '${this.dependencies.commandPrefix} login${
      profile?.organizationId === undefined || profile.organizationId === null
        ? ""
        : ` --organization ${profile.organizationId}`
    }${profile === undefined ? "" : ` --profile-name ${profile.name}`} --json'.`;
  }

  private async getOperation(
    command: Extract<ProductCliCommand, { kind: "operation-get" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const operation = parseOperation(await api.getOperation(command.operationId));
    return success("operation get", { status: "succeeded", operation });
  }

  private async reconcileOperation(
    command: Extract<ProductCliCommand, { kind: "operation-reconcile" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const reconciliation = parseProviderReconciliationAttempt(
      await api.reconcileOperation({
        operationId: command.operationId,
        idempotencyKey: command.idempotencyKey,
      }),
    );
    return success("operation reconcile", { status: "accepted", reconciliation });
  }

  private async createProject(
    command: Extract<ProductCliCommand, { kind: "project-create" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const operation = parseOperation(
      await api.createProject({
        organizationId: command.organizationId,
        name: command.name,
        ...(command.dataMode === undefined ? {} : { dataMode: command.dataMode }),
        ...(command.devAccessMode === undefined ? {} : { devAccessMode: command.devAccessMode }),
        ...(command.region === undefined ? {} : { region: command.region }),
        idempotencyKey: command.idempotencyKey,
      }),
    );
    return success("project create", { status: "accepted", operation });
  }

  private async listProjects(
    command: Extract<ProductCliCommand, { kind: "project-list" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const projects = parseProjectPage(
      await api.listProjects({
        ...(command.cursor === undefined ? {} : { cursor: command.cursor }),
        limit: command.limit,
      }),
    );
    return success("project list", { status: "succeeded", projects });
  }

  private async changeProjectHandle(
    command: Extract<ProductCliCommand, { kind: "project-handle-set" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const operation = parseOperation(
      await api.changeProjectHandle({
        projectId: command.projectId,
        handle: command.handle,
        ifMatch: command.ifMatch,
        idempotencyKey: command.idempotencyKey,
      }),
    );
    return success("project handle set", { status: "accepted", operation });
  }

  private async checkProjectHandle(
    command: Extract<ProductCliCommand, { kind: "project-handle-check" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const handle = await api.checkProjectHandle({ handle: command.handle });
    return success("project handle check", { status: "succeeded", handle });
  }

  private async getProjectStatus(
    command: Extract<ProductCliCommand, { kind: "project-status" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const project = parseProjectStatus(await api.getProjectStatus(command.projectId));
    return success("project status", { status: "succeeded", project, context: this.context() });
  }

  private async createDevAccessTicket(
    command: Extract<ProductCliCommand, { kind: "project-dev-access-create" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const ticket = parseDevAccessTicket(await api.createDevAccessTicket(command.projectId));
    return success("project dev-access create", { status: "succeeded", ticket });
  }

  private async queryProjectDatabase(
    command: Extract<ProductCliCommand, { kind: "database-query" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const result = parseProjectDatabaseQuery(
      await api.queryProjectDatabase({
        projectId: command.projectId,
        environment: command.environment,
        statement: command.statement,
        parameters: command.parameters,
      }),
    );
    return success("database query", { status: "succeeded", result });
  }

  /** The credential crosses this process once; only its metadata is ever printed again. */
  private async createDatabaseAccess(
    command: Extract<ProductCliCommand, { kind: "database-access-create" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const access = await api.createProjectDatabaseAccess({
      projectId: command.projectId,
      environment: command.environment,
      mode: command.mode,
      ttlSeconds: command.ttlSeconds,
      label: command.label,
    });
    assertProjectDatabaseAccessCredential(access);
    return success("database access create", { status: "succeeded", access });
  }

  private async listDatabaseAccess(
    command: Extract<ProductCliCommand, { kind: "database-access-list" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const page = await api.listProjectDatabaseAccess({
      projectId: command.projectId,
      ...(command.environment === undefined ? {} : { environment: command.environment }),
    });
    assertProjectDatabaseAccessPage(page);
    return success("database access list", { status: "succeeded", access: page.items });
  }

  private async revokeDatabaseAccess(
    command: Extract<ProductCliCommand, { kind: "database-access-revoke" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const access = await api.revokeProjectDatabaseAccess({
      projectId: command.projectId,
      accessId: command.accessId,
    });
    assertProjectDatabaseAccess(access);
    return success("database access revoke", { status: "succeeded", access });
  }

  /** psql receives the password through its own environment; the URI is never printed. */
  private async runProjectPsql(
    command: Extract<ProductCliCommand, { kind: "database-psql" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const spawnPsql = this.dependencies.spawnPsql;
    if (spawnPsql === undefined) return psqlUnavailable();
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const credential = await api.createProjectDatabaseAccess({
      projectId: command.projectId,
      environment: command.environment,
      mode: command.mode,
      ttlSeconds: command.ttlSeconds,
      label: "psql",
    });
    assertProjectDatabaseAccessCredential(credential);
    const { connection_uri, psql_command, ...access } = credential;
    void connection_uri;
    void psql_command;
    let exitCode: number;
    try {
      exitCode = await spawnPsql({
        host: credential.host,
        user: credential.role_name,
        password: new URL(credential.connection_uri).password,
        database: credential.database,
        mode: credential.mode,
        signal,
      });
    } catch (error) {
      await this.revokeIssuedAccess(api, command.projectId, credential.access_id);
      if (error instanceof PsqlUnavailableError) return psqlUnavailable();
      throw error;
    }
    await this.revokeIssuedAccess(api, command.projectId, credential.access_id);
    if (exitCode === 0)
      return success("database psql", { status: "succeeded", access, exit_code: 0 });
    return {
      exitCode,
      stdout: `${JSON.stringify({
        version: 1,
        command: "database psql",
        status: "error",
        error: {
          code: "psql_failed",
          retryable: false,
          suggested_action:
            "Read the psql output above. The temporary credential was revoked; request a new one with 'ohmyhost database access create'.",
        },
      })}\n`,
      stderr: "",
    };
  }

  private async revokeIssuedAccess(
    api: ProductApi,
    projectId: string,
    accessId: string,
  ): Promise<void> {
    try {
      await api.revokeProjectDatabaseAccess({ projectId, accessId });
    } catch {
      // The credential expires on its own; a failed revoke must not hide the psql result.
    }
  }

  private async planPaidDomain(
    command: Extract<ProductCliCommand, { kind: "paid-domain-plan" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const plan = parsePaidDomainPlan(
      await api.planPaidDomain({ projectId: command.projectId, hostname: command.hostname }),
    );
    return success("domain paid plan", { status: "planned", plan });
  }

  private async applyPaidDomain(
    command: Extract<ProductCliCommand, { kind: "paid-domain-apply" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const domain = parsePaidDomain(
      await api.applyPaidDomain({
        projectId: command.projectId,
        hostname: command.hostname,
        idempotencyKey: command.idempotencyKey,
      }),
    );
    return success("domain paid apply", { status: domain.status, domain });
  }

  private async getPaidDomain(
    command: Extract<ProductCliCommand, { kind: "paid-domain-status" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const domain = parsePaidDomain(await api.getPaidDomain(command.projectId));
    return success("domain paid status", { status: domain.status, domain });
  }

  private async deletePaidDomain(
    command: Extract<ProductCliCommand, { kind: "paid-domain-delete" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const domain = parsePaidDomain(
      await api.deletePaidDomain({
        projectId: command.projectId,
        hostname: command.hostname,
        idempotencyKey: command.idempotencyKey,
      }),
    );
    return success("domain paid delete", { status: domain.status, domain });
  }

  private async linkSource(
    command: Extract<ProductCliCommand, { kind: "link" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const accepted = parseOperation(await api.linkSource(command));
    const operation = await this.waitForOperation(api, accepted, signal);
    const project = await api.getProjectStatus(command.projectId);
    parseProjectStatus(project);
    const source = project.source;
    if (
      project.project_id !== command.projectId ||
      source === null ||
      source.status !== "ready" ||
      source.repository_full_name.toLowerCase() !==
        `${command.repositoryOwner}/${command.repositoryName}`.toLowerCase()
    )
      throw new ResponseContractError();
    // The link names the organization the server authorized, so this checkout can be linked once
    // per organization and another account's link is never used by mistake.
    const [organizationId, ...others] = parseCurrentIdentity(
      await api.getCurrentIdentity(),
    ).organization_ids;
    if (organizationId === undefined || others.length > 0) throw new ResponseContractError();
    await this.dependencies.projectLinkStore.save({
      version: 2,
      api_origin: this.dependencies.productApiOrigin,
      organization_id: organizationId,
      project_id: command.projectId,
      installation_id: source.installation_id,
      repository_full_name: source.repository_full_name,
    });
    return success("link", { status: "completed", operation, organization_id: organizationId });
  }

  private async configureAutoDeploy(
    command: Extract<ProductCliCommand, { kind: "source-auto-deploy-set" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const autoDeploy = await api.configureAutoDeploy(command);
    return success("source auto-deploy set", { status: "configured", auto_deploy: autoDeploy });
  }

  private async getAutoDeploy(
    command: Extract<ProductCliCommand, { kind: "source-auto-deploy-status" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const autoDeploy = await api.getAutoDeploy(command.projectId);
    return success("source auto-deploy status", {
      status: autoDeploy.generation === 0 ? "not_configured" : "ready",
      auto_deploy: autoDeploy,
    });
  }

  private async authorizeCloudflareDns(
    command: Extract<ProductCliCommand, { kind: "domain-cloudflare-authorize" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const authorization = parseCloudflareDnsAuthorization(
      await api.authorizeCloudflareDns({
        projectId: command.projectId,
        zone: command.zone,
        idempotencyKey: command.idempotencyKey,
      }),
    );
    return success("domain cloudflare authorize", {
      status: "authorization_required",
      authorization,
    });
  }

  private async getCloudflareDnsStatus(
    command: Extract<ProductCliCommand, { kind: "domain-cloudflare-status" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const cloudflareDns = parseCloudflareDnsAuthorizationStatus(
      await api.getCloudflareDnsStatus(command.projectId),
    );
    return success("domain cloudflare status", {
      status: cloudflareDns.status,
      cloudflare_dns: cloudflareDns,
    });
  }

  private async applyProjectDomains(
    command: Extract<ProductCliCommand, { kind: "domain-cloudflare-apply" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const accepted = parseOperation(
      await api.applyProjectDomains({
        projectId: command.projectId,
        idempotencyKey: command.idempotencyKey,
      }),
    );
    const operation = await this.waitForOperation(api, accepted, signal);
    return success("domain cloudflare apply", { status: "completed", operation });
  }

  private async planDeployment(
    command: Extract<ProductCliCommand, { kind: "plan" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const plan = parseDeploymentPlan(await api.planDeployment(command));
    // Say which environment this plan changes and how the change reaches the live site.
    const notes =
      plan["environment"] === "prod"
        ? [
            `This plan builds straight into Prod (${String(plan["route"])}); Prod traffic switches once it is activated.`,
          ]
        : [
            `This plan updates Dev only (${String(plan["route"])}). To go live, deploy with --environment prod or promote the Dev deployment with '${this.dependencies.commandPrefix} deployment promote plan --project ULID --deployment DEV_DEPLOYMENT_ULID --json'.`,
          ];
    return success("plan", { status: "planned", plan, notes });
  }

  private async deploy(
    command: Extract<ProductCliCommand, { kind: "deploy" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    // With --commit the deploy plans first, so an approved deploy needs no separate plan step.
    const plan =
      command.commitSha === null
        ? null
        : parseDeploymentPlan(
            await api.planDeployment({
              projectId: command.projectId,
              commitSha: command.commitSha,
              environment: command.environment,
            }),
          );
    let operation = parseOperation(
      await api.createDeployment({
        projectId: command.projectId,
        planId: plan === null ? String(command.planId) : String(plan["id"]),
        idempotencyKey: command.idempotencyKey,
      }),
    );
    if (command.wait) operation = await this.waitForOperation(api, operation, signal);
    // Dev access follows the project-selected mode; the clean URL alone is insufficient when protected.
    const notes =
      operation.state === "succeeded"
        ? [
            `Check project status for dev_access_mode. For protected Dev, run '${this.dependencies.commandPrefix} project dev-share link --project ULID --json' and open or share its persistent share_url; public Dev opens directly.`,
          ]
        : [];
    return success("deploy", {
      status: command.wait ? "completed" : "accepted",
      operation,
      ...(plan === null ? {} : { plan }),
      ...(notes.length > 0 && plan?.["environment"] !== "prod" ? { notes } : {}),
    });
  }

  private async logs(
    command: Extract<ProductCliCommand, { kind: "logs" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    let eventCount = 0;
    for await (const event of await api.streamOperationEvents(command.operationId, signal)) {
      const parsed = parseOperationEvent(event);
      this.dependencies.operationEventSink?.write(`${JSON.stringify(parsed)}\n`);
      eventCount += 1;
      if (
        parsed["type"] === "OperationSucceeded" ||
        parsed["type"] === "OperationFailed" ||
        parsed["type"] === "OperationCancelled"
      ) {
        break;
      }
    }
    return success("logs", { status: "completed", event_count: eventCount });
  }
  private async deploymentLogs(
    command: Extract<ProductCliCommand, { kind: "deployment-logs" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    let count = 0;
    for await (const event of await api.streamDeploymentLogs(
      { projectId: command.projectId, deploymentId: command.deploymentId },
      signal,
    )) {
      this.dependencies.operationEventSink?.write(`${JSON.stringify(event)}\n`);
      count += 1;
    }
    return success("deployment logs", { status: "completed", event_count: count });
  }

  private async planRollback(
    command: Extract<ProductCliCommand, { kind: "rollback-plan" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    return success("rollback plan", {
      status: "planned",
      plan: parseGuardedActionPlan(await api.planRollback(command)),
    });
  }

  private async rollback(
    command: Extract<ProductCliCommand, { kind: "rollback" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const operation = parseOperation(await api.rollback(command));
    return success("rollback", { status: "accepted", operation });
  }

  private async planPromotion(
    command: Extract<ProductCliCommand, { kind: "promotion-plan" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    return success("deployment promote plan", {
      status: "planned",
      plan: parseGuardedActionPlan(await api.planPromotion(command)),
    });
  }

  private async promote(
    command: Extract<ProductCliCommand, { kind: "promote" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    let operation = parseOperation(await api.promote(command));
    if (command.wait) operation = await this.waitForOperation(api, operation, signal);
    return success("deployment promote", {
      status: command.wait ? "completed" : "accepted",
      operation,
    });
  }

  private async planDelete(
    command: Extract<ProductCliCommand, { kind: "delete-plan" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    return success("delete plan", {
      status: "planned",
      plan: parseGuardedActionPlan(await api.planDelete(command.projectId)),
    });
  }

  private async deleteProject(
    command: Extract<ProductCliCommand, { kind: "delete" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const operation = parseOperation(await api.deleteProject(command));
    return success("delete", { status: "accepted", operation });
  }

  private async listEnvironmentSecrets(
    command: Extract<ProductCliCommand, { kind: "secret-list" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const page = parseEnvironmentSecretPage(
      await api.listEnvironmentSecrets({
        projectId: command.projectId,
        environmentId: command.environmentId,
      }),
    );
    return success("secret list", { status: "listed", secrets: page.items });
  }

  private async listFunctionRuns(
    command: Extract<ProductCliCommand, { kind: "function-runs" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const page = parseFunctionRunPage(
      await api.listFunctionRuns({
        projectId: command.projectId,
        environmentId: command.environmentId,
        limit: command.limit,
      }),
    );
    return success("function runs", { status: "listed", runs: page.items });
  }

  private async putEnvironmentSecret(
    command: Extract<ProductCliCommand, { kind: "secret-set" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const value = await this.dependencies.readSecretValue(signal);
    const valueBytes = new TextEncoder().encode(value);
    if (valueBytes.byteLength === 0 || valueBytes.byteLength > 5_120) {
      valueBytes.fill(0);
      throw new SecretInputError();
    }
    try {
      const secret = parseEnvironmentSecret(
        await api.putEnvironmentSecret({
          projectId: command.projectId,
          environmentId: command.environmentId,
          name: command.name,
          value,
          idempotencyKey: command.idempotencyKey,
        }),
      );
      const completed = command.wait
        ? await this.waitForSecretDelivery(
            api,
            command.projectId,
            command.environmentId,
            secret,
            signal,
          )
        : secret;
      return success("secret set", {
        status: command.wait ? "ready" : "stored",
        secret: completed,
      });
    } finally {
      valueBytes.fill(0);
    }
  }

  private async deleteEnvironmentSecret(
    command: Extract<ProductCliCommand, { kind: "secret-delete" }>,
    signal: AbortSignal,
  ): Promise<CliResult> {
    const api = await this.authenticatedApi(command.credentialStore, signal);
    const deleted = parseEnvironmentSecretDeletion(
      await api.deleteEnvironmentSecret({
        projectId: command.projectId,
        environmentId: command.environmentId,
        name: command.name,
        idempotencyKey: command.idempotencyKey,
      }),
    );
    const delivery = command.wait
      ? await this.waitForSecretDelivery(
          api,
          command.projectId,
          command.environmentId,
          { desired_generation: deleted.desired_generation },
          signal,
        )
      : deleted;
    return success("secret delete", {
      status: command.wait ? "ready" : deleted.status,
      secret: { name: deleted.name, ...secretDeliveryProjection(delivery) },
    });
  }

  private async waitForSecretDelivery(
    api: ProductApi,
    projectId: string,
    environmentId: string,
    stored: Readonly<{ desired_generation: number }> | PublicEnvironmentSecret,
    signal: AbortSignal,
  ) {
    const desiredGeneration = stored.desired_generation;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const page = parseEnvironmentSecretPage(
        await api.listEnvironmentSecrets({ projectId, environmentId }),
      );
      if (page.last_error !== null || page.delivery_state === "failed") {
        throw new ProductCliFailure(
          10,
          "secret_delivery_failed",
          true,
          "Inspect secret metadata and deployment logs, then retry reconciliation.",
        );
      }
      if (
        page.delivery_state === "ready" &&
        page.desired_generation >= desiredGeneration &&
        page.applied_generation >= desiredGeneration
      ) {
        // Every item carries the environment's generations; only the item with the stored
        // secret's name describes the secret that was just set. A deletion has no item left
        // and reads the environment delivery state instead.
        if (!("name" in stored)) return page;
        return (
          page.items.find((secret) => secret.name === stored.name) ?? {
            ...stored,
            desired_generation: page.desired_generation,
            applied_generation: page.applied_generation,
            delivery_state: page.delivery_state,
          }
        );
      }
      await this.dependencies.waitUntil(
        new Date(this.dependencies.now().getTime() + 1_000),
        signal,
      );
    }
    throw new ProductCliFailure(
      8,
      "secret_delivery_wait_timeout",
      true,
      "Run 'ohmyhost secret list --json' to inspect delivery metadata.",
    );
  }

  private async waitForOperation(
    api: ProductApi,
    initial: ReturnType<typeof parseOperation>,
    signal: AbortSignal,
  ): Promise<ReturnType<typeof parseOperation>> {
    let operation = initial;
    for (
      let attempt = 0;
      attempt < 120 &&
      (operation.state === "queued" || operation.state === "running") &&
      operation.reconciliation?.state !== "required";
      attempt += 1
    ) {
      await this.dependencies.waitUntil(
        new Date(this.dependencies.now().getTime() + 1_000),
        signal,
      );
      operation = parseOperation(await api.getOperation(operation.id));
    }
    if (operation.reconciliation?.state === "required")
      throw new ProductCliFailure(
        10,
        "operation_reconciliation_required",
        false,
        `${operation.reconciliation.suggested_action} Inspect 'ohmyhost operation get ${operation.id} --json' and use 'ohmyhost operation reconcile' after confirmation.`,
        operation,
      );
    if (operation.state === "queued" || operation.state === "running")
      throw new ProductCliFailure(
        8,
        "operation_wait_timeout",
        true,
        `Run 'ohmyhost operation get ${operation.id} --json' to inspect the existing operation before resubmitting a mutation.`,
        operation,
      );
    if (operation.state === "failed" && operation.error !== undefined)
      throw new ProductCliFailure(
        10,
        operation.error.code,
        operation.error.retryable,
        operation.error.suggested_action,
        operation,
      );
    if (operation.state === "cancelled")
      throw new ProductCliFailure(
        10,
        "operation_not_succeeded",
        false,
        `The operation was cancelled. Inspect 'ohmyhost operation get ${operation.id} --json' before creating a new plan.`,
        operation,
      );
    return operation;
  }

  private async authenticatedApi(
    credentialStore: "native",
    signal: AbortSignal,
  ): Promise<ProductApi> {
    await this.authenticatedToken(credentialStore, signal);
    return this.dependencies.productApi(() => this.authenticatedToken(credentialStore, signal));
  }

  private async authenticatedToken(
    credentialStore: "native",
    signal: AbortSignal,
  ): Promise<string> {
    if (this.dependencies.apiToken !== undefined) return this.dependencies.apiToken;
    const store = this.store(credentialStore);
    const stored = await store.read();
    if (stored === undefined) {
      throw new ProductCliFailure(5, "authentication_required", false, this.loginAction());
    }
    let refresh: { readonly credential: CurrentCredential; readonly refreshed: boolean };
    try {
      refresh = await this.refreshIfExpired(stored, signal);
    } catch (error) {
      if (!(error instanceof TokenRefreshRejectedError)) throw error;
      // The provider ended this login; only this saved login is removed.
      await this.forgetLogin(store);
      throw new ProductCliFailure(5, "authentication_required", false, this.loginAction());
    }
    if (refresh.refreshed) await store.replace(refresh.credential);
    return refresh.credential.accessToken;
  }

  private async refreshIfExpired(
    credential: StoredCredential,
    signal: AbortSignal,
  ): Promise<{ readonly credential: CurrentCredential; readonly refreshed: boolean }> {
    const expiresAt = credential.expiresAt === undefined ? NaN : Date.parse(credential.expiresAt);
    if (
      Number.isFinite(expiresAt) &&
      expiresAt > this.dependencies.now().getTime() + this.dependencies.lifecycleTimeoutMs
    ) {
      return {
        credential: {
          accessToken: credential.accessToken,
          refreshToken: credential.refreshToken,
          expiresAt: credential.expiresAt as string,
          ...workspaceOf(credential),
        },
        refreshed: false,
      };
    }
    try {
      const refreshed = await runBounded(
        (bounded) =>
          this.dependencies.tokenRefresher.refresh(
            credential.refreshToken,
            bounded,
            credential.workosOrganizationId,
          ),
        signal,
        this.dependencies.lifecycleTimeoutMs,
      );
      const refreshedExpiry = Date.parse(refreshed.expiresAt);
      if (
        !Number.isFinite(refreshedExpiry) ||
        refreshedExpiry <= this.dependencies.now().getTime()
      ) {
        throw new Error("invalid refreshed expiry");
      }
      // WorkOS returns a bare credential; the selection only survives if we carry it forward.
      // WorkOS returns a bare credential; the selection only survives if we carry it forward.
      return { credential: { ...refreshed, ...workspaceOf(credential) }, refreshed: true };
    } catch (error) {
      if (isCancellation(error) && signal.aborted) throw error;
      if (error instanceof ProviderCapabilityBlockedError) {
        throw new ProductCliFailure(
          9,
          "blocked_prerequisite",
          false,
          "Token refresh is not available in this release; run 'ohmyhost login'.",
        );
      }
      if (isTimeout(error)) {
        throw new ProductCliFailure(8, "request_timeout", true, "Retry the command.");
      }
      if (error instanceof LifecycleTransportError) {
        throw new ProductCliFailure(
          5,
          "token_refresh_failed",
          true,
          "Run 'ohmyhost login' if retrying does not succeed.",
        );
      }
      throw error;
    }
  }
}

function secretDeliveryProjection(value: {
  readonly desired_generation: number;
  readonly applied_generation: number;
  readonly delivery_state: "not_deployed" | "pending" | "ready" | "failed";
  readonly runtime_provider: "wfp" | null;
  readonly applied_secret_count: number;
  readonly last_error: string | null;
}) {
  return Object.freeze({
    desired_generation: value.desired_generation,
    applied_generation: value.applied_generation,
    delivery_state: value.delivery_state,
    runtime_provider: value.runtime_provider,
    applied_secret_count: value.applied_secret_count,
    last_error: value.last_error,
  });
}

const SIGN_IN_WINDOW_MS = 30 * 60 * 1_000;

const presentAuthorization = async (
  presenter: DeviceAuthorizationPresenter,
  authorization: DeviceAuthorization,
): Promise<void> =>
  presenter.present({
    verificationUri: redactVerificationUri(authorization.verificationUri),
    // One click instead of typing the code; absent when the provider omits it.
    ...(authorization.verificationUriComplete === undefined
      ? {}
      : { verificationUriComplete: authorization.verificationUriComplete }),
    userCode: authorization.userCode,
    expiresInSeconds: authorization.expiresInSeconds,
  });

const redactVerificationUri = (value: string): string => {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.toString();
};

/**
 * Answers that mean "this account cannot see or use that": they name the account that ran, so a
 * wrong saved login is told apart from a missing organization or GitHub authorization.
 */
export const ACCOUNT_SENSITIVE_PROBLEMS: ReadonlySet<string> = new Set([
  "resource_not_found",
  "forbidden",
  "organization_required",
  "github_connection_required",
  "github_connection_revoked",
  "repository_not_installed",
]);

/** The stable CLI answer for a failure outside a command run, such as choosing the account. */
export const classifyCliFailure = (
  command: RecognizedCommandLabel,
  error: unknown,
  signal: AbortSignal,
): CliResult => classifyFailure(command, error, signal);

const classifyFailure = (
  command: CommandLabel,
  error: unknown,
  signal: AbortSignal,
  actingAs?: Readonly<Record<string, unknown>>,
): CliResult => {
  if (signal.aborted || isCancellation(error)) {
    return failure(command, 130, "command_cancelled", true, "Run the command again.");
  }
  if (isTimeout(error)) {
    return failure(command, 8, "request_timeout", true, "Retry the command.");
  }
  if (error instanceof ProductCliFailure) {
    return failure(
      command,
      error.exitCode,
      error.code,
      error.retryable,
      error.suggestedAction,
      error.operation,
    );
  }
  if (error instanceof SecretInputError) {
    return failure(
      command,
      2,
      "secret_input_invalid",
      false,
      "Pipe a non-empty UTF-8 value of at most 5120 bytes through standard input.",
    );
  }
  if (error instanceof WorkosContractError) {
    if (error.code === "access_denied") {
      return failure(command, 4, "device_authorization_denied", false, "Run login again.");
    }
    if (error.code === "expired_token") {
      return failure(command, 4, "device_authorization_expired", false, "Run login again.");
    }
    return failure(command, 4, "device_authorization_failed", true, "Run login again.");
  }
  if (error instanceof CredentialStoreUnavailableError) {
    return failure(
      command,
      3,
      "credential_store_unavailable",
      true,
      "Unlock or repair the selected credential store and retry.",
    );
  }
  if (error instanceof ResponseContractError) {
    return failure(
      command,
      7,
      "response_contract_invalid",
      false,
      "Retry only after the client or server contract is repaired.",
    );
  }
  if (error instanceof PublicResponseTooLargeError) {
    return failure(
      command,
      7,
      "response_too_large",
      false,
      "Retry only after the remote response is repaired.",
    );
  }
  if (looksLikeProblem(error)) {
    try {
      const problem = parseSafeProblem(error);
      return failure(
        command,
        7,
        problem.code,
        problem.retryable,
        problem.suggestedAction,
        undefined,
        problem.retryAfterSeconds,
        problem.requestId,
        problem.docsUrl,
        ACCOUNT_SENSITIVE_PROBLEMS.has(problem.code) ? actingAs : undefined,
      );
    } catch {
      return failure(
        command,
        7,
        "response_contract_invalid",
        false,
        "Retry only after the client or server contract is repaired.",
      );
    }
  }
  if (looksLikeRemoteObject(error)) {
    return failure(
      command,
      7,
      "response_contract_invalid",
      false,
      "Retry only after the client or server contract is repaired.",
    );
  }
  if (error instanceof NetworkTransportError) {
    return failure(command, 8, "network_error", true, "Check connectivity and retry.");
  }
  return failure(command, 1, "internal_error", false, "Retry the command.");
};

const psqlUnavailable = (): CliResult =>
  failure(
    "database psql",
    9,
    "psql_unavailable",
    false,
    "Install the PostgreSQL client (psql) and make it available on PATH, or run 'ohmyhost database access create' and connect with your own SQL client.",
  );

const success = (command: CommandLabel, body: Readonly<Record<string, unknown>>): CliResult => ({
  exitCode: 0,
  stdout: `${JSON.stringify({ version: 1, command, ...body })}\n`,
  stderr: "",
});

const failure = (
  command: CommandLabel,
  exitCode: number,
  code: string,
  retryable: boolean,
  suggestedAction: string,
  operation?: ReturnType<typeof parseOperation>,
  retryAfterSeconds?: number,
  requestId?: string,
  docsUrl?: string,
  actingAs?: Readonly<Record<string, unknown>>,
): CliResult => {
  const document: CliErrorDocument = {
    version: 1,
    command,
    status: "error",
    ...(operation === undefined ? {} : { operation_id: operation.id }),
    error: {
      code,
      retryable,
      suggested_action: suggestedAction,
      ...(retryAfterSeconds === undefined ? {} : { retry_after_seconds: retryAfterSeconds }),
      ...(requestId === undefined ? {} : { request_id: requestId }),
      ...(docsUrl === undefined ? {} : { docs_url: docsUrl }),
      ...(operation?.error === undefined ? {} : { message: operation.error.message }),
      ...(actingAs === undefined ? {} : { acting_as: actingAs }),
    },
  };
  return { exitCode, stdout: `${JSON.stringify(document)}\n`, stderr: "" };
};

const parsedCommandName = (command: ProductCliCommand): CommandLabel => {
  if (command.kind === "export-create") return "export create";
  if (command.kind === "export-get") return "export get";
  if (command.kind === "token-create") return "token create";
  if (command.kind === "token-list") return "token list";
  if (command.kind === "token-revoke") return "token revoke";
  if (command.kind === "billing-recharge-get") return "billing recharge get";
  if (command.kind === "billing-recharge-set") return "billing recharge set";
  if (command.kind === "billing-checkout") return "billing checkout";
  if (command.kind === "billing-status") return "billing status";
  if (command.kind === "billing-portal") return "billing portal";
  if (command.kind === "credits-account") return "credits account";
  if (command.kind === "referral-link") return "referral link";
  if (command.kind === "credits-balance") return "credits balance";
  if (command.kind === "credits-usage") return "credits usage";
  if (command.kind === "budget-get") return "budget get";
  if (command.kind === "budget-set") return "budget set";
  if (command.kind === "operation-get") return "operation get";
  if (command.kind === "operation-reconcile") return "operation reconcile";
  if (command.kind === "feedback-submit") return "feedback submit";
  if (command.kind === "feedback-status") return "feedback status";
  if (command.kind === "project-create") return "project create";
  if (command.kind === "organization-create") return "organization create";
  if (command.kind === "organization-list") return "organization list";
  if (command.kind === "organization-use") return "organization use";
  if (command.kind === "github-connect") return "github connect";
  if (command.kind === "github-status") return "github status";
  if (command.kind === "project-list") return "project list";
  if (command.kind === "database-compute-set") return "database compute set";
  if (command.kind === "database-compute-get") return "database compute get";
  if (command.kind === "project-context") return "project context";
  if (command.kind === "project-notes-set") return "project notes set";
  if (command.kind === "project-status") return "project status";
  if (command.kind === "project-dev-access-create") return "project dev-access create";
  if (command.kind === "project-dev-share-link") return "project dev-share link";
  if (command.kind === "project-dev-share-rotate") return "project dev-share rotate";
  if (command.kind === "project-dev-share-revoke") return "project dev-share revoke";
  if (command.kind === "project-dev-access-mode-set") return "project dev-access mode";
  if (command.kind === "project-flag-status") return "project flag status";
  if (command.kind === "project-flag-set") return "project flag set";
  if (command.kind === "project-handle-check") return "project handle check";
  if (command.kind === "project-handle-set") return "project handle set";
  if (command.kind === "database-write") return "database write";
  if (command.kind === "database-query") return "database query";
  if (command.kind === "database-access-create") return "database access create";
  if (command.kind === "database-access-list") return "database access list";
  if (command.kind === "database-access-revoke") return "database access revoke";
  if (command.kind === "database-psql") return "database psql";
  if (command.kind === "source-auto-deploy-set") return "source auto-deploy set";
  if (command.kind === "source-auto-deploy-status") return "source auto-deploy status";
  if (command.kind === "domain-cloudflare-authorize") return "domain cloudflare authorize";
  if (command.kind === "domain-cloudflare-status") return "domain cloudflare status";
  if (command.kind === "domain-cloudflare-apply") return "domain cloudflare apply";
  if (command.kind === "paid-domain-plan") return "domain paid plan";
  if (command.kind === "paid-domain-apply") return "domain paid apply";
  if (command.kind === "paid-domain-status") return "domain paid status";
  if (command.kind === "paid-domain-delete") return "domain paid delete";
  if (command.kind === "rollback-plan") return "rollback plan";
  if (command.kind === "promotion-plan") return "deployment promote plan";
  if (command.kind === "deployment-logs") return "deployment logs";
  if (command.kind === "promote") return "deployment promote";
  if (command.kind === "delete-plan") return "delete plan";
  if (command.kind === "secret-list") return "secret list";
  if (command.kind === "function-runs") return "function runs";
  if (command.kind === "secret-set") return "secret set";
  if (command.kind === "secret-delete") return "secret delete";
  if (command.kind === "managed-mail") return command.label;
  if (command.kind === "profile-list") return "profile list";
  return command.kind;
};

const boundedSignal = (parent: AbortSignal, timeoutMs: number): AbortSignal =>
  AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]);

const runBounded = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parent: AbortSignal,
  timeoutMs: number,
): Promise<T> => {
  const signal = boundedSignal(parent, timeoutMs);
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    const abort = (): void => {
      cleanup();
      reject(signal.reason);
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    operation(signal).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
};

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw signal.reason;
};

const isCancellation = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

const isTimeout = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "TimeoutError";

const looksLikeProblem = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  ("code" in error || "status" in error || "suggested_action" in error);

const looksLikeRemoteObject = (error: unknown): boolean =>
  typeof error === "object" && error !== null && !(error instanceof Error);

const diagnosticDescriptor = (
  error: unknown,
  signal: AbortSignal,
): Omit<Parameters<DiagnosticSink["record"]>[0], "correlationId"> => {
  if (signal.aborted || isCancellation(error)) {
    return { category: "cancelled", subsystem: "runtime", errorKind: "cancelled" };
  }
  if (isTimeout(error)) {
    return { category: "timeout", subsystem: "runtime", errorKind: "timeout" };
  }
  if (error instanceof CredentialStoreUnavailableError) {
    return {
      category: "credential_store",
      subsystem: "credential_store",
      errorKind: "unavailable",
    };
  }
  if (error instanceof SecretInputError) {
    return { category: "configuration", subsystem: "runtime", errorKind: "invalid_response" };
  }
  if (error instanceof WorkosContractError) {
    return {
      category: "device_authorization",
      subsystem: "authentication",
      errorKind: "invalid_response",
    };
  }
  if (error instanceof ResponseContractError || error instanceof PublicResponseTooLargeError) {
    return { category: "response_contract", subsystem: "sdk", errorKind: "invalid_response" };
  }
  if (error instanceof NetworkTransportError) {
    return { category: "network", subsystem: "sdk", errorKind: "network_transport" };
  }
  if (
    error instanceof ProviderCapabilityBlockedError ||
    (error instanceof ProductCliFailure && error.code === "blocked_prerequisite")
  ) {
    return { category: "provider_blocked", subsystem: "lifecycle", errorKind: "blocked" };
  }
  if (error instanceof ProductCliFailure) {
    if (error.code === "request_timeout") {
      return { category: "timeout", subsystem: "lifecycle", errorKind: "timeout" };
    }
    if (error.code === "token_refresh_failed" || error.code === "token_revocation_failed") {
      return { category: "network", subsystem: "lifecycle", errorKind: "network_transport" };
    }
    if (error.code === "device_token_expiry_missing") {
      return {
        category: "response_contract",
        subsystem: "authentication",
        errorKind: "invalid_response",
      };
    }
    if (error.code === "authentication_required") {
      return {
        category: "credential_store",
        subsystem: "credential_store",
        errorKind: "unavailable",
      };
    }
  }
  if (looksLikeProblem(error)) {
    try {
      parseSafeProblem(error);
      return { category: "remote_problem", subsystem: "sdk", errorKind: "remote_problem" };
    } catch {
      return { category: "response_contract", subsystem: "sdk", errorKind: "invalid_response" };
    }
  }
  if (looksLikeRemoteObject(error)) {
    return { category: "response_contract", subsystem: "sdk", errorKind: "invalid_response" };
  }
  return { category: "internal", subsystem: "runtime", errorKind: "unexpected" };
};
