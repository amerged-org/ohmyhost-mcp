export const OPERATION_DEPLOYMENT_RESULT_SCHEMA_VERSION =
  "ohmyhost.operation-deployment-result/v2" as const;

export interface OperationDeploymentResult {
  readonly schemaVersion: typeof OPERATION_DEPLOYMENT_RESULT_SCHEMA_VERSION;
  readonly operationId: string;
  readonly deploymentId: string;
  readonly planId: string;
  readonly artifactSha256: string;
  readonly url: string;
}

export function createOperationDeploymentResult(
  input: Omit<OperationDeploymentResult, "schemaVersion">,
): OperationDeploymentResult {
  return parseOperationDeploymentResult({
    schemaVersion: OPERATION_DEPLOYMENT_RESULT_SCHEMA_VERSION,
    ...input,
  });
}

export function parseOperationDeploymentResult(value: unknown): OperationDeploymentResult {
  const result = exactRecord(value, [
    "schemaVersion",
    "operationId",
    "deploymentId",
    "planId",
    "artifactSha256",
    "url",
  ]);
  if (result["schemaVersion"] !== OPERATION_DEPLOYMENT_RESULT_SCHEMA_VERSION) invalid();
  return Object.freeze({
    schemaVersion: OPERATION_DEPLOYMENT_RESULT_SCHEMA_VERSION,
    operationId: ulid(result["operationId"]),
    deploymentId: ulid(result["deploymentId"]),
    planId: ulid(result["planId"]),
    artifactSha256: digest(result["artifactSha256"]),
    url: httpsUrl(result["url"]),
  });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid();
  }
  return value as Record<string, unknown>;
}

function ulid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/u.test(value)) invalid();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) invalid();
  return value;
}

function httpsUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) invalid();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalid();
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.hostname === ""
  ) {
    invalid();
  }
  return value;
}

function invalid(): never {
  throw new TypeError("Operation deployment result is invalid");
}

