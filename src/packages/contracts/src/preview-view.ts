import {
  PREVIEW_FAILURE_CODES,
  PREVIEW_RETRY_AFTER_SECONDS,
  previewFailureNeedsNewSource,
  previewFailureNextStep,
  previewFailureRetryable,
  type PreviewFailureCode,
  type PreviewFailureDetail,
  type PreviewFailureRecord,
} from "./previews.js";

/** Why the last start attempt failed, in the words an assistant acts on. */
export interface PreviewFailureView {
  readonly code: PreviewFailureCode;
  readonly retryable: boolean;
  readonly next_step: string;
  readonly detail?: PreviewFailureDetail;
}

/** The customer-visible failure; a failure of an older saved version no longer applies. */
export function previewFailureView(
  failure: PreviewFailureRecord | null,
  targetSequence: number | null,
): PreviewFailureView | null {
  if (
    failure === null ||
    (failure.sourceSequence !== null && failure.sourceSequence !== targetSequence)
  )
    return null;
  return {
    code: failure.code,
    retryable: previewFailureRetryable(failure.code),
    next_step: previewFailureNextStep(failure),
    ...(failure.detail === null ? {} : { detail: failure.detail }),
  };
}

/**
 * Another attempt waits out a short cool-down after any failure that a retry can change.
 * A failure that only a new save can change never retries, so it has no wait.
 */
export function previewRetryAfterSeconds(
  failure: PreviewFailureRecord | null,
  view: PreviewFailureView | null,
  now: number,
): number | null {
  if (failure === null || view === null || previewFailureNeedsNewSource(failure.code)) return null;
  const remaining = Math.ceil(
    (Date.parse(failure.failedAt) + PREVIEW_RETRY_AFTER_SECONDS * 1000 - now) / 1000,
  );
  return remaining > 0 ? Math.min(remaining, PREVIEW_RETRY_AFTER_SECONDS) : null;
}

/** What the app's database holds, in the words an assistant asks the user. It informs; it never delays showing the preview. */
export interface PreviewDataView {
  readonly state: "not_required" | "needs_database" | "migrations_pending" | "ready";
  readonly environment: "dev" | "prod";
  /** Prod when this Dev database is also Prod's; null otherwise. */
  readonly shares_data_with: "prod" | null;
  /** The environments sets the user can choose to apply the migration files in, in call order. */
  readonly options: ("dev" | "prod")[][];
  /** Saved migration files the environment's database does not hold yet; at most 20. */
  readonly pending_files: string[];
}

const DATA_STATES = ["not_required", "needs_database", "migrations_pending", "ready"] as const;
const PENDING_FILES_SHOWN = 20;

/**
 * The database facts of one environment, from what the applied source declares and what the database holds.
 * Null until a source has been applied, and for a source whose database was never recorded (an older runtime). Files
 * count as applied only when a finished migration job applied exactly the declared names and contents; every other
 * way of holding the same names (a deployment, an older receipt) is `migrations_pending` until the job runs once
 * more. Free and a project without Dev apply to Prod; a Paid project with Dev chooses Dev only, or Dev and then Prod.
 */
export function previewDataView(input: {
  readonly environment: "dev" | "prod";
  readonly appliedDatabase: {
    readonly enabled: boolean;
    readonly migrations: readonly string[];
    readonly filesSha256?: string;
  } | null;
  readonly dataMode: "shared" | "isolated";
  readonly registered: boolean;
  readonly appliedPaths: readonly string[];
  readonly filesApplied: boolean;
  readonly developmentAvailable: boolean;
}): PreviewDataView | null {
  if (input.appliedDatabase === null) return null;
  const held = new Set(input.appliedPaths);
  const pending = input.registered
    ? input.appliedDatabase.migrations.filter((path) => !held.has(path))
    : [...input.appliedDatabase.migrations];
  const verified =
    input.appliedDatabase.migrations.length === 0 ||
    (input.appliedDatabase.filesSha256 !== undefined && input.filesApplied);
  const state: PreviewDataView["state"] = !input.appliedDatabase.enabled
    ? "not_required"
    : !input.registered
      ? "needs_database"
      : pending.length > 0 || !verified
        ? "migrations_pending"
        : "ready";
  return {
    state,
    environment: input.environment,
    shares_data_with: input.environment === "dev" && input.dataMode === "shared" ? "prod" : null,
    options: input.developmentAvailable ? [["dev"], ["dev", "prod"]] : [["prod"]],
    pending_files:
      state === "needs_database" || state === "migrations_pending"
        ? pending.slice(0, PENDING_FILES_SHOWN)
        : [],
  };
}

/** Public preview response, validated before a CLI or agent presents its private URL. */
export interface PreviewView {
  readonly id: string;
  readonly project_id: string;
  readonly environment: "dev" | "prod";
  readonly status: "cold" | "starting" | "ready" | "sleeping";
  readonly url: string;
  readonly source: Readonly<{ sequence: number; commit_sha: string }> | null;
  readonly applied_source: PreviewView["source"];
  readonly ready_to_show: boolean;
  /** Immutable deadline: the link stops working here and the next preview_open makes a new one. */
  readonly expires_at: string;
  readonly failure: PreviewFailureView | null;
  readonly retry_after_seconds: number | null;
  /** Null until a source has been applied; then what the app's database needs. */
  readonly data: PreviewDataView | null;
}

