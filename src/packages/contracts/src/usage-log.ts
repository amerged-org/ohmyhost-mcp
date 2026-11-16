import { PROBLEM_POLICY } from "./problem-policy.js";

/** Minimized, immutable telemetry. Never include request or response payloads. */
export interface UsageLogRecord {
  schema_version: 1;
  record_id: string;
  invocation_id: string;
  parent_invocation_id: string | null;
  phase: "started" | "finished";
  occurred_at: string;
  started_at: string;
  platform_environment: "development" | "production";
  transport: "remote_mcp" | "rest";
  operation: string;
  account_id: string | null;
  organization_id: string | null;
  project_id: string | null;
  operation_id: string | null;
  operation_status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | null;
  outcome: "started" | "succeeded" | "accepted" | "failed" | "cancelled";
  duration_ms: number | null;
  http_status: number | null;
  error_code: string | null;
  platform_version: string | null;
}
const keys = [
  "schema_version",
  "record_id",
  "invocation_id",
  "parent_invocation_id",
  "phase",
  "occurred_at",
  "started_at",
  "platform_environment",
  "transport",
  "operation",
  "account_id",
  "organization_id",
  "project_id",
  "operation_id",
  "operation_status",
  "outcome",
  "duration_ms",
  "http_status",
  "error_code",
  "platform_version",
] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const id = (value: unknown, pattern: RegExp) =>
  value === null || (typeof value === "string" && pattern.test(value));
const iso = (value: unknown) =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const fallbackErrors = new Set(["unknown", "transport_error", "internal_error", "cancelled"]);
export function safeUsageErrorCode(value: unknown): string {
  return typeof value === "string" &&
    (Object.hasOwn(PROBLEM_POLICY, value) || fallbackErrors.has(value))
    ? value
    : "unknown";
}
export function parseUsageLogRecord(input: unknown): UsageLogRecord {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("usage_record_invalid");
  const v = input as Record<string, unknown>;
  if (
    Object.keys(v).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(v, key)) ||
    v["schema_version"] !== 1 ||
    typeof v["record_id"] !== "string" ||
    !uuid.test(v["record_id"]) ||
    typeof v["invocation_id"] !== "string" ||
    !uuid.test(v["invocation_id"]) ||
    !id(v["parent_invocation_id"], uuid) ||
    !["started", "finished"].includes(v["phase"] as string) ||
    !iso(v["occurred_at"]) ||
    !iso(v["started_at"]) ||
    !["development", "production"].includes(v["platform_environment"] as string) ||
    !["remote_mcp", "rest"].includes(v["transport"] as string) ||
    typeof v["operation"] !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_]{0,127}$/u.test(v["operation"]) ||
    !id(v["account_id"], /^user_[A-Za-z0-9_]{1,123}$/u) ||
    !id(v["organization_id"], ulid) ||
    !id(v["project_id"], ulid) ||
    !id(v["operation_id"], ulid) ||
    !(
      v["operation_status"] === null ||
      ["queued", "running", "succeeded", "failed", "cancelled"].includes(
        v["operation_status"] as string,
      )
    ) ||
    !(
      v["duration_ms"] === null ||
      (Number.isSafeInteger(v["duration_ms"]) &&
        (v["duration_ms"] as number) >= 0 &&
        (v["duration_ms"] as number) <= 604800000)
    ) ||
    !(
      v["http_status"] === null ||
      (Number.isInteger(v["http_status"]) &&
        (v["http_status"] as number) >= 100 &&
        (v["http_status"] as number) <= 599)
    ) ||
    !(
      v["error_code"] === null ||
      (typeof v["error_code"] === "string" &&
        safeUsageErrorCode(v["error_code"]) === v["error_code"])
    ) ||
    !(
      v["platform_version"] === null ||
      (typeof v["platform_version"] === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/u.test(v["platform_version"]))
    ) ||
    (v["phase"] === "started"
      ? v["outcome"] !== "started" ||
        v["operation_status"] !== null ||
        v["duration_ms"] !== null ||
        v["http_status"] !== null ||
        v["error_code"] !== null
      : !["succeeded", "accepted", "failed", "cancelled"].includes(v["outcome"] as string) ||
        v["duration_ms"] === null ||
        (v["outcome"] !== "failed" && v["outcome"] !== "cancelled" && v["error_code"] !== null))
  )
    throw new TypeError("usage_record_invalid");
  return Object.fromEntries(keys.map((key) => [key, v[key]])) as unknown as UsageLogRecord;
}
