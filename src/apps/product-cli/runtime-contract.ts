import { parseFeedbackSubmissionDetail } from "@ohmyhost/contracts/feedback";
import { parseFrameworkConversionDetail } from "@ohmyhost/contracts/framework-admission";
import {
  parseOperationDeploymentProgress,
  type OperationDeploymentProgress,
} from "@ohmyhost/contracts/operation-deployment-result";
import type {
  GithubConnectionAuthorization,
  GithubOrganizationConnection,
  GithubOrganizationConnectionStatus,
  ProblemDetails,
  OrganizationCredits,
  ProjectCreditBudget,
} from "@ohmyhost/sdk-ts";
import { isSaasCnameTarget, type SaasCnameTarget } from "@ohmyhost/contracts/platform-origins";
import { assertPublishedCreditRateCards } from "@ohmyhost/contracts/credit-pricing";
import {
  publicOperationFailure,
  publicOperationReconciliation,
  type PublicOperationFailure,
  type PublicOperationReconciliation,
} from "@ohmyhost/contracts/operation-failure";
export type { PublicOperationFailure } from "@ohmyhost/contracts/operation-failure";

/** Exported for the documentation build, which publishes one page per code. */
export const PROBLEM_POLICY = {
  cloudflare_zone_not_bound: {
    status: 409,
    retryable: false,
    action:
      "Configure the project domain first with 'ohmyhost domain paid plan' then 'ohmyhost domain paid apply', or configure its sender domain with 'ohmyhost mail setup'. Then request Cloudflare authorization for that domain's zone.",
  },
  github_connection_required: {
    status: 409,
    retryable: false,
    action:
      "This workspace has no GitHub connection yet. Run 'ohmyhost github connect --organization ULID --idempotency-key KEY --json' for it, complete its browser link, then repeat the original source link. If the project belongs to another account, use that account's login instead; error.acting_as names the login this ran as.",
  },
  github_connection_revoked: {
    status: 409,
    retryable: false,
    action:
      "Run 'ohmyhost github connect --organization ULID --idempotency-key KEY --json' to restore this workspace's GitHub connection, then repeat the original source link.",
  },
  repository_not_installed: {
    status: 403,
    retryable: false,
    action:
      "Read 'ohmyhost github status --organization ULID --json', open connection.settings_url and add this repository to the installation. Then repeat the original source link and key.",
  },
  database_write_pending: {
    status: 409,
    retryable: false,
    action: "Poll the original database-write operation before transfer or deletion.",
  },
  cloudflare_authorization_closed: {
    status: 409,
    retryable: false,
    action:
      "Read Cloudflare DNS status. Reuse a valid grant for the requested zone; otherwise request fresh authorization with a new idempotency key. Do not replay the callback.",
  },
  billing_recharge_conflict: {
    status: 409,
    retryable: false,
    action:
      "Read billing recharge get and the current revision. Preserve the original key after uncertainty; do not start a checkout or automatically re-enable charges.",
  },
  billing_purchase_conflict: {
    status: 409,
    retryable: false,
    action:
      "Read the original checkout and use billing portal to manage the existing subscription. Do not create another purchase after uncertainty.",
  },
  compute_performance_paid_required: {
    status: 403,
    retryable: false,
    action: "Check Paid service and usable credits or grace, or choose standard compute.",
  },
  compute_performance_unavailable: {
    status: 503,
    retryable: false,
    action:
      "Choose standard compute or report inactive performance pricing through feedback. Do not repeatedly resubmit.",
  },
  compute_change_pending: {
    status: 409,
    retryable: false,
    action:
      "Poll the existing operation after 60 seconds. Do not submit another size change, deletion or transfer while it runs.",
  },
  compute_change_conflict: {
    status: 409,
    retryable: false,
    action:
      "Read the original operation and current database compute. Preserve data and report unresolved conflicts through feedback with the operation ID.",
  },
  database_access_limit: {
    status: 409,
    retryable: false,
    action:
      "List the project's database credentials and revoke one you no longer need, then request access again.",
  },
  project_notes_conflict: {
    status: 409,
    retryable: false,
    action:
      "Read project context, merge the current notes and retry with its version and a new idempotency key.",
  },
  invalid_request: { status: 400, retryable: false, action: "Check the request and retry." },
  unauthenticated: {
    status: 401,
    retryable: false,
    action:
      "Check OHMYHOST_TOKEN and the selected environment. Replace invalid tokens, or unset OHMYHOST_TOKEN and run 'ohmyhost login'.",
  },
  forbidden: { status: 403, retryable: false, action: "Check organization access." },
  organization_required: {
    status: 409,
    retryable: false,
    action:
      "Run 'ohmyhost organization list --json' and select one with 'ohmyhost organization use --organization ULID --json', or create the first workspace.",
  },
  resource_not_found: {
    status: 404,
    retryable: false,
    action:
      "Check the resource identifier and the account: a project is visible only to its own organization, and error.acting_as names the login this ran as. Use the login of the account that owns it.",
  },
  idempotency_key_reused: {
    status: 409,
    retryable: false,
    action: "Use a new idempotency key for a different request.",
  },
  project_handle_unavailable: {
    status: 503,
    retryable: true,
    action: "Retry project creation with the same idempotency key.",
  },
  project_handle_taken: {
    status: 409,
    retryable: false,
    action:
      "Run 'ohmyhost project handle check' for a free address, then rename to one of the alternatives it returns.",
  },
  project_handle_invalid: {
    status: 409,
    retryable: false,
    action:
      "Choose one to five lowercase words of letters and digits, three to fifty-nine characters, avoiding reserved words.",
  },
  project_handle_unchanged: {
    status: 409,
    retryable: false,
    action: "The project already answers on this address; no rename is needed.",
  },
  project_rename_blocked: {
    status: 409,
    retryable: true,
    action:
      "Wait for the running operation to finish, read the project again, then rename with the new ETag.",
  },
  project_identity_unavailable: {
    status: 503,
    retryable: true,
    action: "Retry project creation with the same idempotency key.",
  },
  deployment_plan_expired: {
    status: 409,
    retryable: false,
    action: "Run 'ohmyhost plan' again, then deploy the new plan.",
  },
  deployment_plan_incompatible: {
    status: 409,
    retryable: false,
    action: "Run 'ohmyhost plan' again with the current source revision.",
  },
  confirmation_expired: {
    status: 409,
    retryable: false,
    action: "Plan the destructive action again before confirming it.",
  },
  confirmation_invalid: {
    status: 409,
    retryable: false,
    action: "Use the confirmation token from a fresh matching plan.",
  },
  etag_mismatch: {
    status: 409,
    retryable: false,
    action: "Refresh the resource, plan the action again, and retry.",
  },
  promotion_source_stale: {
    status: 409,
    retryable: false,
    action: "Read the current dev deployment, then plan promotion again.",
  },
  promotion_target_stale: {
    status: 409,
    retryable: false,
    action: "Read the current prod status, then plan promotion again.",
  },
  promotion_invalid_target: {
    status: 409,
    retryable: false,
    action: "Select the current succeeded dev deployment and target prod.",
  },
  mail_capacity_unavailable: {
    status: 503,
    retryable: true,
    action:
      "Report this request ID through feedback. The stored mail setup continues automatically once ohmyho.st has capacity; follow mail status and keep the original idempotency key.",
  },
  mail_domain_conflict: {
    status: 409,
    retryable: false,
    action: "Read and use the sender domain already configured for this project.",
  },
  mail_domain_required: {
    status: 409,
    retryable: false,
    action:
      "This app declares mail.enabled. Configure the project's own sender domain with 'ohmyhost mail setup' using its Prod environment ID, or set mail.enabled to false if the app sends no mail, then plan again.",
  },
  storage_jurisdiction_conflict: {
    status: 409,
    retryable: false,
    action:
      "Set storage.jurisdiction in ohmyhost.yaml to the project's hosting region shown by project status, then plan again.",
  },
  shared_data_requires_promotion: {
    status: 409,
    retryable: false,
    action:
      "Plan and deploy this commit to Dev, then run 'ohmyhost deployment promote plan' to reach Prod.",
  },
  production_deployment_required: {
    status: 409,
    retryable: false,
    action:
      "Deploy to Prod first: run 'ohmyhost plan --environment prod' and deploy that plan, or promote the current Dev deployment with 'ohmyhost deployment promote plan'. Then plan the domain again.",
  },
  framework_conversion_required: {
    status: 409,
    retryable: false,
    action:
      "Run 'ohmyhost init', apply the matching ohmyhost framework skill, then plan the new commit.",
  },
  repository_configuration_missing: {
    status: 409,
    retryable: false,
    action:
      "Place ohmyhost.yaml at the Git repository root and set applicationRoot to the application directory (for example website). Commit and push the change, then plan the new commit.",
  },
  migration_filename_noncanonical: {
    status: 409,
    retryable: false,
    action:
      "Rename every migration to YYYYMMDDHHMMSS_name.sql, commit the change, then plan again.",
  },
  environment_secret_mutation_blocked: {
    status: 409,
    retryable: true,
    action: "Wait for the active deployment or rollback to finish, then retry unchanged.",
  },
  workers_runtime_incompatible: {
    status: 409,
    retryable: false,
    action: "Remove or replace the reported module, commit the change, then create a new plan.",
  },
  payload_too_large: { status: 413, retryable: false, action: "Reduce the request size." },
  project_export_not_ready: {
    status: 409,
    retryable: false,
    action: "Finish database provisioning, then request the export again. No backup was accepted.",
  },
  powered_by_flag_required: {
    status: 409,
    retryable: false,
    action:
      "Keep the flag on, remove the custom domain with 'ohmyhost domain paid delete', or buy Paid, then switch the flag off.",
  },
  rate_limited: { status: 429, retryable: true, action: "Retry after the server delay." },
  insufficient_organization_credits: {
    status: 402,
    retryable: false,
    action:
      "Add organization credits or wait for reservations to settle, then retry the same request.",
  },
  project_budget_exceeded: {
    status: 402,
    retryable: false,
    action: "Raise the project's stop budget or select continue, then retry the same request.",
  },
  paid_plan_required: {
    status: 402,
    retryable: false,
    action:
      "Ask the organization Owner to activate Paid through billing checkout, then retry. Top-ups and signup credits do not activate Paid. For a website domain alone, a Free workspace may instead show the powered-by flag on the project.",
  },
  interactive_login_required: {
    status: 403,
    retryable: false,
    action:
      "Unset OHMYHOST_TOKEN and run ohmyhost login before managing tokens. Existing token files remain unchanged.",
  },
  api_key_creation_uncertain: {
    status: 503,
    retryable: true,
    action:
      "Repeat the original token name and Idempotency-Key to observe its result; do not blindly create another key.",
  },
  api_key_permissions_unavailable: {
    status: 503,
    retryable: false,
    action:
      "Report the platform user-key permission configuration through feedback. Repeated login or creation will not fix it.",
  },
  reconciliation_exhausted: {
    status: 409,
    retryable: false,
    action:
      "Stop retries and submit feedback with this operation ID. A platform recovery review is required.",
  },
  service_unavailable: { status: 503, retryable: true, action: "Retry later." },
} as const satisfies Readonly<
  Record<
    ProblemDetails["code"],
    { readonly status: number; readonly retryable: boolean; readonly action: string }
  >
