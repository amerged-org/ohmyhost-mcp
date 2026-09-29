import { publicOperationFailure, type PublicOperationFailure } from "./operation-failure.js";
export interface ProjectExport {
  readonly id: string;
  readonly project_id: string;
  readonly state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  readonly requested_at: string;
  readonly next_request_at: string;
  readonly next_poll_after_seconds: 5 | null;
  readonly error: PublicOperationFailure | null;
  readonly archive: {
    readonly bytes: number;
    readonly sha256: string;
    readonly sql_files: readonly string[];
    readonly captured_at: string;
    readonly expires_at: string;
    readonly download_url: string | null;
    readonly download_expires_at: string | null;
  } | null;
}
/** The public export shape carries no job password, source URL or permanent storage credential. */
export function assertProjectExport(value: unknown): asserts value is ProjectExport {
  if (
    !record(value) ||
    Object.keys(value).sort().join(",") !==
      "archive,error,id,next_poll_after_seconds,next_request_at,project_id,requested_at,state" ||
    typeof value["id"] !== "string" ||
    !id.test(value["id"]) ||
    typeof value["project_id"] !== "string" ||
    !id.test(value["project_id"]) ||
    !["queued", "running", "succeeded", "failed", "cancelled"].includes(String(value["state"])) ||
    !timestamp(value["requested_at"]) ||
    !timestamp(value["next_request_at"])
  )
    invalid();
  const active = value["state"] === "queued" || value["state"] === "running";
  if (value["next_poll_after_seconds"] !== (active ? 5 : null)) invalid();
  if (value["state"] === "failed") {
    const error = value["error"];
    if (
      !record(error) ||
      Object.keys(error).sort().join(",") !== "code,message,retryable,suggested_action" ||
      typeof error["code"] !== "string"
    )
      invalid();
    const expected = publicOperationFailure(error["code"]);
    for (const key of Object.keys(expected) as (keyof PublicOperationFailure)[])
      if (error[key] !== expected[key]) invalid();
  } else if (value["error"] !== null) invalid();
  const archive = value["archive"];
  if (archive === null) {
    if (value["state"] === "succeeded") invalid();
    return;
  }
  if (
    value["state"] !== "succeeded" ||
    !record(archive) ||
    Object.keys(archive).sort().join(",") !==
      "bytes,captured_at,download_expires_at,download_url,expires_at,sha256,sql_files" ||
    !Number.isSafeInteger(archive["bytes"]) ||
    Number(archive["bytes"]) < 1 ||
    Number(archive["bytes"]) > 536870912 ||
    typeof archive["sha256"] !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(archive["sha256"]) ||
    !['["dev.sql"]', '["prod.sql"]', '["dev.sql","prod.sql"]', '["shared.sql"]'].includes(
      JSON.stringify(archive["sql_files"]),
    ) ||
    !timestamp(archive["captured_at"]) ||
    !timestamp(archive["expires_at"])
  )
    invalid();
  if (archive["download_url"] === null) {
    if (archive["download_expires_at"] !== null) invalid();
    return;
  }
  if (
    typeof archive["download_url"] !== "string" ||
    !timestamp(archive["download_expires_at"]) ||
    Date.parse(archive["download_expires_at"]) > Date.parse(archive["expires_at"])
  )
    invalid();
  let url;
  try {
    url = new URL(archive["download_url"]);
  } catch {
    invalid();
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) invalid();
}
const id = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function invalid(): never {
  throw new TypeError("Project export response is invalid");
}
