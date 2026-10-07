import { isUserSecretName } from "@ohmyhost/contracts/secret-names";
import {
  isProjectDataChangeKind,
  type ProjectDataChangeKind,
} from "@ohmyhost/contracts/project-data-changes";
import type { ManagedMailCommand } from "@ohmyhost/sdk-ts";
import { USER_API_KEY_ID } from "@ohmyhost/contracts/user-api-keys";
import { WORKOS_USER_API_KEY_PATTERN } from "@ohmyhost/workos-auth-contracts/user-api-keys";
import { isProfileName, isProfileUserId } from "./profile-store.js";
import {
  isManagedSourcePath,
  parseManagedSourceRequest,
  type ManagedSourceUploadRequest,
  type ManagedSourceRestoreRequest,
  type ManagedSourceInitializeRequest,
} from "@ohmyhost/contracts/managed-sources";
export type SourceCliCommand =
  | { readonly kind: "source-inspect"; readonly directory: string }
  | {
      readonly kind: "source-read";
      readonly action: "status" | "files" | "file" | "versions" | "diff" | "upload";
      readonly projectId: string;
      readonly commitSha?: string;
      readonly path?: string;
      readonly limit?: number;
      readonly beforeCommitSha?: string;
      readonly fromCommitSha?: string;
      readonly toCommitSha?: string;
      readonly operationId?: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "source-publish";
      readonly projectId: string;
      readonly directory: string;
      readonly request: ManagedSourceUploadRequest;
      readonly explicitExpectedCommit: boolean;
      readonly idempotencyKey: string;
      readonly wait: boolean;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "source-complete";
      readonly projectId: string;
      readonly directory: string;
      readonly operationId?: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "source-initialize";
      readonly projectId: string;
      readonly request: ManagedSourceInitializeRequest;
      readonly idempotencyKey: string;
      readonly wait: boolean;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "source-restore";
      readonly projectId: string;
      readonly request: ManagedSourceRestoreRequest;
      readonly idempotencyKey: string;
      readonly wait: boolean;
      readonly credentialStore: "native";
    };
export type ProductCliCommand =
  | SourceCliCommand
  | {
      readonly kind: "project-data-plan";
      readonly projectId: string;
      readonly change: ProjectDataChangeKind;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "project-data-change";
      readonly projectId: string;
      readonly change: ProjectDataChangeKind;
      readonly ifMatch: string;
      readonly confirmationToken: string;
      readonly idempotencyKey: string;
      readonly yes: true;
      readonly wait: boolean;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "github-connect";
      readonly organizationId: string;
      readonly idempotencyKey: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "github-status";
      readonly organizationId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "database-compute-set";
      readonly projectId: string;
      readonly environment: "dev" | "prod";
      readonly profile: "standard" | "performance";
      readonly idempotencyKey: string;
      readonly wait: boolean;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "database-compute-get";
      readonly projectId: string;
      readonly environment: "dev" | "prod";
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "project-context";
      readonly projectId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "project-notes-set";
      readonly projectId: string;
      readonly markdown: string;
      readonly expectedVersion: number;
      readonly idempotencyKey: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "export-create";
      readonly projectId: string;
      readonly idempotencyKey: string;
      readonly stdin: true;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "export-get";
      readonly projectId: string;
      readonly exportId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "token-create";
      readonly organizationId: string;
      readonly name: string;
      readonly idempotencyKey: string;
      readonly outputPath: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "token-list";
      readonly organizationId: string;
      readonly after?: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "token-revoke";
      readonly organizationId: string;
      readonly keyId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "feedback-submit";
      readonly report: import("@ohmyhost/sdk-ts").FeedbackSubmission;
      readonly idempotencyKey: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "feedback-status";
      readonly feedbackId: string;
      readonly cursor?: string;
      readonly credentialStore: "native";
    }
  | { kind: "billing-recharge-get"; organizationId: string; credentialStore: "native" }
  | ({ kind: "billing-recharge-set"; credentialStore: "native" } & {
      organizationId: string;
      enabled: boolean;
      monthlyLimitMinor: number;
      consent: "off_session_v1" | null;
      revision: number;
      idempotencyKey: string;
    })
  | {
      readonly kind: "billing-checkout";
      readonly organizationId: string;
      readonly offer: "topup" | "paid";
      readonly packs: number;
      readonly idempotencyKey: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "billing-status";
      readonly organizationId: string;
      readonly checkoutId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "billing-portal";
      readonly organizationId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "credits-usage";
      readonly organizationId: string;
      readonly month: string;
      readonly cursor?: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "credits-account";
      readonly organizationId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "referral-link";
      readonly organizationId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "credits-balance";
      readonly organizationId: string;
      readonly credentialStore: "native";
    }
  | { readonly kind: "budget-get"; readonly projectId: string; readonly credentialStore: "native" }
  | {
      readonly kind: "budget-set";
      readonly projectId: string;
      readonly amountMicros: string | null;
      readonly mode: "continue" | "stop";
      readonly idempotencyKey: string;
      readonly credentialStore: "native";
    }
  | {
      /** Moves a project to a chosen address once its gateways serve it. */
      readonly kind: "project-handle-set";
      readonly projectId: string;
      readonly handle: string;
      readonly ifMatch: string;
      readonly idempotencyKey: string;
      readonly credentialStore: "native";
    }
  | {
      /** Asks whether a project address is free; the candidate is sent exactly as the agent typed it. */
      readonly kind: "project-handle-check";
      readonly handle: string;
      readonly credentialStore: "native";
    }
  | { readonly kind: "help"; readonly topic?: string }
  | { readonly kind: "version" }
  | { readonly kind: "whoami"; readonly credentialStore: "native" }
  | {
      readonly kind: "organization-create";
      readonly signupSource?: string;
      readonly name: string;
      readonly idempotencyKey: string;
      readonly credentialStore: "native";
    }
  | { readonly kind: "organization-list"; readonly credentialStore: "native" }
  | {
      readonly kind: "organization-use";
      readonly organizationId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "init";
      readonly directory: string;
      readonly project?: string;
      readonly root?: string;
      /** The hosting region of the project the repository deploys to; `us` when unknown. */
      readonly region?: "us" | "eu";
      readonly dryRun: boolean;
    }
  | {
      readonly kind: "login";
      readonly organizationId?: string;
      /** The user the browser must sign in as; a different account stores nothing. */
      readonly userId?: string;
      readonly credentialStore: "native";
    }
  | { readonly kind: "profile-list" }
  | {
      readonly kind: "logout";
      readonly revoke: boolean;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "operation-get";
      readonly operationId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "operation-reconcile";
      readonly operationId: string;
      readonly idempotencyKey: string;
      readonly yes: true;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "project-create";
      readonly organizationId: string;
      readonly name: string;
      readonly dataMode?: "shared" | "isolated";
      readonly devAccessMode?: "protected" | "public";
      readonly region?: "us" | "eu";
      readonly idempotencyKey: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "project-list";
      readonly cursor?: string;
      readonly limit: number;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "project-status";
      readonly projectId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "project-dev-share-link";
      readonly projectId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "project-dev-share-rotate";
      readonly projectId: string;
      readonly idempotencyKey: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "project-dev-share-revoke";
      readonly projectId: string;
      readonly idempotencyKey: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "project-dev-access-mode-set";
      readonly projectId: string;
      readonly mode: "protected" | "public";
      readonly idempotencyKey: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "project-dev-access-create";
      readonly projectId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "project-flag-status";
      readonly projectId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "project-flag-set";
      readonly projectId: string;
      readonly enabled: boolean;
      readonly idempotencyKey: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "database-write";
      readonly projectId: string;
      readonly environment: "dev" | "prod";
      readonly statementFile: string;
      readonly parameters: readonly import("@ohmyhost/contracts/database-access").DatabaseJson[];
      readonly idempotencyKey: string;
      readonly yes: true;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "database-query";
      readonly environment: "dev" | "prod";
      readonly projectId: string;
      readonly statement: string;
      readonly parameters: readonly (string | number | boolean | null)[];
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "database-access-create";
      readonly projectId: string;
      readonly environment: "dev" | "prod";
      readonly mode: "read" | "write";
      readonly ttlSeconds: number;
      readonly label: string | null;
      readonly yes: true;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "database-access-list";
      readonly projectId: string;
      readonly environment?: "dev" | "prod";
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "database-access-revoke";
      readonly projectId: string;
      readonly accessId: string;
      readonly yes: true;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "database-psql";
      readonly projectId: string;
      readonly environment: "dev" | "prod";
      readonly mode: "read" | "write";
      readonly ttlSeconds: number;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "link";
      readonly projectId: string;
      readonly repositoryOwner: string;
      readonly repositoryName: string;
      readonly idempotencyKey: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "source-auto-deploy-set";
      readonly projectId: string;
      readonly branch: string;
      readonly enabled: boolean;
      readonly idempotencyKey: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "source-auto-deploy-status";
      readonly projectId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "plan";
      readonly projectId: string;
      readonly commitSha: string;
      readonly environment: "dev" | "prod";
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "deploy";
      readonly projectId: string;
      /** Exactly one of an existing plan or a commit that is planned first. */
      readonly planId: string | null;
      readonly commitSha: string | null;
      readonly environment: "dev" | "prod";
      readonly idempotencyKey: string;
      readonly yes: true;
      readonly wait: boolean;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "logs";
      readonly operationId: string;
      readonly follow: true;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "deployment-logs";
      readonly projectId: string;
      readonly deploymentId: string;
      readonly follow: true;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "rollback-plan";
      readonly projectId: string;
      readonly deploymentId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "rollback";
      readonly projectId: string;
      readonly deploymentId: string;
      readonly ifMatch: string;
      readonly confirmationToken: string;
      readonly idempotencyKey: string;
      readonly yes: true;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "promotion-plan";
      readonly projectId: string;
      readonly sourceDeploymentId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "promote";
      readonly projectId: string;
      readonly sourceDeploymentId: string;
      readonly ifMatch: string;
      readonly confirmationToken: string;
      readonly idempotencyKey: string;
      readonly yes: true;
      readonly wait: boolean;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "delete-plan";
      readonly projectId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "delete";
      readonly projectId: string;
      readonly ifMatch: string;
      readonly confirmationToken: string;
      readonly idempotencyKey: string;
      readonly yes: true;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "secret-list";
      readonly projectId: string;
      readonly environmentId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "function-runs";
      readonly projectId: string;
      readonly environmentId: string;
      readonly limit: number;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "secret-set";
      readonly projectId: string;
      readonly environmentId: string;
      readonly name: string;
      readonly idempotencyKey: string;
      readonly stdin: true;
      readonly wait: boolean;
      /** Handed over from an OHMYHOST_TOKEN process: only a key of this account may run it. */
      readonly environmentToken?: HandedAccount;
      /** Handed over for a saved login: the login that runs it must belong to this account. */
      readonly profileAccount?: HandedAccount;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "secret-delete";
      readonly projectId: string;
      readonly environmentId: string;
      readonly name: string;
      readonly idempotencyKey: string;
      readonly wait: boolean;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "managed-mail";
      readonly request: ManagedMailCommand;
      readonly label:
        | "mail domain set"
        | "mail domain status"
        | "mail domain delete"
        | "mail setup"
        | "mail status"
        | "mail webhook set"
        | "mail webhook verify"
        | "mail webhook disable"
        | "mail messages list"
        | "mail messages get"
        | "mail messages retry";
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "domain-cloudflare-authorize";
      readonly projectId: string;
      readonly zone: string;
      readonly idempotencyKey: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "domain-cloudflare-status";
      readonly projectId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "domain-cloudflare-apply";
      readonly projectId: string;
      readonly idempotencyKey: string;
      readonly yes: true;
      readonly wait: true;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "paid-domain-plan";
      readonly projectId: string;
      readonly hostname: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "paid-domain-status";
      readonly projectId: string;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "paid-domain-apply";
      readonly projectId: string;
      readonly hostname: string;
      readonly idempotencyKey: string;
      readonly yes: true;
      readonly credentialStore: "native";
    }
  | {
      readonly kind: "paid-domain-delete";
      readonly projectId: string;
      readonly hostname: string;
      readonly idempotencyKey: string;
      readonly yes: true;
      readonly credentialStore: "native";
    };