>;

type ProblemCode = keyof typeof PROBLEM_POLICY;

export class ResponseContractError extends Error {
  public constructor() {
    super("The server response does not match the public contract.");
    this.name = "ResponseContractError";
  }
}

export interface SafeProblem {
  readonly requestId: string;
  /** The error's documentation page, when the server names one on docs.ohmyho.st. */
  readonly docsUrl?: string;
  readonly retryAfterSeconds?: number;
  readonly code: ProblemCode;
  readonly retryable: boolean;
  readonly suggestedAction: string;
}

export interface PublicCurrentIdentity {
  readonly actor_id: string;
  readonly organization_ids: readonly string[];
}

/** One workspace the signed-in user belongs to, with the provider identity a selection needs. */
export interface PublicWorkspace {
  readonly id: string;
  readonly workos_id: string;
  readonly name: string;
}

export interface PublicDevAccessTicket {
  readonly ticket_id: string;
  readonly project_id: string;
  readonly environment_id: string;
  readonly origin: string;
  readonly redeem_url: string;
  readonly expires_at: string;
}

export interface PublicProjectDatabaseQuery {
  readonly environment: "dev" | "prod";
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly row_count: number;
  readonly truncated: boolean;
}

export interface PublicPaidDomainPlan {
  readonly status: "planned";
  readonly hostname: string;
  readonly environment: "prod";
  readonly cname_target: SaasCnameTarget;
  readonly effects: readonly string[];
  readonly risks: readonly string[];
}

export interface PublicPaidDomain {
  readonly status:
    | "not_configured"
    | "pending"
    | "active"
    | "reconciliation_required"
    | "deleted"
    | "suspended";
  readonly suspension_reason:
    | "paid_plan_required"
    | "insufficient_organization_credits"
    | "project_budget_exceeded"
    | null;
  readonly hostname: string | null;
  readonly environment: "prod";
  readonly cname_target: SaasCnameTarget;
  readonly custom_hostname_status: string | null;
  readonly ssl_status: string | null;
  readonly validation_records: readonly Readonly<Record<string, unknown>>[];
  readonly url: string | null;
}

export const parsePaidDomainPlan = (value: unknown): PublicPaidDomainPlan => {
  const input = exactRecord(value, [
    "cname_target",
    "effects",
    "environment",
    "hostname",
    "risks",
    "status",
  ]);
  if (
    input["status"] !== "planned" ||
    input["environment"] !== "prod" ||
    !isSaasCnameTarget(input["cname_target"]) ||
    !isPaidHostname(input["hostname"]) ||
    !shortStringArray(input["effects"], 8, 512) ||
    !shortStringArray(input["risks"], 8, 512)
  ) {
    throw new ResponseContractError();
  }
  return input as unknown as PublicPaidDomainPlan;
};

export const parsePaidDomain = (value: unknown): PublicPaidDomain => {
  const input = exactRecord(value, [
    "cname_target",
    "custom_hostname_status",
    "environment",
    "hostname",
    "ssl_status",
    "status",
    "suspension_reason",
    "url",
    "validation_records",
  ]);
  const status = input["status"];
  const hostname = input["hostname"];
  const records = input["validation_records"];
  if (
    ![
      "not_configured",
      "pending",
      "active",
      "reconciliation_required",
      "deleted",
      "suspended",
    ].includes(String(status)) ||
    ![
      null,
      "paid_plan_required",
      "insufficient_organization_credits",
      "project_budget_exceeded",
    ].includes(input["suspension_reason"] as null | string) ||
    (status === "suspended") !== (input["suspension_reason"] !== null) ||
    (status === "suspended" && input["url"] !== null) ||
    input["environment"] !== "prod" ||
    !isSaasCnameTarget(input["cname_target"]) ||
    (hostname !== null && !isPaidHostname(hostname)) ||
    (input["custom_hostname_status"] !== null &&
      typeof input["custom_hostname_status"] !== "string") ||
    (input["ssl_status"] !== null && typeof input["ssl_status"] !== "string") ||
    !Array.isArray(records) ||
    records.length > 16 ||
    !records.every(isPaidValidationRecord) ||
    (input["url"] !== null && input["url"] !== `https://${String(hostname)}`)
  ) {
    throw new ResponseContractError();
  }
  return input as unknown as PublicPaidDomain;
};

