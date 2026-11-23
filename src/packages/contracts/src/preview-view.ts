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
      "applied_source,environment,expires_at,failure,id,project_id,ready_to_show,retry_after_seconds,source,status,url" ||
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
  return value as PreviewView;
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