/**
 * Remove the global login selector from argv. Every authenticated command accepts it; `login` uses
 * the same flag to name the login it adds. The value is an alias, never a credential.
 */
export const extractProfileName = (
  argv: readonly string[],
): { readonly argv: readonly string[]; readonly profileName?: string } => {
  const index = argv.indexOf("--profile-name");
  if (index < 0) return { argv };
  const value = argv[index + 1];
  if (
    value === undefined ||
    !isProfileName(value) ||
    argv.indexOf("--profile-name", index + 1) >= 0
  )
    throw new InvalidCommandError();
  return { argv: [...argv.slice(0, index), ...argv.slice(index + 2)], profileName: value };
};

export class InvalidCommandError extends Error {
  public constructor() {
    super("The command arguments are invalid.");
    this.name = "InvalidCommandError";
  }
}

function parseSourceCommand(values: string[], wait: boolean): SourceCliCommand {
  const action = values.shift();
  if (action === "publish" && values[0] === "complete") {
    values.shift();
    if (wait) throw new InvalidCommandError();
    const options = parseOptionalOptions(values, ["--project", "--directory", "--operation"]);
    const projectId = options["--project"],
      operationId = options["--operation"];
    if (
      projectId === undefined ||
      !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(projectId) ||
      (operationId !== undefined && !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(operationId))
    )
      throw new InvalidCommandError();
    return {
      kind: "source-complete",
      projectId,
      directory: options["--directory"] ?? ".",
      operationId,
      credentialStore: "native",
    };
  }
  if (action === "inspect") {
    if (wait) throw new InvalidCommandError();
    const options = parseOptionalOptions(values, ["--directory"]);
    return { kind: "source-inspect", directory: options["--directory"] ?? "." };
  }
  const allowed =
    action === "publish"
      ? [
          "--project",
          "--directory",
          "--mode",
          "--expected-source-generation",
          "--expected-source-connection",
          "--expected-commit",
          "--message",
          "--idempotency-key",
        ]
      : action === "restore"
        ? [
            "--project",
            "--expected-source-generation",
            "--expected-commit",
            "--restore-commit",
            "--message",
            "--idempotency-key",
          ]
        : action === "initialize"
          ? ["--project", "--template", "--expected-source-generation", "--idempotency-key"]
          : [
              "--project",
              "--commit",
              "--path",
              "--limit",
              "--before",
              "--from",
              "--to",
              "--operation",
            ];
  const options = parseOptionalOptions(values, allowed);
  const projectId = options["--project"];
  if (projectId === undefined || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(projectId))
    throw new InvalidCommandError();
  const credentialStore = "native" as const;
  if (action === "publish" || action === "restore" || action === "initialize") {
    const idempotencyKey = options["--idempotency-key"];
    const rawGeneration = options["--expected-source-generation"];
    if (
      idempotencyKey === undefined ||
      rawGeneration === undefined ||
      !/^(?:0|[1-9][0-9]*)$/u.test(rawGeneration)
    )
      throw new InvalidCommandError();
    const expected_source_generation = Number(rawGeneration);
    try {
      if (action === "initialize")
        return {
          kind: "source-initialize",
          projectId,
          request: parseManagedSourceRequest("initialize", {
            expected_source_generation,
            template: options["--template"] ?? "vite-react",
          }),
          idempotencyKey,
          wait,
          credentialStore,
        };
      const common = {
        expected_source_generation,
        expected_commit_sha: options["--expected-commit"] ?? null,
        message: options["--message"],
      };
      if (action === "restore")
        return {
          kind: "source-restore",
          projectId,
          request: parseManagedSourceRequest("restore", {
            ...common,
            restore_commit_sha: options["--restore-commit"],
          }),
          idempotencyKey,
          wait,
          credentialStore,
        };
      return {
        kind: "source-publish",
        projectId,
        directory: options["--directory"] ?? ".",
        request: parseManagedSourceRequest("upload", {
          ...common,
          mode: options["--mode"],
          expected_source_connection_id: options["--expected-source-connection"] ?? null,
        }),
        explicitExpectedCommit: options["--expected-commit"] !== undefined,
        idempotencyKey,
        wait,
        credentialStore,
      };
    } catch {
      throw new InvalidCommandError();
    }
  }
  if (wait || !["status", "files", "file", "versions", "diff", "upload"].includes(action ?? ""))
    throw new InvalidCommandError();
  const commitSha = options["--commit"],
    path = options["--path"],
    beforeCommitSha = options["--before"],
    fromCommitSha = options["--from"],
    toCommitSha = options["--to"],
    operationId = options["--operation"];
  const permitted =
    action === "status"
      ? ["--project"]
      : action === "versions"
        ? ["--project", "--limit", "--before"]
        : action === "diff"
          ? ["--project", "--from", "--to"]
          : action === "upload"
            ? ["--project", "--operation"]
            : action === "file"
              ? ["--project", "--commit", "--path"]
              : ["--project", "--commit"];
  if (
    Object.keys(options).some((key) => !permitted.includes(key)) ||
    [commitSha, beforeCommitSha, fromCommitSha, toCommitSha].some(
      (value) => value !== undefined && !/^[a-f0-9]{40}$/u.test(value),
    ) ||
    (action === "file" && !isManagedSourcePath(path)) ||
    (action === "diff" && (fromCommitSha === undefined || toCommitSha === undefined)) ||
    (action === "upload" &&
      (operationId === undefined || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(operationId)))
  )
    throw new InvalidCommandError();
  const limit = options["--limit"] === undefined ? undefined : Number(options["--limit"]);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100))
    throw new InvalidCommandError();
  return {
    kind: "source-read",
    action: action as Extract<SourceCliCommand, { kind: "source-read" }>["action"],
    projectId,
    commitSha,
    path,
    beforeCommitSha,
    fromCommitSha,
    toCommitSha,
    operationId,
    limit,
    credentialStore,
  };
}