export const parseProjectDatabaseQuery = (value: unknown): PublicProjectDatabaseQuery => {
  const input = exactRecord(value, ["environment", "row_count", "rows", "truncated"]);
  const rows = input["rows"];
  if (
    (input["environment"] !== "dev" && input["environment"] !== "prod") ||
    !Array.isArray(rows) ||
    rows.length > 100 ||
    !rows.every((row) => typeof row === "object" && row !== null && !Array.isArray(row)) ||
    !Number.isSafeInteger(input["row_count"]) ||
    input["row_count"] !== rows.length ||
    typeof input["truncated"] !== "boolean"
  ) {
    throw new ResponseContractError();
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    throw new ResponseContractError();
  }
  if (new TextEncoder().encode(encoded).byteLength > 256 * 1_024) {
    throw new ResponseContractError();
  }
  return input as unknown as PublicProjectDatabaseQuery;
};

export interface PublicCloudflareDnsAuthorization {
  readonly authorization_id: string;
  readonly authorization_url: string;
  readonly expires_at: string;
}

export interface PublicCloudflareDnsAuthorizationStatus {
  readonly status: "not_authorized" | "pending" | "authorized" | "expired" | "revoked";
  readonly zone: string | null;
  readonly scopes: readonly ("dns.write" | "zone.read")[];
  readonly expires_at: string | null;
}

export const parseCloudflareDnsAuthorization = (
  value: unknown,
): PublicCloudflareDnsAuthorization => {
  const input = exactRecord(value, ["authorization_id", "authorization_url", "expires_at"]);
  const authorizationUrl = input["authorization_url"];
  if (
    !isUlid(input["authorization_id"]) ||
    !boundedString(authorizationUrl, 20, 4096) ||
    !isIsoInstant(input["expires_at"])
  ) {
    throw new ResponseContractError();
  }
  let url: URL;
  try {
    url = new URL(authorizationUrl);
  } catch {
    throw new ResponseContractError();
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hostname !== "dash.cloudflare.com" ||
    url.pathname !== "/oauth2/auth" ||
    url.hash !== "" ||
    !url.searchParams.has("client_id") ||
    !url.searchParams.has("state")
  ) {
    throw new ResponseContractError();
  }
  return input as unknown as PublicCloudflareDnsAuthorization;
};

const parseGithubOrganizationConnection = (value: unknown): GithubOrganizationConnection => {
  const input = exactRecord(value, [
    "connection_id",
    "organization_id",
    "installation_id",
    "account_id",
    "account_login",
    "account_type",
    "github_user_id",
    "github_user_login",
    "connected_at",
    "revoked_at",
    "settings_url",
  ]);
  if (
    !isUlid(input["connection_id"]) ||
    !isUlid(input["organization_id"]) ||
    !["installation_id", "account_id", "github_user_id"].every(
      (key) => typeof input[key] === "string" && /^[1-9][0-9]{0,19}$/u.test(input[key]),
    ) ||
    !["account_login", "github_user_login"].every(
      (key) =>
        typeof input[key] === "string" &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(input[key]),
    ) ||
    !["User", "Organization"].includes(String(input["account_type"])) ||
    !isIsoInstant(input["connected_at"]) ||
    (input["revoked_at"] !== null && !isIsoInstant(input["revoked_at"]))
  )
    throw new ResponseContractError();
  const expected =
    input["account_type"] === "User"
      ? `https://github.com/settings/installations/${String(input["installation_id"])}`
      : `https://github.com/organizations/${String(input["account_login"])}/settings/installations/${String(input["installation_id"])}`;
  if (input["settings_url"] !== expected) throw new ResponseContractError();
  return input as unknown as GithubOrganizationConnection;
};

export const parseGithubOrganizationConnectionStatus = (
  value: unknown,
): GithubOrganizationConnectionStatus => {
  const input = exactRecord(value, ["status", "connection"]);
  if (!["not_connected", "connected", "revoked"].includes(String(input["status"])))
    throw new ResponseContractError();
  if (input["status"] === "not_connected") {
    if (input["connection"] !== null) throw new ResponseContractError();
  } else {
    const connection = parseGithubOrganizationConnection(input["connection"]);
    if ((input["status"] === "connected") !== (connection.revoked_at === null))
      throw new ResponseContractError();
  }
  return input as unknown as GithubOrganizationConnectionStatus;
};

export const parseGithubConnectionAuthorization = (
  value: unknown,
): GithubConnectionAuthorization => {
  const input = exactRecord(value, [
    "authorization_id",
    "status",
    "last_failure",
    "authorization_url",
    "expires_at",
    "connection",
  ]);
  if (
    !["pending", "authorizing", "connected", "failed", "expired"].includes(
      String(input["status"]),
    ) ||
    !(
      input["last_failure"] === null ||
      [
        "installation_access_required",
        "account_admin_required",
        "authorization_code_rejected",
        "provider_unavailable",
        "expired",
        "session_inactive",
        "denied",
        "code_spent",
        "state_unknown",
      ].includes(String(input["last_failure"]))
    )
  )
    throw new ResponseContractError();
  if (input["authorization_id"] === null || input["expires_at"] === null) {
    if (
      input["status"] !== "connected" ||
      input["authorization_id"] !== null ||
      input["expires_at"] !== null
    )
      throw new ResponseContractError();
  } else if (!isUlid(input["authorization_id"]) || !isIsoInstant(input["expires_at"]))
    throw new ResponseContractError();
  if (input["status"] === "pending") {
    let url: URL;
    try {
      url = new URL(String(input["authorization_url"]));
    } catch {
      throw new ResponseContractError();
    }
    const keys = [...url.searchParams.keys()];
    const installation =
      /^\/apps\/[a-z0-9-]+\/installations\/new$/u.test(url.pathname) &&
      keys.length === 1 &&
      keys[0] === "state";
    const oauthKeys = [
      "client_id",
      "redirect_uri",
      "state",
      "code_challenge",
      "code_challenge_method",
      "prompt",
    ];
    const oauth =
      url.pathname === "/login/oauth/authorize" &&
      keys.length === oauthKeys.length &&
      new Set(keys).size === keys.length &&
      keys.every((key) => oauthKeys.includes(key)) &&
      /^[A-Za-z0-9_]{1,256}$/u.test(url.searchParams.get("client_id") ?? "") &&
      [
        "https://app.ohmyho.st/v1/github/oauth/callback",
        "https://dev.app.ohmyho.st/v1/github/oauth/callback",
      ].includes(url.searchParams.get("redirect_uri") ?? "") &&
      /^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get("code_challenge") ?? "") &&
      url.searchParams.get("code_challenge_method") === "S256" &&
      url.searchParams.get("prompt") === "select_account";
    if (
      url.origin !== "https://github.com" ||
      url.username ||
      url.password ||
      url.hash ||
      !boundedString(url.searchParams.get("state"), 1, 512) ||
      !(installation || oauth)
    )
      throw new ResponseContractError();
  } else if (input["authorization_url"] !== null) throw new ResponseContractError();
  if (input["status"] === "connected") {
    if (
      parseGithubOrganizationConnection(input["connection"]).revoked_at !== null ||
      input["last_failure"] !== null
    )
      throw new ResponseContractError();
  } else if (input["connection"] !== null) throw new ResponseContractError();
  return input as unknown as GithubConnectionAuthorization;
};

