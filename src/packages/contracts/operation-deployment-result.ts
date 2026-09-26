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
    "Read 'ohmyhost mail domain status --project PROJECT --json' now and follow its verification issue and DNS records. Keep this operation; do not rebuild or repeat correct DNS changes.",
  mail_status_unavailable:
    "Mail readiness could not be observed. Read 'ohmyhost mail domain status --project PROJECT --json' and report a persistent error; keep this operation.",
} as const;
export type DeploymentProgressPhase = keyof typeof deploymentProgressActions;
export interface OperationDeploymentProgress {
  readonly build_completed_at?: string;
  readonly phase: DeploymentProgressPhase;
  readonly project_id: string;
  readonly deployment_id: string;
  readonly observed_at: string;
  readonly next_poll_after_seconds: 60;
  readonly suggested_action: string;
}
export function createOperationDeploymentProgress(input: {
  build_completed_at?: string;
  phase: DeploymentProgressPhase;
  project_id: string;
  deployment_id: string;
  observed_at: string;
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
  return Object.freeze({
    ...(input.build_completed_at === undefined
      ? {}
      : { build_completed_at: input.build_completed_at }),
    phase: input.phase,
    project_id: project,
    deployment_id: input.deployment_id,
    observed_at: input.observed_at,
    next_poll_after_seconds: 60 as const,
    suggested_action: deploymentProgressActions[input.phase].replace("PROJECT", project),
  });
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
  const row = exactRecord(value, keys);
  const parsed = createOperationDeploymentProgress({
    ...(row["build_completed_at"] === undefined
      ? {}
      : { build_completed_at: row["build_completed_at"] as string }),
    phase: row["phase"] as DeploymentProgressPhase,
    project_id: row["project_id"] as string,
    deployment_id: row["deployment_id"] as string,
    observed_at: row["observed_at"] as string,
  });
  if (row["next_poll_after_seconds"] !== 60 || row["suggested_action"] !== parsed.suggested_action)
    invalid();
  return parsed;
}