export type RecognizedCommandLabel =
  | "source inspect"
  | "source status"
  | "source files"
  | "source file"
  | "source versions"
  | "source diff"
  | "source upload"
  | "source publish"
  | "source publish complete"
  | "source initialize"
  | "source restore"
  | "project data plan"
  | "project data change"
  | "database compute set"
  | "database compute get"
  | "project context"
  | "project notes set"
  | "export create"
  | "export get"
  | "billing recharge get"
  | "billing recharge set"
  | "billing checkout"
  | "billing status"
  | "billing portal"
  | "unknown"
  | "help"
  | "version"
  | "whoami"
  | "credits account"
  | "referral link"
  | "credits balance"
  | "credits usage"
  | "budget get"
  | "budget set"
  | "init"
  | "login"
  | "logout"
  | "profile list"
  | "operation get"
  | "operation reconcile"
  | "token create"
  | "token list"
  | "token revoke"
  | "feedback submit"
  | "feedback status"
  | "project create"
  | "organization create"
  | "organization list"
  | "organization use"
  | "github connect"
  | "github status"
  | "project list"
  | "project status"
  | "project dev-access create"
  | "project dev-share link"
  | "project dev-share rotate"
  | "project dev-share revoke"
  | "project dev-access mode"
  | "project flag status"
  | "project flag set"
  | "project handle check"
  | "project handle set"
  | "database write"
  | "database query"
  | "database access create"
  | "database access list"
  | "database access revoke"
  | "database psql"
  | "link"
  | "source auto-deploy set"
  | "source auto-deploy status"
  | "domain cloudflare authorize"
  | "domain cloudflare status"
  | "domain cloudflare apply"
  | "domain paid plan"
  | "domain paid apply"
  | "domain paid status"
  | "domain paid delete"
  | "plan"
  | "deploy"
  | "logs"
  | "deployment logs"
  | "rollback plan"
  | "rollback"
  | "deployment promote plan"
  | "deployment promote"
  | "delete plan"
  | "delete"
  | "secret list"
  | "function runs"
  | "secret set"
  | "secret delete"
  | "mail setup"
  | "mail status"
  | "mail webhook set"
  | "mail webhook verify"
  | "mail webhook disable"
  | "mail messages list"
  | "mail messages get"
  | "mail messages retry"
  | "mail domain set"
  | "mail domain status"
  | "mail domain delete";

export const recognizedCommandLabel = (argv: readonly string[]): RecognizedCommandLabel => {
  const values = [...argv];
  if (values.includes("--help")) return "help";
  if (values.includes("--version")) return "version";
  while (values.length > 0) {
    const value = values.shift();
    if (value === "--profile-name") {
      values.shift();
      continue;
    }
    if (
      value === "--json" ||
      value === "--dry-run" ||
      value === "--revoke" ||
      value === "--yes" ||
      value === "--wait" ||
      value === "--follow" ||
      value === "--stdin"
    ) {
      continue;
    }
    if (
      value === "help" ||
      value === "version" ||
      value === "whoami" ||
      value === "init" ||
      value === "login" ||
      value === "logout"
    )
      return value;
    if (value === "profile" && values[0] === "list") return "profile list";
    if (value === "github" && values[0] === "connect") return "github connect";
    if (value === "github" && values[0] === "status") return "github status";
    if (value === "operation" && values[0] === "get") return "operation get";
    if (value === "credits" && values[0] === "account") return "credits account";
    if (value === "referral" && values[0] === "link") return "referral link";
    if (value === "credits" && values[0] === "balance") return "credits balance";
    if (value === "billing" && values[0] === "recharge" && values[1] === "get")
      return "billing recharge get";
    if (value === "billing" && values[0] === "recharge" && values[1] === "set")
      return "billing recharge set";
    if (value === "billing" && values[0] === "checkout") return "billing checkout";
    if (value === "billing" && values[0] === "status") return "billing status";
    if (value === "billing" && values[0] === "portal") return "billing portal";
    if (value === "credits" && values[0] === "usage") return "credits usage";
    if (value === "budget" && values[0] === "get") return "budget get";
    if (value === "budget" && values[0] === "set") return "budget set";
    if (value === "operation" && values[0] === "reconcile") return "operation reconcile";
    if (value === "token" && ["create", "list", "revoke"].includes(values[0] ?? ""))
      return `token ${values[0]}` as RecognizedCommandLabel;
    if (value === "export" && (values[0] === "create" || values[0] === "get"))
      return `export ${values[0]}`;
    if (value === "feedback" && values[0] === "submit") return "feedback submit";
    if (value === "feedback" && values[0] === "status") return "feedback status";
    if (value === "project" && values[0] === "create") return "project create";
    if (value === "project" && values[0] === "data" && values[1] === "plan")
      return "project data plan";
    if (value === "project" && values[0] === "data" && values[1] === "change")
      return "project data change";
    if (value === "organization" && values[0] === "create") return "organization create";
    if (value === "organization" && values[0] === "list") return "organization list";
    if (value === "organization" && values[0] === "use") return "organization use";
    if (value === "project" && values[0] === "list") return "project list";
    if (value === "project" && values[0] === "context") return "project context";
    if (value === "project" && values[0] === "notes" && values[1] === "set")
      return "project notes set";
    if (value === "project" && values[0] === "status") return "project status";
    if (value === "project" && values[0] === "handle" && values[1] === "check")
      return "project handle check";
    if (value === "project" && values[0] === "handle" && values[1] === "set")
      return "project handle set";
    if (
      value === "project" &&
      values[0] === "dev-share" &&
      ["link", "rotate", "revoke"].includes(values[1] ?? "")
    )
      return values[1] === "link"
        ? "project dev-share link"
        : values[1] === "rotate"
          ? "project dev-share rotate"
          : "project dev-share revoke";
    if (value === "project" && values[0] === "dev-access" && values[1] === "mode")
      return "project dev-access mode";
    if (value === "project" && values[0] === "dev-access" && values[1] === "create")
      return "project dev-access create";
    if (value === "project" && values[0] === "flag" && values[1] === "status")
      return "project flag status";
    if (value === "project" && values[0] === "flag" && values[1] === "set")
      return "project flag set";
    if (value === "database" && values[0] === "compute" && values[1] === "set")
      return "database compute set";
    if (value === "database" && values[0] === "compute" && values[1] === "get")
      return "database compute get";
    if (value === "database" && values[0] === "write") return "database write";
    if (value === "database" && values[0] === "query") return "database query";
    if (value === "database" && values[0] === "access") {
      if (values[1] === "create") return "database access create";
      if (values[1] === "list") return "database access list";
      if (values[1] === "revoke") return "database access revoke";
    }
    if (value === "database" && values[0] === "psql") return "database psql";
    if (value === "link" || value === "plan" || value === "deploy" || value === "logs")
      return value;
    if (value === "source" && values[0] === "publish" && values[1] === "complete")
      return "source publish complete";
    if (
      value === "source" &&
      [
        "inspect",
        "status",
        "files",
        "file",
        "versions",
        "diff",
        "upload",
        "publish",
        "initialize",
        "restore",
      ].includes(values[0] ?? "")
    )
      return `source ${values[0]}` as RecognizedCommandLabel;
    if (value === "source" && values[0] === "auto-deploy") {
      if (values[1] === "set") return "source auto-deploy set";
      if (values[1] === "status") return "source auto-deploy status";
    }
    if (value === "domain" && values[0] === "cloudflare") {
      if (values[1] === "authorize") return "domain cloudflare authorize";
      if (values[1] === "status") return "domain cloudflare status";
      if (values[1] === "apply") return "domain cloudflare apply";
    }
    if (value === "domain" && values[0] === "paid") {
      if (values[1] === "plan") return "domain paid plan";
      if (values[1] === "apply") return "domain paid apply";
      if (values[1] === "status") return "domain paid status";
      if (values[1] === "delete") return "domain paid delete";
    }
    if (value === "rollback") return values[0] === "plan" ? "rollback plan" : "rollback";
    if (value === "deployment" && values[0] === "promote")
      return values[1] === "plan" ? "deployment promote plan" : "deployment promote";
    if (value === "deployment" && values[0] === "logs") return "deployment logs";
    if (value === "delete") return values[0] === "plan" ? "delete plan" : "delete";
    if (value === "secret") {
      if (values[0] === "list") return "secret list";
      if (values[0] === "set") return "secret set";
      if (values[0] === "delete") return "secret delete";
    }
    if (value === "function" && values[0] === "runs") return "function runs";
    if (value === "mail") {
      if (values[0] === "setup") return "mail setup";
      if (values[0] === "status") return "mail status";
      if (values[0] === "webhook") {
        if (values[1] === "set") return "mail webhook set";
        if (values[1] === "verify") return "mail webhook verify";
        if (values[1] === "disable") return "mail webhook disable";
      }
      if (values[0] === "messages") {
        if (values[1] === "list") return "mail messages list";
        if (values[1] === "get") return "mail messages get";
        if (values[1] === "retry") return "mail messages retry";
      }
    }
    if (value === "mail" && values[0] === "domain") {
      if (values[1] === "set") return "mail domain set";
      if (values[1] === "status") return "mail domain status";
      if (values[1] === "delete") return "mail domain delete";
    }
    return "unknown";
  }
  return "unknown";
};