export const parseCloudflareDnsAuthorizationStatus = (
  value: unknown,
): PublicCloudflareDnsAuthorizationStatus => {
  const input = exactRecord(value, ["status", "zone", "scopes", "expires_at"]);
  const status = input["status"];
  const scopes = input["scopes"];
  if (
    (status !== "not_authorized" &&
      status !== "pending" &&
      status !== "authorized" &&
      status !== "expired" &&
      status !== "revoked") ||
    (status === "not_authorized"
      ? input["zone"] !== null
      : typeof input["zone"] !== "string" || !isPaidHostname(input["zone"])) ||
    !Array.isArray(scopes) ||
    scopes.length > 2 ||
    scopes.some((scope) => scope !== "dns.write" && scope !== "zone.read") ||
    new Set(scopes).size !== scopes.length ||
    (input["expires_at"] !== null && !isIsoInstant(input["expires_at"])) ||
    (status === "authorized" && [...scopes].sort().join(",") !== "dns.write,zone.read") ||
    (status === "not_authorized" && (scopes.length !== 0 || input["expires_at"] !== null))
  ) {
    throw new ResponseContractError();
  }
  return input as unknown as PublicCloudflareDnsAuthorizationStatus;
};

export interface PublicDevAccessState {
  readonly project_id: string;
  readonly mode: "protected" | "public";
  readonly share_url: string | null;
}

export const parseDevAccessState = (value: unknown): PublicDevAccessState => {
  const input = exactRecord(value, ["project_id", "mode", "share_url"]);
  if (
    !isUlid(input["project_id"]) ||
    (input["mode"] !== "protected" && input["mode"] !== "public") ||
    (input["mode"] === "public" && input["share_url"] !== null) ||
    (input["share_url"] !== null &&
      (typeof input["share_url"] !== "string" ||
        !/^https:\/\/dev-[a-z0-9]+(?:-[a-z0-9]+){0,4}\.(?:dev\.)?check\.omh\.st\/\.ohmyhost\/dev-access\/redeem\?stage=dev&ticket=[A-Za-z0-9_-]{43}$/u.test(
          input["share_url"],
        )))
  )
    throw new ResponseContractError();
  return input as unknown as PublicDevAccessState;
};

export interface PublicPoweredByFlag {
  readonly project_id: string;
  readonly enabled: boolean;
  readonly enabled_at: string | null;
}

export const parsePoweredByFlag = (value: unknown): PublicPoweredByFlag => {
  const input = exactRecord(value, ["project_id", "enabled", "enabled_at"]);
  if (
    !isUlid(input["project_id"]) ||
    typeof input["enabled"] !== "boolean" ||
    (input["enabled"] ? !isIsoInstant(input["enabled_at"]) : input["enabled_at"] !== null)
  )
    throw new ResponseContractError();
  return input as unknown as PublicPoweredByFlag;
};

export interface PublicOrganizationReferral {
  readonly organization_id: string;
  readonly referral_url: string;
}

export const parseOrganizationReferral = (value: unknown): PublicOrganizationReferral => {
  const input = exactRecord(value, ["organization_id", "referral_url"]);
  if (
    !isUlid(input["organization_id"]) ||
    input["referral_url"] !==
      `https://ohmyho.st/?r=ref-${String(input["organization_id"]).toLowerCase()}`
  )
    throw new ResponseContractError();
  return input as unknown as PublicOrganizationReferral;
};

export const parseDevAccessTicket = (value: unknown): PublicDevAccessTicket => {
  const input = exactRecord(value, [
    "ticket_id",
    "project_id",
    "environment_id",
    "origin",
    "redeem_url",
    "expires_at",
  ]);
  const origin = input["origin"];
  const redeemUrl = input["redeem_url"];
  if (
    !isUlid(input["ticket_id"]) ||
    !isUlid(input["project_id"]) ||
    !isUlid(input["environment_id"]) ||
    typeof origin !== "string" ||
    !/^https:\/\/dev-[a-z0-9]+(?:-[a-z0-9]+){0,4}\.(?:dev\.)?check\.omh\.st$/u.test(origin) ||
    typeof redeemUrl !== "string" ||
    !/^https:\/\/dev-[a-z0-9]+(?:-[a-z0-9]+){0,4}\.(?:dev\.)?check\.omh\.st\/\.ohmyhost\/dev-access\/redeem\?stage=dev&ticket=[A-Za-z0-9_-]{43}$/u.test(
      redeemUrl,
    ) ||
    new URL(redeemUrl).origin !== origin ||
    !isIsoInstant(input["expires_at"])
  ) {
    throw new ResponseContractError();
  }
  return input as unknown as PublicDevAccessTicket;
};

export const parseOrganization = (
  value: unknown,
): { readonly id: string; readonly name: string } => {
  const input = exactRecord(value, ["id", "name"]);
  if (
    !isUlid(input["id"]) ||
    typeof input["name"] !== "string" ||
    input["name"].length < 1 ||
    input["name"].length > 128
  )
    throw new ResponseContractError();
  return { id: input["id"], name: input["name"] };
};

export function parseOrganizationCredits(value: unknown): OrganizationCredits {
  const input = exactRecord(value, [
    "organization_id",
    "unit",
    "as_of",
    "available_micros",
    "reserved_micros",
    "spent_micros",
    "expired_micros",
    "platform_overrun_micros",
    "grace_started_at",
    "grace_expires_at",
    "active_meters",
    "rate_cards",
  ]);
  try {
    assertPublishedCreditRateCards(input["rate_cards"]);
  } catch {
    throw new ResponseContractError();
  }
  const graceStart = input["grace_started_at"],
    graceEnd = input["grace_expires_at"];
  if (
    !(graceStart === null && graceEnd === null) &&
    !(
      isIsoInstant(graceStart) &&
      isIsoInstant(graceEnd) &&
      Date.parse(graceEnd) - Date.parse(graceStart) === 604_800_000
    )
  )
    throw new ResponseContractError();
  if (
    !isUlid(input["organization_id"]) ||
    input["unit"] !== "microcredits" ||
    !isIsoInstant(input["as_of"]) ||
    !Array.isArray(input["active_meters"]) ||
    input["active_meters"].some(
      (m: unknown) => typeof m !== "string" || !/^[a-z0-9_.-]{1,128}$/u.test(m),
    )
  )
    throw new ResponseContractError();
  for (const field of [
    "available_micros",
    "reserved_micros",
    "spent_micros",
    "expired_micros",
    "platform_overrun_micros",
  ]) {
    const amount = input[field];
    if (
      typeof amount !== "string" ||
      !/^(0|[1-9][0-9]{0,18})$/u.test(amount) ||
      BigInt(amount) > 9223372036854775807n
    )
      throw new ResponseContractError();
  }
  return input as unknown as OrganizationCredits;
}