export function parsePreviewView(
  value: unknown,
  scope?: { projectId: string; environment: "dev" | "prod" },
): PreviewView {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid preview response");
  const row = value as Record<string, unknown>;
  const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
  if (
    Object.keys(row).sort().join(",") !==
      "applied_source,data,environment,expires_at,failure,id,project_id,ready_to_show,retry_after_seconds,source,status,url" ||
    typeof row["id"] !== "string" ||
    !ulid.test(row["id"]) ||
    typeof row["project_id"] !== "string" ||
    !ulid.test(row["project_id"]) ||
    (row["environment"] !== "dev" && row["environment"] !== "prod") ||
    !["cold", "starting", "ready", "sleeping"].includes(String(row["status"])) ||
    typeof row["ready_to_show"] !== "boolean" ||
    typeof row["expires_at"] !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u.test(row["expires_at"]) ||
    (row["retry_after_seconds"] !== null &&
      (typeof row["retry_after_seconds"] !== "number" ||
        !Number.isSafeInteger(row["retry_after_seconds"]) ||
        row["retry_after_seconds"] < 1 ||
        row["retry_after_seconds"] > PREVIEW_RETRY_AFTER_SECONDS)) ||
    typeof row["url"] !== "string" ||
    !/^https:\/\/[a-z2-7]{51}[aq]\.preview(?:\.dev)?\.omh\.st$/u.test(row["url"]) ||
    (scope !== undefined &&
      (row["project_id"] !== scope.projectId || row["environment"] !== scope.environment))
  )
    throw new TypeError("Invalid preview response");
  for (const source of [row["source"], row["applied_source"]]) {
    if (source === null) continue;
    if (!source || typeof source !== "object" || Array.isArray(source))
      throw new TypeError("Invalid preview response");
    const item = source as Record<string, unknown>;
    if (
      Object.keys(item).sort().join(",") !== "commit_sha,sequence" ||
      typeof item["sequence"] !== "number" ||
      !Number.isSafeInteger(item["sequence"]) ||
      item["sequence"] <= 0 ||
      typeof item["commit_sha"] !== "string" ||
      !/^(?!0{40}$)[0-9a-f]{40}$/u.test(item["commit_sha"])
    )
      throw new TypeError("Invalid preview response");
  }
  parsePreviewFailure(row["failure"]);
  parsePreviewData(row["data"]);
  return value as PreviewView;
}

function parsePreviewData(value: unknown): void {
  if (value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid preview response");
  const item = value as Record<string, unknown>;
  const environments = (entry: unknown) => entry === "dev" || entry === "prod";
  if (
    Object.keys(item).sort().join(",") !==
      "environment,options,pending_files,shares_data_with,state" ||
    !DATA_STATES.includes(item["state"] as (typeof DATA_STATES)[number]) ||
    !environments(item["environment"]) ||
    (item["shares_data_with"] !== null && item["shares_data_with"] !== "prod") ||
    !Array.isArray(item["options"]) ||
    item["options"].length < 1 ||
    item["options"].length > 2 ||
    !item["options"].every(
      (option) =>
        Array.isArray(option) &&
        option.length >= 1 &&
        option.length <= 2 &&
        option.every(environments),
    ) ||
    !Array.isArray(item["pending_files"]) ||
    item["pending_files"].length > PENDING_FILES_SHOWN ||
    !item["pending_files"].every(
      (path) => typeof path === "string" && path.length > 0 && path.length <= 512,
    )
  )
    throw new TypeError("Invalid preview response");
}

function parsePreviewFailure(value: unknown): void {
  if (value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid preview response");
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item).sort().join(",");
  if (
    (keys !== "code,next_step,retryable" && keys !== "code,detail,next_step,retryable") ||
    !PREVIEW_FAILURE_CODES.includes(item["code"] as PreviewFailureCode) ||
    typeof item["retryable"] !== "boolean" ||
    typeof item["next_step"] !== "string" ||
    item["next_step"].length < 1 ||
    item["next_step"].length > 1_200
  )
    throw new TypeError("Invalid preview response");
  if (item["detail"] === undefined) return;
  const detail = item["detail"];
  if (!detail || typeof detail !== "object" || Array.isArray(detail))
    throw new TypeError("Invalid preview response");
  const facts = detail as Record<string, unknown>;
  const text = (field: unknown) =>
    typeof field === "string" && field.length > 0 && field.length <= 200;
  if (
    !Object.keys(facts).every((key) => key === "paths" || key === "rule" || key === "path") ||
    (facts["paths"] !== undefined &&
      (!Array.isArray(facts["paths"]) ||
        facts["paths"].length > 5 ||
        !facts["paths"].every(text))) ||
    (facts["rule"] !== undefined && !text(facts["rule"])) ||
    (facts["path"] !== undefined && !text(facts["path"]))
  )
    throw new TypeError("Invalid preview response");
}