export const parseProductCliCommand = (argv: readonly string[]): ProductCliCommand => {
  const values = [...argv];
  removeFlag(values, "--json");
  const help = removeFlag(values, "--help");
  if ((values.length === 1 && values[0] === "help") || values.length === 0) {
    return { kind: "help" };
  }
  if (help) {
    const topic = recognizedCommandLabel(values);
    if (topic === "unknown" || topic === "version" || topic !== values.join(" "))
      throw new InvalidCommandError();
    return { kind: "help", topic };
  }
  if (values.length === 1 && (values[0] === "--version" || values[0] === "version")) {
    return { kind: "version" };
  }
  const dryRun = removeFlag(values, "--dry-run");
  const credentialStore = "native" as const;
  const revoke = removeFlag(values, "--revoke");
  const yes = removeFlag(values, "--yes");
  const wait = removeFlag(values, "--wait");
  const follow = removeFlag(values, "--follow");
  const stdin = removeFlag(values, "--stdin");
  const first = values.shift();
  if (first === "source" && values[0] !== "auto-deploy") {
    if (dryRun || revoke || yes || follow || stdin) throw new InvalidCommandError();
    return parseSourceCommand(values, wait);
  }
  if (
    first === "whoami" &&
    !dryRun &&
    !revoke &&
    !yes &&
    !wait &&
    !follow &&
    !stdin &&
    values.length === 0
  ) {
    return { kind: "whoami", credentialStore };
  }
  if (first === "init") {
    if (revoke || yes || wait || follow || stdin) throw new InvalidCommandError();
    const options = parseOptionalOptions(values, [
      "--directory",
      "--project",
      "--root",
      "--region",
    ]);
    const region = options["--region"];
    if (region !== undefined && region !== "us" && region !== "eu") throw new InvalidCommandError();
    return {
      kind: "init",
      directory: options["--directory"] ?? ".",
      project: options["--project"],
      root: options["--root"],
      ...(region === undefined ? {} : { region }),
      dryRun,
    };
  }
  if (dryRun) throw new InvalidCommandError();
  if (first === "login" && !revoke && !yes && !wait && !follow && !stdin) {
    const options = parseOptionalOptions(values, ["--organization", "--user"]);
    const organizationId = options["--organization"];
    const userId = options["--user"];
    if (
      (organizationId !== undefined && !ORGANIZATION_ULID.test(organizationId)) ||
      (userId !== undefined && !isProfileUserId(userId))
    )
      throw new InvalidCommandError();
    return {
      kind: "login",
      ...(organizationId === undefined ? {} : { organizationId }),
      ...(userId === undefined ? {} : { userId }),
      credentialStore,
    };
  }
  if (
    first === "profile" &&
    values.length === 1 &&
    values[0] === "list" &&
    !revoke &&
    !yes &&
    !wait &&
    !follow &&
    !stdin
  )
    return { kind: "profile-list" };
  if (first === "logout") {
    if (!yes && !wait && !follow && !stdin && values.length === 0)
      return { kind: "logout", revoke, credentialStore };
  }
  if (revoke) throw new InvalidCommandError();
  if (first === "token") {
    if (wait || follow || stdin) throw new InvalidCommandError();
    const sub = values.shift();
    const options = parseOptionalOptions(
      values,
      sub === "create"
        ? ["--organization", "--name", "--idempotency-key", "--out"]
        : sub === "list"
          ? ["--organization", "--after"]
          : ["--organization", "--key"],
    );
    const organizationId = options["--organization"];
    if (!organizationId || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(organizationId))
      throw new InvalidCommandError();
    if (sub === "create" && !yes) {
      const name = options["--name"],
        idempotencyKey = options["--idempotency-key"],
        outputPath = options["--out"];
      if (
        !name ||
        name.trim() !== name ||
        name.length > 64 ||
        /\p{Cc}/u.test(name) ||
        !idempotencyKey ||
        !/^[A-Za-z0-9._:-]{1,128}$/u.test(idempotencyKey) ||
        !outputPath
      )
        throw new InvalidCommandError();
      return {
        kind: "token-create",
        organizationId,
        name,
        idempotencyKey,
        outputPath,
        credentialStore,
      };
    }
    if (sub === "list" && !yes) {
      const after = options["--after"];
      if (after !== undefined && !USER_API_KEY_ID.test(after)) throw new InvalidCommandError();
      return {
        kind: "token-list",
        organizationId,
        ...(after === undefined ? {} : { after }),
        credentialStore,
      };
    }
    if (sub === "revoke" && yes && options["--key"] && USER_API_KEY_ID.test(options["--key"]))
      return { kind: "token-revoke", organizationId, keyId: options["--key"], credentialStore };
    throw new InvalidCommandError();
  }
  if (first === "feedback" && values[0] === "status") {
    values.shift();
    const feedbackId = values.shift();
    if (yes || wait || follow || stdin || !isValue(feedbackId)) throw new InvalidCommandError();
    const cursor = parseOptionalOptions(values, ["--cursor"])["--cursor"];
    return {
      kind: "feedback-status",
      feedbackId,
      ...(cursor === undefined ? {} : { cursor }),
      credentialStore,
    };
  }
  if (first === "feedback" && values.shift() === "submit") {
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    const options = parseOptionalOptions(values, [
      "--organization",
      "--kind",
      "--title",
      "--description",
      "--project",
      "--environment",
      "--operation",
      "--error-code",
      "--client-version",
      "--idempotency-key",
    ]);
    const organization = options["--organization"],
      kind = options["--kind"],
      title = options["--title"],
      description = options["--description"],
      key = options["--idempotency-key"];
    if (
      !organization ||
      !title ||
      !description ||
      !key ||
      (kind !== "bug" && kind !== "issue" && kind !== "feature_request")
    )
      throw new InvalidCommandError();
    return {
      kind: "feedback-submit",
      credentialStore,
      idempotencyKey: key,
      report: {
        organization_id: organization,
        kind,
        title,
        description,
        ...(options["--project"] === undefined ? {} : { project_id: options["--project"] }),
        ...(options["--environment"] === undefined
          ? {}
          : { environment_id: options["--environment"] }),
        ...(options["--operation"] === undefined ? {} : { operation_id: options["--operation"] }),
        ...(options["--error-code"] === undefined ? {} : { error_code: options["--error-code"] }),
        ...(options["--client-version"] === undefined
          ? {}
          : { client_version: options["--client-version"] }),
      },
    };
  }
  if (first === "billing") {
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    const sub = values.shift();
    if (sub === "recharge") {
      const action = values.shift();
      if (action === "get") {
        const o = parseOptions(values, ["--organization"]);
        return {
          kind: "billing-recharge-get",
          organizationId: o["--organization"],
          credentialStore,
        };
      }
      if (action !== "set") throw new InvalidCommandError();
      const o = parseOptionalOptions(values, [
        "--organization",
        "--enabled",
        "--monthly-limit-minor",
        "--consent",
        "--revision",
        "--idempotency-key",
      ]);
      const limit = Number(o["--monthly-limit-minor"]),
        revision = Number(o["--revision"]);
      if (
        !o["--organization"] ||
        !o["--idempotency-key"] ||
        !["true", "false"].includes(o["--enabled"] ?? "") ||
        !Number.isSafeInteger(limit) ||
        limit < 1000 ||
        limit > 100000 ||
        !o["--revision"] ||
        !Number.isSafeInteger(revision) ||
        revision < 0 ||
        (o["--enabled"] === "true"
          ? o["--consent"] !== "off_session_v1"
          : o["--consent"] !== undefined)
      )
        throw new InvalidCommandError();
      return {
        kind: "billing-recharge-set",
        organizationId: o["--organization"],
        enabled: o["--enabled"] === "true",
        monthlyLimitMinor: limit,
        consent: o["--enabled"] === "true" ? "off_session_v1" : null,
        revision,
        idempotencyKey: o["--idempotency-key"],
        credentialStore,
      };
    }
    if (sub === "portal") {
      const options = parseOptions(values, ["--organization"]);
      return { kind: "billing-portal", organizationId: options["--organization"], credentialStore };
    }
    if (sub === "status") {
      const options = parseOptions(values, ["--organization", "--checkout"]);
      return {
        kind: "billing-status",
        organizationId: options["--organization"],
        checkoutId: options["--checkout"],
        credentialStore,
      };
    }
    if (sub === "checkout") {
      const options = parseOptionalOptions(values, [
          "--organization",
          "--offer",
          "--packs",
          "--idempotency-key",
        ]),
        offer = options["--offer"],
        packs = Number(options["--packs"] ?? "1");
      if (
        !options["--organization"] ||
        !options["--idempotency-key"] ||
        (offer !== "topup" && offer !== "paid") ||
        !/^[1-9][0-9]{0,2}$/u.test(options["--packs"] ?? "1") ||
        packs > 100 ||
        (offer === "paid" && packs !== 1)
      )
        throw new InvalidCommandError();
      return {
        kind: "billing-checkout",
        organizationId: options["--organization"],
        offer,
        packs,
        idempotencyKey: options["--idempotency-key"],
        credentialStore,
      };
    }
    throw new InvalidCommandError();
  }
  if (first === "credits" && values[0] === "usage") {
    values.shift();
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    const options = parseOptionalOptions(values, ["--organization", "--month", "--cursor"]);
    if (
      !options["--organization"] ||
      !options["--month"] ||
      !/^20[0-9]{2}-(0[1-9]|1[0-2])$/u.test(options["--month"])
    )
      throw new InvalidCommandError();
    return {
      kind: "credits-usage",
      organizationId: options["--organization"],
      month: options["--month"],
      ...(options["--cursor"] ? { cursor: options["--cursor"] } : {}),
      credentialStore,
    };
  }
  if (first === "credits" && values[0] === "account") {
    values.shift();
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    const options = parseOptions(values, ["--organization"]);
    return { kind: "credits-account", organizationId: options["--organization"], credentialStore };
  }
  if (first === "referral" && values[0] === "link") {
    values.shift();
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    const options = parseOptions(values, ["--organization"]);
    return { kind: "referral-link", organizationId: options["--organization"], credentialStore };
  }
  if (first === "credits" && values.shift() === "balance") {
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    const options = parseOptions(values, ["--organization"]);
    return { kind: "credits-balance", organizationId: options["--organization"], credentialStore };
  }
  if (first === "budget") {
    const subcommand = values.shift();
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    if (subcommand === "get")
      return {
        kind: "budget-get",
        projectId: parseOptions(values, ["--project"])["--project"],
        credentialStore,
      };
    if (subcommand !== "set") throw new InvalidCommandError();
    const options = parseOptionalOptions(values, [
      "--project",
      "--credits",
      "--mode",
      "--idempotency-key",
    ]);
    const projectId = options["--project"];
    const value = options["--credits"];
    const mode = options["--mode"] ?? "continue";
    const idempotencyKey = options["--idempotency-key"];
    if (
      !isValue(projectId) ||
      !isValue(value) ||
      !isValue(idempotencyKey) ||
      (mode !== "continue" && mode !== "stop")
    )
      throw new InvalidCommandError();
    if (value === "none") {
      if (mode !== "continue") throw new InvalidCommandError();
      return {
        kind: "budget-set",
        projectId,
        amountMicros: null,
        mode,
        idempotencyKey,
        credentialStore,
      };
    }
    if (!/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?$/u.test(value)) throw new InvalidCommandError();
    const [whole, fraction = ""] = value.split(".");
    const amount = BigInt(whole ?? "0") * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
    if (amount > 9223372036854775807n) throw new InvalidCommandError();
    return {
      kind: "budget-set",
      projectId,
      amountMicros: amount.toString(),
      mode,
      idempotencyKey,
      credentialStore,
    };
  }
  if (first === "operation") {
    const subcommand = values.shift();
    if (subcommand === "get") {
      if (yes || wait || follow || stdin) throw new InvalidCommandError();
      const operationId = values.shift();
      if (isValue(operationId) && values.length === 0) {
        return { kind: "operation-get", operationId, credentialStore };
      }
    }
    if (subcommand === "reconcile") {
      if (!yes || wait || follow || stdin) throw new InvalidCommandError();
      const operationId = values.shift();
      if (!isValue(operationId)) throw new InvalidCommandError();
      const options = parseOptions(values, ["--idempotency-key"]);
      return {
        kind: "operation-reconcile",
        operationId,
        idempotencyKey: options["--idempotency-key"],
        yes,
        credentialStore,
      };
    }
    throw new InvalidCommandError();
  }
  if (first === "github") {
    const subcommand = values.shift();
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    if (subcommand !== "connect" && subcommand !== "status") throw new InvalidCommandError();
    const options = parseOptions(
      values,
      subcommand === "connect" ? ["--organization", "--idempotency-key"] : ["--organization"],
    );
    const organizationId = options["--organization"];
    if (!ORGANIZATION_ULID.test(organizationId)) throw new InvalidCommandError();
    return subcommand === "connect"
      ? {
          kind: "github-connect",
          organizationId,
          idempotencyKey: options["--idempotency-key"],
          credentialStore,
        }
      : { kind: "github-status", organizationId, credentialStore };
  }
  if (first === "organization") {
    const subcommand = values.shift();
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    if (subcommand === "create") {
      const options = parseOptionalOptions(values, ["--name", "--source", "--idempotency-key"]);
      const name = options["--name"];
      const idempotencyKey = options["--idempotency-key"];
      // Signup is open: the source is optional attribution, the other two are required.
      if (!isValue(name) || !isValue(idempotencyKey)) throw new InvalidCommandError();
      const signupSource = options["--source"];
      if (signupSource !== undefined && !isValue(signupSource)) throw new InvalidCommandError();
      return {
        kind: "organization-create",
        ...(signupSource === undefined ? {} : { signupSource }),
        name,
        idempotencyKey,
        credentialStore,
      };
    }
    if (subcommand === "list") {
      if (values.length > 0) throw new InvalidCommandError();
      return { kind: "organization-list", credentialStore };
    }
    if (subcommand === "use") {
      const organizationId = parseOptions(values, ["--organization"])["--organization"];
      if (!ORGANIZATION_ULID.test(organizationId)) throw new InvalidCommandError();
      return { kind: "organization-use", organizationId, credentialStore };
    }
    throw new InvalidCommandError();
  }
  if (first === "project") {
    const subcommand = values.shift();
    if (subcommand === "data") {
      const action = values.shift();
      if (follow || stdin || (action !== "plan" && action !== "change"))
        throw new InvalidCommandError();
      if ((action === "plan" && (yes || wait)) || (action === "change" && !yes))
        throw new InvalidCommandError();
      const options = parseOptions(
        values,
        action === "plan"
          ? ["--project", "--change"]
          : ["--project", "--change", "--if-match", "--confirmation-token", "--idempotency-key"],
      );
      const change = options["--change"];
      if (!isProjectDataChangeKind(change)) throw new InvalidCommandError();
      const common = { projectId: options["--project"], change, credentialStore };
      return action === "plan"
        ? { kind: "project-data-plan", ...common }
        : {
            kind: "project-data-change",
            ...common,
            ifMatch: options["--if-match"],
            confirmationToken: options["--confirmation-token"],
            idempotencyKey: options["--idempotency-key"],
            yes: true,
            wait,
          };
    }
    if (subcommand === "handle" && values[0] === "set") {
      values.shift();
      if (yes || wait || follow || stdin) throw new InvalidCommandError();
      const options = parseOptions(values, [
        "--project",
        "--handle",
        "--if-match",
        "--idempotency-key",
      ]);
      return {
        kind: "project-handle-set",
        projectId: options["--project"],
        handle: options["--handle"],
        ifMatch: options["--if-match"],
        idempotencyKey: options["--idempotency-key"],
        credentialStore,
      };
    }
    if (subcommand === "handle" && values.shift() === "check") {
      if (yes || wait || follow || stdin) throw new InvalidCommandError();
      const options = parseOptions(values, ["--handle"]);
      return { kind: "project-handle-check", handle: options["--handle"], credentialStore };
    }
    if (subcommand === "dev-share") {
      const action = values.shift();
      if (action === "link") {
        if (yes || wait || follow || stdin) throw new InvalidCommandError();
        const options = parseOptions(values, ["--project"]);
        return { kind: "project-dev-share-link", projectId: options["--project"], credentialStore };
      }
      if ((action === "rotate" || action === "revoke") && yes && !wait && !follow && !stdin) {
        const options = parseOptions(values, ["--project", "--idempotency-key"]);
        return {
          kind: action === "rotate" ? "project-dev-share-rotate" : "project-dev-share-revoke",
          projectId: options["--project"],
          idempotencyKey: options["--idempotency-key"],
          credentialStore,
        };
      }
      throw new InvalidCommandError();
    }
    if (subcommand === "dev-access" && values[0] === "mode") {
      values.shift();
      if (!yes || wait || follow || stdin) throw new InvalidCommandError();
      const options = parseOptions(values, ["--project", "--mode", "--idempotency-key"]);
      if (options["--mode"] !== "protected" && options["--mode"] !== "public")
        throw new InvalidCommandError();
      return {
        kind: "project-dev-access-mode-set",
        projectId: options["--project"],
        mode: options["--mode"],
        idempotencyKey: options["--idempotency-key"],
        credentialStore,
      };
    }
    if (subcommand === "flag") {
      const action = values.shift();
      if (yes || wait || follow || stdin) throw new InvalidCommandError();
      if (action === "status") {
        const options = parseOptions(values, ["--project"]);
        return { kind: "project-flag-status", projectId: options["--project"], credentialStore };
      }
      if (action === "set") {
        const options = parseOptions(values, ["--project", "--enabled", "--idempotency-key"]);
        if (options["--enabled"] !== "true" && options["--enabled"] !== "false")
          throw new InvalidCommandError();
        return {
          kind: "project-flag-set",
          projectId: options["--project"],
          enabled: options["--enabled"] === "true",
          idempotencyKey: options["--idempotency-key"],
          credentialStore,
        };
      }
      throw new InvalidCommandError();
    }
    if (subcommand === "dev-access" && values.shift() === "create") {
      if (yes || wait || follow || stdin) throw new InvalidCommandError();
      const options = parseOptions(values, ["--project"]);
      return {
        kind: "project-dev-access-create",
        projectId: options["--project"],
        credentialStore,
      };
    }
    if (subcommand === "list") {
      if (yes || wait || follow || stdin) throw new InvalidCommandError();
      const options = parseOptionalOptions(values, ["--cursor", "--limit"]);
      const limit = options["--limit"] === undefined ? 50 : Number(options["--limit"]);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new InvalidCommandError();
      }
      return {
        kind: "project-list",
        cursor: options["--cursor"],
        limit,
        credentialStore,
      };
    }
    if (subcommand === "context") {
      if (yes || wait || follow || stdin) throw new InvalidCommandError();
      const options = parseOptions(values, ["--project"]);
      return { kind: "project-context", projectId: options["--project"], credentialStore };
    }
    if (subcommand === "notes" && values.shift() === "set") {
      if (yes || wait || follow || stdin) throw new InvalidCommandError();
      const textIndex = values.indexOf("--markdown");
      const markdown = values[textIndex + 1];
      if (textIndex < 0 || markdown === undefined) throw new InvalidCommandError();
      values.splice(textIndex, 2);
      const options = parseOptions(values, ["--project", "--version", "--idempotency-key"]);
      if (
        !/^(?:0|[1-9][0-9]*)$/u.test(options["--version"]) ||
        Number(options["--version"]) >= 2147483647
      )
        throw new InvalidCommandError();
      return {
        kind: "project-notes-set",
        projectId: options["--project"],
        markdown,
        expectedVersion: Number(options["--version"]),
        idempotencyKey: options["--idempotency-key"],
        credentialStore,
      };
    }
    if (subcommand === "status") {
      if (yes || wait || follow || stdin) throw new InvalidCommandError();
      const options = parseOptions(values, ["--project"]);
      return { kind: "project-status", projectId: options["--project"], credentialStore };
    }
    if (subcommand !== "create") throw new InvalidCommandError();
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    const options = parseOptionalOptions(values, [
      "--organization",
      "--name",
      "--idempotency-key",
      "--data-mode",
      "--dev-access-mode",
      "--region",
    ]);
    const dataMode = options["--data-mode"];
    const devAccessMode = options["--dev-access-mode"];
    const region = options["--region"];
    if (
      !options["--organization"] ||
      !options["--name"] ||
      !options["--idempotency-key"] ||
      (dataMode !== undefined && dataMode !== "shared" && dataMode !== "isolated") ||
      (devAccessMode !== undefined &&
        devAccessMode !== "protected" &&
        devAccessMode !== "public") ||
      (region !== undefined && region !== "us" && region !== "eu")
    )
      throw new InvalidCommandError();
    return {
      kind: "project-create",
      organizationId: options["--organization"],
      name: options["--name"],
      ...(dataMode === undefined ? {} : { dataMode }),
      ...(devAccessMode === undefined ? {} : { devAccessMode }),
      ...(region === undefined ? {} : { region }),
      idempotencyKey: options["--idempotency-key"],
      credentialStore,
    };
  }
  if (first === "database" && values[0] === "compute" && values[1] === "set") {
    values.splice(0, 2);
    if (!yes || follow || stdin || revoke) throw new InvalidCommandError();
    const options = parseOptionalOptions(values, [
      "--project",
      "--environment",
      "--profile",
      "--idempotency-key",
    ]);
    if (
      !options["--project"] ||
      !options["--idempotency-key"] ||
      (options["--profile"] !== "standard" && options["--profile"] !== "performance") ||
      (options["--environment"] !== "dev" && options["--environment"] !== "prod")
    )
      throw new InvalidCommandError();
    return {
      kind: "database-compute-set",
      projectId: options["--project"],
      environment: options["--environment"],
      profile: options["--profile"],
      idempotencyKey: options["--idempotency-key"],
      wait,
      credentialStore,
    };
  }
  if (first === "database" && values[0] === "compute" && values[1] === "get") {
    values.splice(0, 2);
    if (yes || wait || follow || stdin || revoke) throw new InvalidCommandError();
    const options = parseOptionalOptions(values, ["--project", "--environment"]);
    if (!options["--project"]) throw new InvalidCommandError();
    const environment = options["--environment"] ?? "dev";
    if (environment !== "dev" && environment !== "prod") throw new InvalidCommandError();
    return {
      kind: "database-compute-get",
      projectId: options["--project"],
      environment,
      credentialStore,
    };
  }
  if (first === "database" && values[0] === "write") {
    values.shift();
    if (!yes || wait || follow || revoke || stdin) throw new InvalidCommandError();
    const options = parseOptionalOptions(values, [
      "--project",
      "--environment",
      "--statement-file",
      "--parameters-json",
      "--idempotency-key",
    ]);
    const projectId = options["--project"],
      environment = options["--environment"],
      statementFile = options["--statement-file"],
      idempotencyKey = options["--idempotency-key"];
    if (
      !isValue(projectId) ||
      !isValue(statementFile) ||
      !isValue(idempotencyKey) ||
      (environment !== "dev" && environment !== "prod")
    )
      throw new InvalidCommandError();
    let parameters: unknown;
    try {
      parameters = JSON.parse(options["--parameters-json"] ?? "[]");
    } catch {
      throw new InvalidCommandError();
    }
    if (!Array.isArray(parameters) || parameters.length > 100) throw new InvalidCommandError();
    return {
      kind: "database-write",
      projectId,
      environment,
      statementFile,
      parameters,
      idempotencyKey,
      yes: true,
      credentialStore,
    };
  }
  if (first === "database" && values[0] === "access") {
    values.shift();
    const subcommand = values.shift();
    if (subcommand === "create") {
      if (!yes || wait || follow || revoke || stdin) throw new InvalidCommandError();
      const options = parseOptionalOptions(values, [
        "--project",
        "--environment",
        "--mode",
        "--ttl",
        "--label",
      ]);
      const projectId = options["--project"],
        environment = options["--environment"],
        mode = options["--mode"] ?? "read";
      if (
        !isValue(projectId) ||
        (environment !== "dev" && environment !== "prod") ||
        (mode !== "read" && mode !== "write")
      )
        throw new InvalidCommandError();
      const label = options["--label"];
      if (label !== undefined && (label.trim() !== label || label.length < 1 || label.length > 64))
        throw new InvalidCommandError();
      return {
        kind: "database-access-create",
        projectId,
        environment,
        mode,
        ttlSeconds: accessTtlSeconds(options["--ttl"]),
        label: label ?? null,
        yes: true,
        credentialStore,
      };
    }
    if (subcommand === "list") {
      if (yes || wait || follow || revoke || stdin) throw new InvalidCommandError();
      const options = parseOptionalOptions(values, ["--project", "--environment"]);
      const projectId = options["--project"],
        environment = options["--environment"];
      if (
        !isValue(projectId) ||
        (environment !== undefined && environment !== "dev" && environment !== "prod")
      )
        throw new InvalidCommandError();
      return {
        kind: "database-access-list",
        projectId,
        ...(environment === undefined ? {} : { environment }),
        credentialStore,
      };
    }
    if (subcommand === "revoke") {
      if (!yes || wait || follow || revoke || stdin) throw new InvalidCommandError();
      const options = parseOptions(values, ["--project", "--access"]);
      return {
        kind: "database-access-revoke",
        projectId: options["--project"],
        accessId: options["--access"],
        yes: true,
        credentialStore,
      };
    }
    throw new InvalidCommandError();
  }
  if (first === "database" && values[0] === "psql") {
    values.shift();
    if (yes || wait || follow || revoke || stdin) throw new InvalidCommandError();
    const options = parseOptionalOptions(values, ["--project", "--environment", "--mode", "--ttl"]);
    const projectId = options["--project"],
      environment = options["--environment"],
      mode = options["--mode"] ?? "read";
    if (
      !isValue(projectId) ||
      (environment !== "dev" && environment !== "prod") ||
      (mode !== "read" && mode !== "write")
    )
      throw new InvalidCommandError();
    return {
      kind: "database-psql",
      projectId,
      environment,
      mode,
      ttlSeconds: accessTtlSeconds(options["--ttl"]),
      credentialStore,
    };
  }
  if (first === "database" && values.shift() === "query") {
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    const options = parseOptionalOptions(values, [
      "--project",
      "--environment",
      "--statement",
      "--parameters-json",
    ]);
    const environment = options["--environment"];
    if (environment !== "dev" && environment !== "prod") throw new InvalidCommandError();
    const projectId = options["--project"];
    const statement = options["--statement"];
    if (
      !isValue(projectId) ||
      !isValue(statement) ||
      !/^(?:select|with)\b/iu.test(statement.trimStart()) ||
      new TextEncoder().encode(statement).byteLength > 4_096
    ) {
      throw new InvalidCommandError();
    }
    let parameters: unknown = [];
    try {
      parameters = JSON.parse(options["--parameters-json"] ?? "[]") as unknown;
    } catch {
      throw new InvalidCommandError();
    }
    if (
      !Array.isArray(parameters) ||
      parameters.length > 32 ||
      !parameters.every(
        (parameter) =>
          parameter === null ||
          typeof parameter === "string" ||
          typeof parameter === "boolean" ||
          (typeof parameter === "number" && Number.isFinite(parameter)),
      )
    ) {
      throw new InvalidCommandError();
    }
    return {
      kind: "database-query",
      projectId,
      environment,
      statement,
      parameters: Object.freeze([...parameters]) as readonly (string | number | boolean | null)[],
      credentialStore,
    };
  }
  if (first === "link") {
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    const options = parseOptions(values, [
      "--project",
      "--repository-owner",
      "--repository-name",
      "--idempotency-key",
    ]);
    return {
      kind: "link",
      projectId: options["--project"],
      repositoryOwner: options["--repository-owner"],
      repositoryName: options["--repository-name"],
      idempotencyKey: options["--idempotency-key"],
      credentialStore,
    };
  }
  if (first === "source" && values.shift() === "auto-deploy") {
    const subcommand = values.shift();
    if (subcommand === "set") {
      if (yes || wait || follow || stdin) throw new InvalidCommandError();
      const options = parseOptions(values, [
        "--project",
        "--branch",
        "--enabled",
        "--idempotency-key",
      ]);
      if (!validGithubBranchName(options["--branch"])) throw new InvalidCommandError();
      if (options["--enabled"] !== "true" && options["--enabled"] !== "false")
        throw new InvalidCommandError();
      return {
        kind: "source-auto-deploy-set",
        projectId: options["--project"],
        branch: options["--branch"],
        enabled: options["--enabled"] === "true",
        idempotencyKey: options["--idempotency-key"],
        credentialStore,
      };
    }
    if (subcommand === "status") {
      if (yes || wait || follow || stdin) throw new InvalidCommandError();
      const options = parseOptions(values, ["--project"]);
      return {
        kind: "source-auto-deploy-status",
        projectId: options["--project"],
        credentialStore,
      };
    }
    throw new InvalidCommandError();
  }
  if (first === "plan") {
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    const options = parseOptionalOptions(values, ["--project", "--commit", "--environment"]);
    const projectId = options["--project"];
    const commitSha = options["--commit"];
    if (projectId === undefined || commitSha === undefined) throw new InvalidCommandError();
    return {
      kind: "plan",
      projectId,
      commitSha,
      environment: deploymentEnvironment(options["--environment"]),
      credentialStore,
    };
  }
  if (first === "deploy") {
    if (!yes || follow || stdin) throw new InvalidCommandError();
    const options = parseOptionalOptions(values, [
      "--project",
      "--plan-id",
      "--commit",
      "--environment",
      "--idempotency-key",
    ]);
    const projectId = options["--project"];
    const idempotencyKey = options["--idempotency-key"];
    const planId = options["--plan-id"] ?? null;
    const commitSha = options["--commit"] ?? null;
    // A plan already names its environment, so --environment only accompanies --commit.
    if (
      projectId === undefined ||
      idempotencyKey === undefined ||
      (planId === null) === (commitSha === null) ||
      (planId !== null && options["--environment"] !== undefined)
    )
      throw new InvalidCommandError();
    return {
      kind: "deploy",
      projectId,
      planId,
      commitSha,
      environment: deploymentEnvironment(options["--environment"]),
      idempotencyKey,
      yes,
      wait,
      credentialStore,
    };
  }
  if (first === "logs") {
    if (!follow || yes || wait || stdin) throw new InvalidCommandError();
    const operationId = values.shift();
    if (isValue(operationId) && values.length === 0)
      return { kind: "logs", operationId, follow, credentialStore };
  }
  if (first === "deployment" && values[0] === "logs") {
    values.shift();
    if (!follow || yes || wait || stdin) throw new InvalidCommandError();
    const options = parseOptions(values, ["--project", "--deployment"]);
    return {
      kind: "deployment-logs",
      projectId: options["--project"],
      deploymentId: options["--deployment"],
      follow: true,
      credentialStore,
    };
  }
  if (first === "rollback" && values[0] === "plan") {
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    values.shift();
    const options = parseOptions(values, ["--project", "--deployment"]);
    return {
      kind: "rollback-plan",
      projectId: options["--project"],
      deploymentId: options["--deployment"],
      credentialStore,
    };
  }
  if (first === "rollback") {
    if (!yes || wait || follow || stdin) throw new InvalidCommandError();
    const options = parseOptions(values, [
      "--project",
      "--deployment",
      "--if-match",
      "--confirmation-token",
      "--idempotency-key",
    ]);
    return {
      kind: "rollback",
      projectId: options["--project"],
      deploymentId: options["--deployment"],
      ifMatch: options["--if-match"],
      confirmationToken: options["--confirmation-token"],
      idempotencyKey: options["--idempotency-key"],
      yes,
      credentialStore,
    };
  }
  if (first === "deployment" && values[0] === "promote" && values[1] === "plan") {
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    values.splice(0, 2);
    const options = parseOptions(values, ["--project", "--deployment"]);
    return {
      kind: "promotion-plan",
      projectId: options["--project"],
      sourceDeploymentId: options["--deployment"],
      credentialStore,
    };
  }
  if (first === "deployment" && values[0] === "promote") {
    if (!yes || follow || stdin) throw new InvalidCommandError();
    values.shift();
    const options = parseOptions(values, [
      "--project",
      "--deployment",
      "--if-match",
      "--confirmation-token",
      "--idempotency-key",
    ]);
    return {
      kind: "promote",
      projectId: options["--project"],
      sourceDeploymentId: options["--deployment"],
      ifMatch: options["--if-match"],
      confirmationToken: options["--confirmation-token"],
      idempotencyKey: options["--idempotency-key"],
      yes,
      wait,
      credentialStore,
    };
  }
  if (first === "delete" && values[0] === "plan") {
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    values.shift();
    const options = parseOptions(values, ["--project"]);
    return { kind: "delete-plan", projectId: options["--project"], credentialStore };
  }
  if (first === "delete") {
    if (!yes || wait || follow || stdin) throw new InvalidCommandError();
    const options = parseOptions(values, [
      "--project",
      "--if-match",
      "--confirmation-token",
      "--idempotency-key",
    ]);
    return {
      kind: "delete",
      projectId: options["--project"],
      ifMatch: options["--if-match"],
      confirmationToken: options["--confirmation-token"],
      idempotencyKey: options["--idempotency-key"],
      yes,
      credentialStore,
    };
  }
  if (first === "export" && values[0] === "create") {
    if (yes || wait || follow || !stdin) throw new InvalidCommandError();
    values.shift();
    const options = parseOptions(values, ["--project", "--idempotency-key"]);
    return {
      kind: "export-create",
      projectId: options["--project"],
      idempotencyKey: options["--idempotency-key"],
      stdin,
      credentialStore,
    };
  }
  if (first === "export" && values[0] === "get") {
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    values.shift();
    const exportId = values.shift();
    if (!exportId) throw new InvalidCommandError();
    const options = parseOptions(values, ["--project"]);
    return { kind: "export-get", projectId: options["--project"], exportId, credentialStore };
  }
  if (first === "secret" && values[0] === "list") {
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    values.shift();
    const options = parseOptions(values, ["--project", "--environment"]);
    return {
      kind: "secret-list",
      projectId: options["--project"],
      environmentId: options["--environment"],
      credentialStore,
    };
  }
  if (first === "function" && values[0] === "runs") {
    if (yes || wait || follow || stdin) throw new InvalidCommandError();
    values.shift();
    // --limit is the only optional option: one to one hundred runs, fifty by default.
    const limitIndex = values.indexOf("--limit");
    let limit = 50;
    if (limitIndex !== -1) {
      const raw = values[limitIndex + 1];
      if (typeof raw !== "string" || !/^[1-9][0-9]{0,2}$/u.test(raw) || Number(raw) > 100) {
        throw new InvalidCommandError();
      }
      limit = Number(raw);
      values.splice(limitIndex, 2);
    }
    const options = parseOptions(values, ["--project", "--environment"]);
    return {
      kind: "function-runs",
      projectId: options["--project"],
      environmentId: options["--environment"],
      limit,
      credentialStore,
    };
  }
  if (first === "secret" && values[0] === "set") {
    if (yes || follow || !stdin) throw new InvalidCommandError();
    values.shift();
    const name = values.shift();
    if (!isUserSecretName(name)) throw new InvalidCommandError();
    const options = parseOptionalOptions(values, [
      "--project",
      "--environment",
      "--idempotency-key",
      "--token-user",
      "--token-organization",
      "--profile-user",
      "--profile-organization",
    ]);
    const projectId = options["--project"];
    const environmentId = options["--environment"];
    const idempotencyKey = options["--idempotency-key"];
    const environmentToken = handedAccount(
      options["--token-user"],
      options["--token-organization"],
    );
    const profileAccount = handedAccount(
      options["--profile-user"],
      options["--profile-organization"],
    );
    // A key form and a saved-login form contradict each other; neither wins.
    if (
      projectId === undefined ||
      environmentId === undefined ||
      idempotencyKey === undefined ||
      (environmentToken !== undefined && profileAccount !== undefined)
    )
      throw new InvalidCommandError();
    return {
      kind: "secret-set",
      projectId,
      environmentId,
      name,
      idempotencyKey,
      stdin,
      wait,
      ...(environmentToken === undefined ? {} : { environmentToken }),
      ...(profileAccount === undefined ? {} : { profileAccount }),
      credentialStore,
    };
  }
  if (first === "secret" && values[0] === "delete") {
    if (yes || follow || stdin) throw new InvalidCommandError();
    values.shift();
    const name = values.shift();
    if (!isUserSecretName(name, "delete")) throw new InvalidCommandError();
    const options = parseOptions(values, ["--project", "--environment", "--idempotency-key"]);
    return {
      kind: "secret-delete",
      projectId: options["--project"],
      environmentId: options["--environment"],
      name,
      idempotencyKey: options["--idempotency-key"],
      wait,
      credentialStore,
    };
  }
  if (first === "domain" && values[0] === "paid") {
    const subcommand = values[1];
    values.splice(0, 2);
    if (subcommand === "plan") {
      if (yes || wait || follow || stdin) throw new InvalidCommandError();
      const options = parseOptions(values, ["--project", "--hostname"]);
      if (!validPaidHostname(options["--hostname"])) throw new InvalidCommandError();
      return {
        kind: "paid-domain-plan",
        projectId: options["--project"],
        hostname: options["--hostname"],
        credentialStore,
      };
    }
    if (subcommand === "status") {
      if (yes || wait || follow || stdin) throw new InvalidCommandError();
      const options = parseOptions(values, ["--project"]);
      return { kind: "paid-domain-status", projectId: options["--project"], credentialStore };
    }
    if (subcommand === "apply" || subcommand === "delete") {
      if (!yes || wait || follow || stdin) throw new InvalidCommandError();
      const options = parseOptions(values, ["--project", "--hostname", "--idempotency-key"]);
      if (!validPaidHostname(options["--hostname"])) throw new InvalidCommandError();
      return {
        kind: subcommand === "apply" ? "paid-domain-apply" : "paid-domain-delete",
        projectId: options["--project"],
        hostname: options["--hostname"],
        idempotencyKey: options["--idempotency-key"],
        yes,
        credentialStore,
      };
    }
    throw new InvalidCommandError();
  }
  if (first === "domain" && values[0] === "cloudflare") {
    const subcommand = values[1];
    values.splice(0, 2);
    if (subcommand === "authorize") {
      if (yes || wait || follow || stdin) throw new InvalidCommandError();
      const options = parseOptions(values, ["--project", "--zone", "--idempotency-key"]);
      if (!validPaidHostname(options["--zone"])) throw new InvalidCommandError();
      return {
        kind: "domain-cloudflare-authorize",
        projectId: options["--project"],
        zone: options["--zone"],
        idempotencyKey: options["--idempotency-key"],
        credentialStore,
      };
    }
    if (subcommand === "status") {
      if (yes || wait || follow || stdin) throw new InvalidCommandError();
      const options = parseOptions(values, ["--project"]);
      return {
        kind: "domain-cloudflare-status",
        projectId: options["--project"],
        credentialStore,
      };
    }
    if (subcommand === "apply") {
      if (!yes || !wait || follow || stdin) throw new InvalidCommandError();
      const options = parseOptions(values, ["--project", "--idempotency-key"]);
      return {
        kind: "domain-cloudflare-apply",
        projectId: options["--project"],
        idempotencyKey: options["--idempotency-key"],
        yes,
        wait,
        credentialStore,
      };
    }
    throw new InvalidCommandError();
  }
  if (first === "mail") {
    const area = values.shift();
    const sub =
      area === "webhook" || area === "messages" || area === "domain" ? values.shift() : undefined;
    // Only retiring the mail domain is destructive, and it requires --yes.
    const retiring = area === "domain" && sub === "delete";
    if (yes !== retiring || wait || follow || stdin) throw new InvalidCommandError();
    const options = parseOptionalOptions(values, [
      "--project",
      "--environment",
      "--domain",
      "--sending",
      "--receiving",
      "--url",
      "--idempotency-key",
      "--message",
      "--after",
    ]);
    const required = (key: keyof typeof options) => {
      const value = options[key];
      if (!value) throw new InvalidCommandError();
      return value;
    };
    const scope = { projectId: required("--project"), environmentId: required("--environment") };
    let request: ManagedMailCommand,
      label: Extract<ProductCliCommand, { kind: "managed-mail" }>["label"];
    if (area === "setup" || (area === "domain" && sub === "set")) {
      const sending = required("--sending"),
        receiving = required("--receiving");
      if (!["true", "false"].includes(sending) || !["true", "false"].includes(receiving))
        throw new InvalidCommandError();
      request = {
        ...scope,
        action: "configure",
        domain: required("--domain"),
        sending: sending === "true",
        receiving: receiving === "true",
        idempotencyKey: required("--idempotency-key"),
      };
      label = area === "domain" ? "mail domain set" : "mail setup";
    } else if (area === "status" || (area === "domain" && sub === "status")) {
      request = { ...scope, action: "status" };
      label = area === "domain" ? "mail domain status" : "mail status";
    } else if (retiring) {
      request = {
        ...scope,
        action: "domain_delete",
        idempotencyKey: required("--idempotency-key"),
      };
      label = "mail domain delete";
    } else if (area === "webhook" && sub === "set") {
      request = {
        ...scope,
        action: "webhook_set",
        url: required("--url"),
        idempotencyKey: required("--idempotency-key"),
      };
      label = "mail webhook set";
    } else if (area === "webhook" && (sub === "verify" || sub === "disable")) {
      request = {
        ...scope,
        action: sub === "verify" ? "webhook_verify" : "webhook_disable",
        idempotencyKey: required("--idempotency-key"),
      };
      label = sub === "verify" ? "mail webhook verify" : "mail webhook disable";
    } else if (area === "messages" && sub === "list") {
      request = {
        ...scope,
        action: "messages_list",
        ...(options["--after"] ? { after: options["--after"] } : {}),
      };
      label = "mail messages list";
    } else if (area === "messages" && sub === "get") {
      request = { ...scope, action: "message_get", messageId: required("--message") };
      label = "mail messages get";
    } else if (area === "messages" && sub === "retry") {
      request = {
        ...scope,
        action: "message_retry",
        messageId: required("--message"),
        idempotencyKey: required("--idempotency-key"),
      };
      label = "mail messages retry";
    } else throw new InvalidCommandError();
    return { kind: "managed-mail", request, label, credentialStore };
  }
  throw new InvalidCommandError();
};