export function parseProjectCreditBudget(value: unknown): ProjectCreditBudget {
  const input = exactRecord(value, [
    "project_id",
    "amount_micros",
    "mode",
    "used_micros",
    "reserved_micros",
    "period_start",
    "period_end",
    "as_of",
  ]);
  if (
    !isUlid(input["project_id"]) ||
    (input["mode"] !== "continue" && input["mode"] !== "stop") ||
    (input["amount_micros"] === null && input["mode"] !== "continue")
  )
    throw new ResponseContractError();
  for (const field of ["amount_micros", "used_micros", "reserved_micros"]) {
    const amount = input[field];
    if (field === "amount_micros" && amount === null) continue;
    if (
      typeof amount !== "string" ||
      !/^(0|[1-9][0-9]{0,18})$/u.test(amount) ||
      BigInt(amount) > 9223372036854775807n
    )
      throw new ResponseContractError();
  }
  for (const field of ["period_start", "period_end", "as_of"])
    if (!isIsoInstant(input[field])) throw new ResponseContractError();
  return input as unknown as ProjectCreditBudget;
}

export const parseCurrentIdentity = (value: unknown): PublicCurrentIdentity => {
  const input = exactRecord(value, ["actor_id", "organization_ids"]);
  const organizationIds = input["organization_ids"];
  if (
    typeof input["actor_id"] !== "string" ||
    input["actor_id"].length === 0 ||
    input["actor_id"].length > 256 ||
    [...input["actor_id"]].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    }) ||
    !Array.isArray(organizationIds) ||
    organizationIds.some((organizationId) => !isUlid(organizationId)) ||
    new Set(organizationIds).size !== organizationIds.length
  ) {
    throw new ResponseContractError();
  }
  return input as unknown as PublicCurrentIdentity;
};

/** The signed-in user and the workspaces it belongs to, as `GET /v1/me/profile` reports them. */
export interface PublicAccount {
  readonly userId: string;
  readonly organizations: readonly PublicWorkspace[];
}

export const parseAccountProfile = (value: unknown): PublicAccount => {
  const input = exactRecord(value, [
    "user_id",
    "name",
    "email",
    "email_verified",
    "organizations",
    "organization_ids",
    "signup_source",
    "attributed_at",
    "initial_workspace_id",
  ]);
  const organizations = input["organizations"];
  const organizationIds = input["organization_ids"];
  if (
    !boundedString(input["user_id"], 1, 128) ||
    !Array.isArray(organizations) ||
    !Array.isArray(organizationIds) ||
    organizationIds.some((organizationId) => !isUlid(organizationId)) ||
    new Set(organizationIds).size !== organizationIds.length
  ) {
    throw new ResponseContractError();
  }
  const workspaces = organizations.map((organization: unknown) => {
    const entry = exactRecord(organization, ["id", "workos_id", "name"]);
    if (
      !isUlid(entry["id"]) ||
      !organizationIds.includes(entry["id"]) ||
      !boundedString(entry["workos_id"], 1, 128) ||
      !/^org_[A-Za-z0-9_]{1,120}$/u.test(entry["workos_id"]) ||
      !boundedString(entry["name"], 1, 128)
    ) {
      throw new ResponseContractError();
    }
    return { id: entry["id"], workos_id: entry["workos_id"], name: entry["name"] };
  });
  if (new Set(workspaces.map((workspace) => workspace.id)).size !== organizationIds.length)
    throw new ResponseContractError();
  return { userId: input["user_id"] as string, organizations: workspaces };
};

export interface PublicProject {
  readonly id: string;
  readonly organization_id: string;
  readonly name: string;
  readonly handle: string;
  readonly data_mode: "shared" | "isolated";
  readonly region: "us" | "eu";
  readonly created_at: string;
}

const parseProject = (value: unknown): PublicProject => {
  const input = exactRecord(value, [
    "id",
    "organization_id",
    "name",
    "handle",
    "data_mode",
    "region",
    "created_at",
  ]);
  if (
    !isUlid(input["id"]) ||
    !isUlid(input["organization_id"]) ||
    !boundedString(input["name"], 1, 128) ||
    input["name"] !== input["name"].trim() ||
    !boundedString(input["handle"], 3, 59) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+){0,4}$/u.test(input["handle"]) ||
    (input["data_mode"] !== "shared" && input["data_mode"] !== "isolated") ||
    (input["region"] !== "us" && input["region"] !== "eu") ||
    !isIsoInstant(input["created_at"])
  ) {
    throw new ResponseContractError();
  }
  return input as unknown as PublicProject;
};

export const parseProjectPage = (
  value: unknown,
): Readonly<{ items: readonly PublicProject[]; next_cursor?: string }> => {
  const input = exactRecord(value, ["items", "next_cursor"]);
  if (
    !Array.isArray(input["items"]) ||
    (input["next_cursor"] !== undefined && !isUlid(input["next_cursor"]))
  ) {
    throw new ResponseContractError();
  }
  return Object.freeze({
    items: input["items"].map(parseProject),
    ...(input["next_cursor"] === undefined ? {} : { next_cursor: input["next_cursor"] }),
  });
};

export const parseProjectStatus = (value: unknown): Readonly<Record<string, unknown>> => {
  const input = exactRecord(value, [
    "project_id",
    "etag",
    "handle",
    "region",
    "dev_access_mode",
    "lifecycle",
    "source",
    "default_environment",
    "environments",
    "head_deployment",
    "dev_url",
    "prod_url",
    "latest_operation",
    "cleanup_state",
  ]);
  const handle = input["handle"];
  if (
    !isUlid(input["project_id"]) ||
    typeof input["etag"] !== "string" ||
    !/^"sha256-[a-f0-9]{64}"$/u.test(input["etag"]) ||
    !boundedString(handle, 3, 59) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+){0,4}$/u.test(handle) ||
    (input["region"] !== "us" && input["region"] !== "eu") ||
    (input["dev_access_mode"] !== "protected" && input["dev_access_mode"] !== "public") ||
    (input["lifecycle"] !== "active" &&
      input["lifecycle"] !== "deleting" &&
      input["lifecycle"] !== "deleted") ||
    (input["dev_url"] !== null &&
      ![`https://dev-${handle}.dev.check.omh.st`, `https://dev-${handle}.check.omh.st`].includes(
        String(input["dev_url"]),
      )) ||
    (input["prod_url"] !== null &&
      ![`https://${handle}.dev.check.omh.st`, `https://${handle}.check.omh.st`].includes(
        String(input["prod_url"]),
      )) ||
    (input["cleanup_state"] !== "not_started" &&
      input["cleanup_state"] !== "pending" &&
      input["cleanup_state"] !== "completed" &&
      input["cleanup_state"] !== "reconciliation_required")
  ) {
    throw new ResponseContractError();
  }
  if (input["source"] !== null) parseProjectSource(input["source"]);
  if (input["default_environment"] !== null) {
    const environment = exactRecord(input["default_environment"], ["id", "name"]);
    if (!isUlid(environment["id"]) || !boundedString(environment["name"], 1, 128)) {
      throw new ResponseContractError();
    }
  }
  if (input["head_deployment"] !== null) parseProjectDeployment(input["head_deployment"]);
  if (input["environments"] !== undefined) {
    const environments = input["environments"];
    if (!Array.isArray(environments) || environments.length > 2) throw new ResponseContractError();
    const ids = new Set<string>(),
      names = new Set<string>();
    for (const raw of environments) {
      const environment = exactRecord(raw, ["id", "name"]);
      const id = environment["id"],
        name = environment["name"];
      if (
        !isUlid(id) ||
        (name !== "dev" && name !== "prod") ||
        ids.has(id as string) ||
        names.has(name)
      )
        throw new ResponseContractError();
      ids.add(id as string);
      names.add(name);
    }
  }
  if (input["latest_operation"] !== null) parseOperation(input["latest_operation"]);
  return input;
};

