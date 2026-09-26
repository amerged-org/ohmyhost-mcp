import type { ManagedMailCommand } from "./managed-mail.js";
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
/** Exact response validation is shared by CLI and MCP; malformed data never becomes agent guidance. */
export function assertManagedMailResponse(value: unknown, input: ManagedMailCommand): void {
  const r = object(value);
  if (
    input.action === "configure" ||
    input.action === "status" ||
    input.action === "webhook_verify"
  ) {
    exact(
      r,
      [
        "domain_id",
        "domain",
        "environment_id",
        "sending",
        "receiving",
        "status",
        "configured_at",
        "observed_at",
        "dns_records",
        "webhook",
        "next_check_after_seconds",
      ],
      ["dns"],
    );
    id(r["domain_id"]);
    domain(r["domain"]);
    if (r["environment_id"] !== input.environmentId) invalid();
    for (const key of ["sending", "receiving"])
      if (!["disabled", "pending", "ready", "failed"].includes(String(r[key]))) invalid();
    if (!["ready", "verification_pending"].includes(String(r["status"]))) invalid();
    time(r["configured_at"]);
    if (r["observed_at"] !== null) time(r["observed_at"]);
    records(r["dns_records"]);
    if (r["next_check_after_seconds"] !== null && r["next_check_after_seconds"] !== 60) invalid();
    if (r["webhook"] !== null) {
      const hook = object(r["webhook"]);
      exact(hook, ["url", "verified"]);
      https(hook["url"]);
      if (typeof hook["verified"] !== "boolean") invalid();
    }
    if (r["dns"] !== undefined) {
      const dns = object(r["dns"]);
      exact(dns, ["status", "records"]);
      if (!["configured", "action_required", "conflict"].includes(String(dns["status"]))) invalid();
      records(dns["records"]);
    }
    return;
  }
  if (input.action === "webhook_set") {
    exact(r, ["url", "signing_secret", "status"]);
    if (
      r["url"] !== input.url ||
      r["status"] !== "verification_required" ||
      typeof r["signing_secret"] !== "string" ||
      !/^whsec_[A-Za-z0-9+/]{43}=$/u.test(r["signing_secret"])
    )
      invalid();
    return;
  }
  if (input.action === "webhook_disable") {
    exact(r, ["status"]);
    if (r["status"] !== "disabled") invalid();
    return;
  }
  if (input.action === "domain_delete") {
    exact(r, ["status", "domain", "dns_records"]);
    if (r["status"] !== "deleted") invalid();
    domain(r["domain"]);
    records(r["dns_records"]);
    return;
  }
  if (input.action === "messages_list") {
    exact(r, ["items"]);
    if (!Array.isArray(r["items"]) || r["items"].length > 50) invalid();
    for (const value of r["items"]) {
      const item = object(value);
      exact(item, ["message_id", "received_at", "state", "attempts"]);
      id(item["message_id"]);
      time(item["received_at"]);
      if (
        !["pending", "delivering", "delivered", "delivery_failed", "expired"].includes(
          String(item["state"]),
        ) ||
        !Number.isInteger(item["attempts"]) ||
        Number(item["attempts"]) < 0 ||
        Number(item["attempts"]) > 4
      )
        invalid();
    }
    return;
  }
  if (input.action === "message_retry") {
    exact(r, ["attempted"], ["delivered"]);
    if (
      typeof r["attempted"] !== "boolean" ||
      (r["delivered"] !== undefined && typeof r["delivered"] !== "boolean")
    )
      invalid();
    return;
  }
  if (input.action !== "message_get") invalid();
  if (r["status"] === "expired") {
    exact(r, ["status"]);
    return;
  }
  exact(r, [
    "id",
    "domain",
    "received_at",
    "expires_at",
    "from",
    "to",
    "subject",
    "text",
    "html",
    "message_id",
    "attachments",
  ]);
  if (r["id"] !== input.messageId) invalid();
  domain(r["domain"]);
  time(r["received_at"]);
  time(r["expires_at"]);
  if (Date.parse(String(r["expires_at"])) - Date.parse(String(r["received_at"])) !== 72 * 3600000)
    invalid();
  for (const key of ["from", "subject", "message_id"]) if (typeof r[key] !== "string") invalid();
  for (const key of ["text", "html"]) if (r[key] !== null && typeof r[key] !== "string") invalid();
  if (
    !Array.isArray(r["to"]) ||
    r["to"].some(
      (v) => typeof v !== "string" || v.slice(v.lastIndexOf("@") + 1).toLowerCase() !== r["domain"],
    )
  )
    invalid();
  if (!Array.isArray(r["attachments"])) invalid();
  for (const value of r["attachments"]) {
    const a = object(value);
    exact(a, ["id", "filename", "content_type", "download_path"]);
    if (
      typeof a["id"] !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(a["id"]) ||
      (a["filename"] !== null && typeof a["filename"] !== "string") ||
      typeof a["content_type"] !== "string" ||
      a["download_path"] !==
        `/v1/projects/${input.projectId}/environments/${input.environmentId}/mail/messages/${input.messageId}/attachments/${a["id"]}`
    )
      invalid();
  }
}
function object(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) invalid();
  return v as Record<string, unknown>;
}
function exact(
  v: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  if (
    required.some((k) => !(k in v)) ||
    Object.keys(v).some((k) => !required.includes(k) && !optional.includes(k))
  )
    invalid();
}
function id(v: unknown) {
  if (typeof v !== "string" || !ULID.test(v)) invalid();
}
function domain(v: unknown) {
  if (
    typeof v !== "string" ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(v)
  )
    invalid();
}
function time(v: unknown) {
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v)
    invalid();
}
function https(v: unknown) {
  if (typeof v !== "string" || !v.startsWith("https://")) invalid();
}
function records(v: unknown) {
  if (!Array.isArray(v)) invalid();
  for (const value of v) {
    const r = object(value);
    exact(r, ["type", "name", "value", "purpose", "status"], ["priority"]);
    if (
      !["TXT", "CNAME", "MX"].includes(String(r["type"])) ||
      ["name", "value", "purpose", "status"].some((k) => typeof r[k] !== "string") ||
      (r["type"] === "MX" &&
        (!Number.isInteger(r["priority"]) ||
          Number(r["priority"]) < 0 ||
          Number(r["priority"]) > 65535))
    )
      invalid();
  }
}
function invalid(): never {
  throw new TypeError("Mail response contract invalid");
}