const removeFlag = (values: Array<string>, flag: string): boolean => {
  const index = values.indexOf(flag);
  if (index < 0) return false;
  if (values.indexOf(flag, index + 1) >= 0) throw new InvalidCommandError();
  values.splice(index, 1);
  return true;
};

const parseOptions = <T extends string>(
  values: readonly string[],
  allowed: readonly T[],
): Record<T, string> => {
  const result = {} as Record<T, string>;
  for (let index = 0; index < values.length; index += 2) {
    const option = values[index];
    const value = values[index + 1];
    if (option === undefined || !allowed.includes(option as T) || !isValue(value)) {
      throw new InvalidCommandError();
    }
    if (option === "--idempotency-key" && value.length > 128) throw new InvalidCommandError();
    if (option in result) throw new InvalidCommandError();
    result[option as T] = value;
  }
  if (Object.keys(result).length !== allowed.length) throw new InvalidCommandError();
  return result;
};

const deploymentEnvironment = (value: string | undefined): "dev" | "prod" => {
  if (value === undefined || value === "dev") return "dev";
  if (value === "prod") return "prod";
  throw new InvalidCommandError();
};

const parseOptionalOptions = <T extends string>(
  values: readonly string[],
  allowed: readonly T[],
): Partial<Record<T, string>> => {
  const result: Partial<Record<T, string>> = {};
  for (let index = 0; index < values.length; index += 2) {
    const option = values[index];
    const value = values[index + 1];
    if (option === undefined || !allowed.includes(option as T) || !isValue(value)) {
      throw new InvalidCommandError();
    }
    if (option === "--idempotency-key" && value.length > 128) throw new InvalidCommandError();
    if (option in result) throw new InvalidCommandError();
    result[option as T] = value;
  }
  return result;
};