const parseProjectSource = (value: unknown): void => {
  const input = exactRecord(value, [
    "provider",
    "installation_id",
    "repository_full_name",
    "status",
    "linked_at",
    "updated_at",
    "failure_summary",
  ]);
  if (
    input["provider"] !== "github" ||
    typeof input["installation_id"] !== "string" ||
    !/^[1-9][0-9]{0,19}$/u.test(input["installation_id"]) ||
    typeof input["repository_full_name"] !== "string" ||
    !/^[^/]+\/[^/]+$/u.test(input["repository_full_name"]) ||
    (input["status"] !== "pending" &&
      input["status"] !== "ready" &&
      input["status"] !== "failed" &&
      input["status"] !== "revoked") ||
    !isIsoInstant(input["linked_at"]) ||
    !isIsoInstant(input["updated_at"]) ||
    (input["failure_summary"] !== undefined && !boundedString(input["failure_summary"], 1, 512))
  ) {
    throw new ResponseContractError();
  }
};

const parseProjectDeployment = (value: unknown): void => {
  const input = exactRecord(value, [
    "id",
    "project_id",
    "operation_id",
    "commit_sha",
    "source_digest",
    "build_plan_digest",
    "artifact_digest",
    "status",
    "url",
    "created_at",
    "updated_at",
  ]);
  if (
    !isUlid(input["id"]) ||
    !isUlid(input["project_id"]) ||
    !isUlid(input["operation_id"]) ||
    !isCommitSha(input["commit_sha"]) ||
    !isDigest(input["source_digest"]) ||
    !isDigest(input["build_plan_digest"]) ||
    (input["artifact_digest"] !== undefined && !isDigest(input["artifact_digest"])) ||
    typeof input["status"] !== "string" ||
    ![
      "queued",
      "building",
      "publishing",
      "active",
      "failed",
      "rolled_back",
      "deleting",
      "deleted",
      "reconciliation_required",
    ].includes(input["status"]) ||
    (input["url"] !== undefined && !isHttpsUrlValue(input["url"])) ||
    !isIsoInstant(input["created_at"]) ||
    !isIsoInstant(input["updated_at"])
  ) {
    throw new ResponseContractError();
  }
};

export interface PublicOperation {
  readonly blocking_operation_id?: string;
  /** The deployment this operation created; its diagnostics explain a failure. */
  readonly deployment_id?: string;
  readonly progress?: OperationDeploymentProgress;
  readonly id: string;
  readonly state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  readonly created_at: string;
  readonly updated_at: string;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly error?: PublicOperationFailure;
  readonly reconciliation?: PublicOperationReconciliation;
}

export interface PublicProviderReconciliationAttempt {
  readonly reconciliation_id: string;
  readonly operation_id: string;
  readonly state: "completed" | "pending" | "uncertain";
}

export const parseProviderReconciliationAttempt = (
  value: unknown,
): PublicProviderReconciliationAttempt => {
  const input = exactRecord(value, ["reconciliation_id", "operation_id", "state"]);
  if (
    !isUlid(input["reconciliation_id"]) ||
    !isUlid(input["operation_id"]) ||
    (input["state"] !== "completed" &&
      input["state"] !== "pending" &&
      input["state"] !== "uncertain")
  ) {
    throw new ResponseContractError();
  }
  return input as unknown as PublicProviderReconciliationAttempt;
};

export interface PublicEnvironmentSecret {
  readonly name: string;
  readonly revision: number;
  readonly key_version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly desired_generation: number;
  readonly applied_generation: number;
  readonly delivery_state: "not_deployed" | "pending" | "ready" | "failed";
  readonly runtime_provider: "wfp" | null;
  readonly applied_secret_count: number;
  readonly last_error: string | null;
}

export const parseEnvironmentSecret = (value: unknown): PublicEnvironmentSecret => {
  const input = exactRecord(value, [
    "applied_generation",
    "applied_secret_count",
    "created_at",
    "delivery_state",
    "desired_generation",
    "key_version",
    "last_error",
    "name",
    "revision",
    "runtime_provider",
    "updated_at",
  ]);
  if (
    typeof input["name"] !== "string" ||
    !/^[A-Z][A-Z0-9_]{0,127}$/u.test(input["name"]) ||
    !Number.isSafeInteger(input["revision"]) ||
    Number(input["revision"]) < 1 ||
    !Number.isSafeInteger(input["key_version"]) ||
    Number(input["key_version"]) < 1 ||
    !isIsoInstant(input["created_at"]) ||
    !isIsoInstant(input["updated_at"]) ||
    !validDelivery(input)
  ) {
    throw new ResponseContractError();
  }
  return input as unknown as PublicEnvironmentSecret;
};

export const parseEnvironmentSecretPage = (
  value: unknown,
): Readonly<{ items: readonly PublicEnvironmentSecret[] } & RuntimeSecretDeliveryMetadata> => {
  const input = exactRecord(value, [
    "applied_generation",
    "applied_secret_count",
    "delivery_state",
    "desired_generation",
    "items",
    "last_error",
    "runtime_provider",
  ]);
  if (!Array.isArray(input["items"]) || !validDelivery(input)) throw new ResponseContractError();
  return Object.freeze({
    items: input["items"].map(parseEnvironmentSecret),
    desired_generation: Number(input["desired_generation"]),
    applied_generation: Number(input["applied_generation"]),
    delivery_state: input["delivery_state"] as RuntimeSecretDeliveryMetadata["delivery_state"],
    runtime_provider: input[
      "runtime_provider"
    ] as RuntimeSecretDeliveryMetadata["runtime_provider"],
    applied_secret_count: Number(input["applied_secret_count"]),
    last_error: input["last_error"] as string | null,
  });
};

export interface PublicFunctionRun {
  readonly id: string;
  readonly deployment_id: string;
  readonly cron: string;
  readonly scheduled_at: string;
  readonly state: "due" | "running" | "retry" | "succeeded" | "failed";
  readonly attempt: number;
  readonly status_code: number | null;
  readonly started_at: string | null;
  readonly finished_at: string | null;
}

const FUNCTION_RUN_ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const isUlidValue = (value: unknown): value is string =>
  typeof value === "string" && FUNCTION_RUN_ULID.test(value);

const parseFunctionRun = (value: unknown): PublicFunctionRun => {
  const input = exactRecord(value, [
    "attempt",
    "cron",
    "deployment_id",
    "finished_at",
    "id",
    "scheduled_at",
    "started_at",
    "state",
    "status_code",
  ]);
  const nullableInstant = (candidate: unknown) => candidate === null || isIsoInstant(candidate);
  if (
    !isUlidValue(input["id"]) ||
    !isUlidValue(input["deployment_id"]) ||
    typeof input["cron"] !== "string" ||
    input["cron"].length === 0 ||
    input["cron"].length > 64 ||
    !isIsoInstant(input["scheduled_at"]) ||
    !["due", "running", "retry", "succeeded", "failed"].includes(String(input["state"])) ||
    !Number.isSafeInteger(input["attempt"]) ||
    Number(input["attempt"]) < 0 ||
    Number(input["attempt"]) > 3 ||
    !(
      input["status_code"] === null ||
      (Number.isSafeInteger(input["status_code"]) &&
        Number(input["status_code"]) >= 100 &&
        Number(input["status_code"]) <= 599)
    ) ||
    !nullableInstant(input["started_at"]) ||
    !nullableInstant(input["finished_at"])
  ) {
    throw new ResponseContractError();
  }
  return input as unknown as PublicFunctionRun;
};