const deploymentProgressActions = {
  queued: "The deployment is queued. Poll this same operation; do not submit another deployment.",
  building:
    "The build has not yet completed. Poll this same operation and read deployment logs if it fails.",
  publishing:
    "The build has completed. Runtime preparation or publication is still running; poll this same operation.",
  waiting_for_mail:
    "Read 'ohmyhost mail status --project PROJECT --environment PROD_ENVIRONMENT_ULID --json' (MCP mail_status) now, with the Prod environment ID from 'ohmyhost project status', and follow its verification issue and DNS records. Keep this operation; do not rebuild or repeat correct DNS changes.",
  mail_status_unavailable:
    "Mail readiness could not be observed. Read 'ohmyhost mail status --project PROJECT --environment PROD_ENVIRONMENT_ULID --json' (MCP mail_status) with the Prod environment ID from 'ohmyhost project status', and report a persistent error; keep this operation.",
} as const;
export type DeploymentProgressPhase = keyof typeof deploymentProgressActions;
export interface DeploymentMailProgress {
  readonly domain: string;
  readonly status:
    | "configured"
    | "delegation_required"
    | "ready"
    | "verification_pending"
    | "verification_failed";
  readonly configured_at: string;
  readonly observed_at?: string;
  readonly verification_issue?:
    | "identity_missing"
    | "identity_verification_failed"
    | "dkim_verification_failed"
    | "dkim_records_changed"
    | "tenant_association_missing"
    | null;
  readonly next_check_after_seconds?: 60 | 3600 | null;
  readonly sending?: "disabled" | "pending" | "ready" | "failed";
  readonly receiving?: "disabled" | "pending" | "ready" | "failed";
  readonly dns_records: {
    readonly type: "MX" | "TXT" | "CNAME";
    readonly name: string;
    readonly value: string;
    readonly status: string;
    readonly priority?: number;
  }[];
}
export interface OperationDeploymentProgress {
  readonly build_completed_at?: string;
  readonly phase: DeploymentProgressPhase;
  readonly project_id: string;
  readonly deployment_id: string;
  readonly observed_at: string;
  readonly next_poll_after_seconds: 60;
  readonly suggested_action: string;
  readonly mail?: DeploymentMailProgress;
}
export function createOperationDeploymentProgress(input: {
  build_completed_at?: string;
  phase: DeploymentProgressPhase;
  project_id: string;
  deployment_id: string;
  observed_at: string;
  mail?: DeploymentMailProgress;
}): OperationDeploymentProgress {
  const project = ulid(input.project_id);
  ulid(input.deployment_id);
  if (
    !Object.hasOwn(deploymentProgressActions, input.phase) ||
    !Number.isFinite(Date.parse(input.observed_at)) ||
    new Date(input.observed_at).toISOString() !== input.observed_at
  )
    invalid();
  if (
    input.build_completed_at !== undefined &&
    (!Number.isFinite(Date.parse(input.build_completed_at)) ||
      new Date(input.build_completed_at).toISOString() !== input.build_completed_at)
  )
    invalid();
  const mail = input.mail === undefined ? undefined : parseDeploymentMailProgress(input.mail);
  if (mail !== undefined && input.phase !== "waiting_for_mail") invalid();
  return Object.freeze({
    ...(input.build_completed_at === undefined
      ? {}
      : { build_completed_at: input.build_completed_at }),
    phase: input.phase,
    project_id: project,
    deployment_id: input.deployment_id,
    observed_at: input.observed_at,
    next_poll_after_seconds: 60 as const,
    suggested_action:
      mail === undefined || mail.dns_records.length === 0
        ? deploymentProgressActions[input.phase].replace("PROJECT", project)
        : "Follow the mail readiness and DNS records shown here, then poll this same operation. Do not rebuild or repeat correct DNS changes.",
    ...(mail === undefined ? {} : { mail }),
  });
}
function parseDeploymentMailProgress(value: unknown): DeploymentMailProgress {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const raw = value as Record<string, unknown>;
  const keys = ["domain", "status", "configured_at", "dns_records"];
  for (const optional of [
    "observed_at",
    "verification_issue",
    "next_check_after_seconds",
    "sending",
    "receiving",
  ])
    if (raw[optional] !== undefined) keys.push(optional);
  const row = exactRecord(raw, keys),
    time = (v: unknown) =>
      typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v,
    state = ["disabled", "pending", "ready", "failed"];
  if (
    typeof row["domain"] !== "string" ||
    row["domain"].length > 253 ||
    !/^[a-z0-9.-]+$/u.test(row["domain"]) ||
    ![
      "configured",
      "delegation_required",
      "ready",
      "verification_pending",
      "verification_failed",
    ].includes(String(row["status"])) ||
    !time(row["configured_at"]) ||
    (row["observed_at"] !== undefined && !time(row["observed_at"])) ||
    (row["verification_issue"] !== undefined &&
      row["verification_issue"] !== null &&
      ![
        "identity_missing",
        "identity_verification_failed",
        "dkim_verification_failed",
        "dkim_records_changed",
        "tenant_association_missing",
      ].includes(String(row["verification_issue"]))) ||
    (row["next_check_after_seconds"] !== undefined &&
      ![60, 3600, null].includes(row["next_check_after_seconds"] as 60 | 3600 | null)) ||
    (row["sending"] !== undefined && !state.includes(String(row["sending"]))) ||
    (row["receiving"] !== undefined && !state.includes(String(row["receiving"]))) ||
    !Array.isArray(row["dns_records"]) ||
    row["dns_records"].length > 16
  )
    invalid();
  const records = row["dns_records"].map((value: unknown) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
    const item = value as Record<string, unknown>;
    const record = exactRecord(
      item,
      item["priority"] === undefined
        ? ["type", "name", "value", "status"]
        : ["type", "name", "value", "status", "priority"],
    );
    if (
      !["MX", "TXT", "CNAME"].includes(String(record["type"])) ||
      typeof record["name"] !== "string" ||
      record["name"].length === 0 ||
      record["name"].length > 253 ||
      /[\r\n\0]/u.test(record["name"]) ||
      !(record["name"] === row["domain"] || record["name"].endsWith(`.${row["domain"]}`)) ||
      typeof record["value"] !== "string" ||
      record["value"].length === 0 ||
      record["value"].length > 4096 ||
      /[\r\n\0]/u.test(record["value"]) ||
      typeof record["status"] !== "string" ||
      record["status"].length === 0 ||
      record["status"].length > 32 ||
      /[\r\n\0]/u.test(record["status"]) ||
      (record["type"] === "MX" &&
        (!Number.isSafeInteger(record["priority"]) ||
          Number(record["priority"]) < 0 ||
          Number(record["priority"]) > 65535)) ||
      (record["type"] !== "MX" && record["priority"] !== undefined)
    )
      invalid();
    return Object.freeze({ ...record }) as DeploymentMailProgress["dns_records"][number];
  });
  return Object.freeze({ ...row, dns_records: records }) as unknown as DeploymentMailProgress;
}
export function parseOperationDeploymentProgress(value: unknown): OperationDeploymentProgress {
  const keys = [
    "phase",
    "project_id",
    "deployment_id",
    "observed_at",
    "next_poll_after_seconds",
    "suggested_action",
  ];
  if (typeof value === "object" && value !== null && Object.hasOwn(value, "build_completed_at"))
    keys.push("build_completed_at");
  if (typeof value === "object" && value !== null && Object.hasOwn(value, "mail"))
    keys.push("mail");
  const row = exactRecord(value, keys);
  const parsed = createOperationDeploymentProgress({
    ...(row["build_completed_at"] === undefined
      ? {}
      : { build_completed_at: row["build_completed_at"] as string }),
    phase: row["phase"] as DeploymentProgressPhase,
    project_id: row["project_id"] as string,
    deployment_id: row["deployment_id"] as string,
    observed_at: row["observed_at"] as string,
    ...(row["mail"] === undefined ? {} : { mail: parseDeploymentMailProgress(row["mail"]) }),
  });
  if (row["next_poll_after_seconds"] !== 60 || row["suggested_action"] !== parsed.suggested_action)
    invalid();
  return parsed;
}