/** A credential lifetime is minutes, hours or plain seconds, always within 5 minutes and 24 hours. */
const accessTtlSeconds = (value: string | undefined): number => {
  if (value === undefined) return 3_600;
  const match = /^(\d{1,6})(m|h)?$/u.exec(value);
  if (!match) throw new InvalidCommandError();
  const amount = Number(match[1]);
  const seconds = match[2] === "m" ? amount * 60 : match[2] === "h" ? amount * 3_600 : amount;
  if (!Number.isSafeInteger(seconds) || seconds < 300 || seconds > 86_400)
    throw new InvalidCommandError();
  return seconds;
};

/** A platform organization identifier as the API returns it. */
const ORGANIZATION_ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

/** The account a command handed to a terminal must run as; never a credential. */
export interface HandedAccount {
  readonly userId: string;
  readonly organizationId: string;
}

/**
 * A user and an organization named together, or neither. A pasted key is refused here, before any
 * message could repeat it.
 */
const handedAccount = (
  userId: string | undefined,
  organizationId: string | undefined,
): HandedAccount | undefined => {
  if (userId === undefined && organizationId === undefined) return undefined;
  if (
    userId === undefined ||
    organizationId === undefined ||
    !isProfileUserId(userId) ||
    WORKOS_USER_API_KEY_PATTERN.test(userId) ||
    !ORGANIZATION_ULID.test(organizationId)
  )
    throw new InvalidCommandError();
  return { userId, organizationId };
};

const isValue = (value: string | undefined): value is string =>
  value !== undefined && value.length > 0 && !value.startsWith("--");

const validGithubBranchName = (value: string): boolean =>
  !(
    value.length < 1 ||
    value.length > 1_024 ||
    !/^[A-Za-z0-9]/u.test(value) ||
    value.startsWith("-") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.includes("//") ||
    value.includes("..") ||
    value.includes("@{") ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x20 || code === 0x7f || "\\~^:?*[]".includes(character);
    }) ||
    value.split("/").some((component) => component.startsWith(".") || component.endsWith(".lock"))
  );

const validPaidHostname = (value: string): boolean =>
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(value) &&
  !value.endsWith(".poc.aixyte.com") &&
  value !== "omh.st" &&
  !value.endsWith(".omh.st") &&
  value !== "ohmyho.st" &&
  !value.endsWith(".ohmyho.st");