/** The newest scheduled runs of one environment; nothing but identity, timing and outcome. */
export const parseFunctionRunPage = (
  value: unknown,
): Readonly<{ items: readonly PublicFunctionRun[] }> => {
  const input = exactRecord(value, ["items"]);
  if (!Array.isArray(input["items"]) || input["items"].length > 100) {
    throw new ResponseContractError();
  }
  return Object.freeze({ items: Object.freeze(input["items"].map(parseFunctionRun)) });
};

export const parseEnvironmentSecretDeletion = (
  value: unknown,
): Readonly<{ name: string; status: "deleted" | "absent" } & RuntimeSecretDeliveryMetadata> => {
  const input = exactRecord(value, [
    "applied_generation",
    "applied_secret_count",
    "delivery_state",
    "desired_generation",
    "last_error",
    "name",
    "runtime_provider",
    "status",
  ]);
  if (
    typeof input["name"] !== "string" ||
    !/^[A-Z][A-Z0-9_]{0,127}$/u.test(input["name"]) ||
    (input["status"] !== "deleted" && input["status"] !== "absent") ||
    !validDelivery(input)
  ) {
    throw new ResponseContractError();
  }
  return input as unknown as {
    name: string;
    status: "deleted" | "absent";
  } & RuntimeSecretDeliveryMetadata;
};

interface RuntimeSecretDeliveryMetadata {
  readonly desired_generation: number;
  readonly applied_generation: number;
  readonly delivery_state: "not_deployed" | "pending" | "ready" | "failed";
  readonly runtime_provider: "wfp" | null;
  readonly applied_secret_count: number;
  readonly last_error: string | null;
}

function validDelivery(input: Readonly<Record<string, unknown>>): boolean {
  return (
    Number.isSafeInteger(input["desired_generation"]) &&
    Number(input["desired_generation"]) >= 0 &&
    Number.isSafeInteger(input["applied_generation"]) &&
    Number(input["applied_generation"]) >= 0 &&
    Number(input["applied_generation"]) <= Number(input["desired_generation"]) &&
    ["not_deployed", "pending", "ready", "failed"].includes(String(input["delivery_state"])) &&
    (input["runtime_provider"] === null || input["runtime_provider"] === "wfp") &&
    Number.isSafeInteger(input["applied_secret_count"]) &&
    Number(input["applied_secret_count"]) >= 0 &&
    Number(input["applied_secret_count"]) <= 100 &&
    (input["last_error"] === null ||
      (typeof input["last_error"] === "string" &&
        /^[A-Z][A-Z0-9_]{0,63}$/u.test(input["last_error"])))
  );
}

export const parseDeploymentPlan = (value: unknown): Readonly<Record<string, unknown>> => {
  const input = exactRecord(value, [
    "id",
    "project_id",
    "environment",
    "commit_sha",
    "source_digest",
    "build_plan_digest",
    "application_root",
    "artifact_digest",
    "runtime",
    "route",
    "resource_effects",
    "limits",
    "estimated_cost",
    "risks",
    "destructive_effects",
    "required_confirmations",
    "created_at",
    "expires_at",
  ]);
  const cost = exactRecord(input["estimated_cost"], [
    "amount_micros",
    "currency",
    "rate_card_version",
    "credit_micros",
    "credits",
    "provider_cost_micros",
    "scope",
    "reserved_seconds",
  ]);
  if (
    !isUlid(input["id"]) ||
    !isUlid(input["project_id"]) ||
    (input["environment"] !== "dev" && input["environment"] !== "prod") ||
    !isCommitSha(input["commit_sha"]) ||
    !isDigest(input["source_digest"]) ||
    !isDigest(input["build_plan_digest"]) ||
    !isApplicationRoot(input["application_root"]) ||
    (input["artifact_digest"] !== undefined && !isDigest(input["artifact_digest"])) ||
    (input["runtime"] !== "cloudflare_workers_static_assets" &&
      input["runtime"] !== "cloudflare_workers_edge_ssr") ||
    !isHttpsUrlValue(input["route"]) ||
    !stringArray(input["resource_effects"]) ||
    !stringArray(input["limits"]) ||
    !stringArray(input["risks"]) ||
    !stringArray(input["destructive_effects"]) ||
    !stringArray(input["required_confirmations"]) ||
    !isIsoInstant(input["created_at"]) ||
    !isIsoInstant(input["expires_at"]) ||
    !decimal(cost["amount_micros"]) ||
    !boundedString(cost["currency"], 1, 16) ||
    !boundedString(cost["rate_card_version"], 1, 128) ||
    !decimal(cost["credit_micros"]) ||
    typeof cost["credits"] !== "string" ||
    !/^[0-9]+(?:\.[0-9]{1,6})?$/u.test(cost["credits"]) ||
    !decimal(cost["provider_cost_micros"]) ||
    cost["scope"] !== "build_compute" ||
    !decimal(cost["reserved_seconds"]) ||
    cost["reserved_seconds"] === "0"
  )
    throw new ResponseContractError();
  return input;
};

const isApplicationRoot = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !/^(?:\.|[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*)$/u.test(value) ||
    new TextEncoder().encode(value).byteLength > 64
  ) {
    return false;
  }
  const segments = value === "." ? [] : value.split("/");
  return (
    segments.length <= 8 &&
    segments.every((segment) => new TextEncoder().encode(segment).byteLength <= 63)
  );
};

export const parseGuardedActionPlan = (value: unknown): Readonly<Record<string, unknown>> => {
  const input = exactRecord(value, [
    "action",
    "project_id",
    "target_deployment_id",
    "target_artifact_digest",
    "source_deployment_id",
    "source_artifact_digest",
    "source_environment",
    "target_environment",
    "resource_etag",
    "effects",
    "risks",
    "confirmation_token",
    "created_at",
    "expires_at",
  ]);
  const rollback = input["action"] === "rollback";
  const promote = input["action"] === "promote";
  if (
    (!rollback && !promote && input["action"] !== "delete") ||
    !isUlid(input["project_id"]) ||
    (rollback
      ? !isUlid(input["target_deployment_id"])
      : input["target_deployment_id"] !== undefined) ||
    (rollback
      ? !isDigest(input["target_artifact_digest"])
      : input["target_artifact_digest"] !== undefined) ||
    (promote
      ? !isUlid(input["source_deployment_id"]) ||
        !isDigest(input["source_artifact_digest"]) ||
        input["source_environment"] !== "dev" ||
        input["target_environment"] !== "prod"
      : input["source_deployment_id"] !== undefined ||
        input["source_artifact_digest"] !== undefined ||
        input["source_environment"] !== undefined ||
        input["target_environment"] !== undefined) ||
    !boundedString(input["resource_etag"], 1, 512) ||
    !stringArray(input["effects"]) ||
    !stringArray(input["risks"]) ||
    !boundedString(input["confirmation_token"], 1, 4096) ||
    !isIsoInstant(input["created_at"]) ||
    !isIsoInstant(input["expires_at"])
  )
    throw new ResponseContractError();
  return input;
};

export const parseOperationEvent = (value: unknown): Readonly<Record<string, unknown>> => {
  const input = exactRecord(value, [
    "event_id",
    "operation_id",
    "project_id",
    "type",
    "occurred_at",
    "failure",
  ]);
  const types = [
    "OperationQueued",
    "OperationStarted",
    "OperationSucceeded",
    "OperationFailed",
    "OperationCancelled",
  ];
  if (
    !isUlid(input["event_id"]) ||
    !isUlid(input["operation_id"]) ||
    !isUlid(input["project_id"]) ||
    typeof input["type"] !== "string" ||
    !types.includes(input["type"]) ||
    !isIsoInstant(input["occurred_at"])
  )
    throw new ResponseContractError();
  if (input["failure"] === undefined) return input;
  if (input["type"] !== "OperationFailed") throw new ResponseContractError();
  return { ...input, failure: parseOperationFailure(input["failure"]) };
};

export const parseSafeProblem = (value: unknown): SafeProblem => {
  const input = exactRecord(value, [
    "type",
    "title",
    "status",
    "detail",
    "instance",
    "code",
    "request_id",
    "retryable",
    "suggested_action",
    "retry_after_seconds",
  ]);
  const code = input["code"];
  if (typeof code !== "string" || !(code in PROBLEM_POLICY)) throw new ResponseContractError();
  const policy = PROBLEM_POLICY[code as ProblemCode];
  if (
    input["status"] !== policy.status ||
    !boundedString(input["type"], 1, 512) ||
    !isHttpsUrl(input["type"]) ||
    !boundedString(input["title"], 1, 160) ||
    !boundedString(input["request_id"], 1, 128) ||
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(input["request_id"]) ||
    typeof input["retryable"] !== "boolean" ||
    !boundedString(input["suggested_action"], 1, 500) ||
    (input["detail"] !== undefined && !boundedString(input["detail"], 1, 2_000)) ||
    (input["instance"] !== undefined && !boundedString(input["instance"], 1, 512))
  ) {
    throw new ResponseContractError();
  }
  const retryAfter = input["retry_after_seconds"];
  if (
    retryAfter !== undefined &&
    (code !== "rate_limited" ||
      typeof retryAfter !== "number" ||
      !Number.isSafeInteger(retryAfter) ||
      retryAfter < 1 ||
      retryAfter > 86400)
  )
    throw new ResponseContractError();
  const docsUrl = String(input["type"]);
  return {
    requestId: input["request_id"],
    ...(docsUrl.startsWith("https://docs.ohmyho.st/errors/") ? { docsUrl } : {}),
    code: code as ProblemCode,
    retryable: policy.retryable,
    suggestedAction:
      (code === "framework_conversion_required"
        ? (parseFrameworkConversionDetail(input["detail"]) ?? policy.action)
        : code === "invalid_request"
          ? (parseFeedbackSubmissionDetail(input["detail"]) ?? policy.action)
          : policy.action) +
      (retryAfter === undefined ? "" : ` Retry after ${String(retryAfter)} seconds.`),
    ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter as number }),
  };
};

export const parseOperation = (value: unknown): PublicOperation => {
  const input = exactRecord(value, [
    "blocking_operation_id",
    "deployment_id",
    "id",
    "state",
    "created_at",
    "updated_at",
    "result",
    "error",
    "reconciliation",
    "progress",
  ]);
  const id = input["id"];
  const state = input["state"];
  const createdAt = input["created_at"];
  const updatedAt = input["updated_at"];
  const result = input["result"];
  const blockingOperationId = input["blocking_operation_id"];
  const deploymentId = input["deployment_id"];
  if (
    (blockingOperationId !== undefined &&
      (state !== "queued" || !isUlid(blockingOperationId) || blockingOperationId === id)) ||
    (deploymentId !== undefined && !isUlid(deploymentId))
  )
    throw new ResponseContractError();
  if (
    !isUlid(id) ||
    !isOperationState(state) ||
    !isIsoInstant(createdAt) ||
    !isIsoInstant(updatedAt) ||
    (result !== undefined && !isRecord(result))
  ) {
    throw new ResponseContractError();
  }
  let progress: OperationDeploymentProgress | undefined;
  if (input["progress"] !== undefined) {
    if (state !== "queued" && state !== "running") throw new ResponseContractError();
    try {
      progress = parseOperationDeploymentProgress(input["progress"]);
    } catch {
      throw new ResponseContractError();
    }
  }
  let error: PublicOperationFailure | undefined;
  if (input["error"] !== undefined) {
    if (state !== "failed") throw new ResponseContractError();
    error = parseOperationFailure(input["error"]);
  } else if (state === "failed") {
    throw new ResponseContractError();
  }
  let reconciliation: PublicOperationReconciliation | undefined;
  if (input["reconciliation"] !== undefined) {
    const observed = exactRecord(input["reconciliation"], [
      "state",
      "attempt_id",
      "observed_at",
      "suggested_action",
    ]);
    if (
      (state !== "queued" && state !== "running") ||
      (observed["state"] !== "required" && observed["state"] !== "pending") ||
      !isIsoInstant(observed["observed_at"]) ||
      !boundedString(observed["suggested_action"], 1, 500) ||
      (observed["state"] === "required"
        ? observed["attempt_id"] !== null
        : !isUlid(observed["attempt_id"]))
    )
      throw new ResponseContractError();
    reconciliation = publicOperationReconciliation({
      state: observed["state"],
      attempt_id: observed["attempt_id"] as string | null,
      observed_at: observed["observed_at"] as string,
    });
    if (reconciliation.suggested_action !== observed["suggested_action"])
      throw new ResponseContractError();
  }
  return {
    id,
    state,
    created_at: createdAt,
    updated_at: updatedAt,
    ...(blockingOperationId === undefined
      ? {}
      : { blocking_operation_id: blockingOperationId as string }),
    ...(deploymentId === undefined ? {} : { deployment_id: deploymentId as string }),
    ...(progress === undefined ? {} : { progress }),
    ...(result === undefined ? {} : { result }),
    ...(error === undefined ? {} : { error }),
    ...(reconciliation === undefined ? {} : { reconciliation }),
  };
};

function parseOperationFailure(value: unknown): PublicOperationFailure {
  const input = exactRecord(value, ["code", "message", "retryable", "suggested_action"]);
  if (
    typeof input["code"] !== "string" ||
    !boundedString(input["message"], 1, 512) ||
    input["retryable"] !== false ||
    !boundedString(input["suggested_action"], 1, 500)
  )
    throw new ResponseContractError();
  const safe = publicOperationFailure(input["code"]);
  if (safe.code !== input["code"]) throw new ResponseContractError();
  return safe;
}

const exactRecord = (value: unknown, allowed: readonly string[]): Record<string, unknown> => {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ResponseContractError();
  }
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const boundedString = (value: unknown, minimum: number, maximum: number): value is string =>
  typeof value === "string" && value.length >= minimum && value.length <= maximum;

const isUlid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9A-HJKMNP-TV-Z]{26}$/u.test(value);

const isIsoInstant = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));

const isOperationState = (value: unknown): value is PublicOperation["state"] =>
  value === "queued" ||
  value === "running" ||
  value === "succeeded" ||
  value === "failed" ||
  value === "cancelled";

const isHttpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
};

const isCommitSha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
const isDigest = (value: unknown): value is string =>
  typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const decimal = (value: unknown): value is string =>
  typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 100 &&
  value.every((item) => boundedString(item, 1, 1_000));
const shortStringArray = (value: unknown, maximumItems: number, maximumLength: number) =>
  Array.isArray(value) &&
  value.length >= 1 &&
  value.length <= maximumItems &&
  value.every((item) => boundedString(item, 1, maximumLength));
const isPaidHostname = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(value) &&
  !value.endsWith(".poc.aixyte.com");
const isPaidValidationRecord = (value: unknown) => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "content,name,purpose,type"
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record["type"] === "CNAME" || record["type"] === "TXT") &&
    boundedString(record["name"], 1, 253) &&
    boundedString(record["content"], 1, 2_048) &&
    ["traffic", "ownership", "ssl", "dcv_delegation"].includes(String(record["purpose"]))
  );
};
const isHttpsUrlValue = (value: unknown): value is string =>
  typeof value === "string" && isHttpsUrl(value);
