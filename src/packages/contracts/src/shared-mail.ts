export interface SharedMailResponseContext {
  readonly action: string;
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly environmentId?: string;
  readonly mailDomainId?: string;
}
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

/** Strict validation keeps provider data and out-of-scope resources out of client guidance. */
export function assertSharedMailResponse(value: unknown, input: SharedMailResponseContext): void {
  const v = object(value);
  if (input.action === "domains_list") {
    exact(v, ["items"]);
    if (!Array.isArray(v["items"]) || v["items"].length > 100) invalid();
    for (const item of v["items"])
      assertSharedMailResponse(item, {
        ...input,
        action: "domain_get",
        mailDomainId: String(object(item)["domain_id"]),
      });
    return;
  }
  if (["domain_get", "domain_create", "domain_retire"].includes(input.action)) {
    exact(v, [
      "domain_id",
      "organization_id",
      "domain",
      "registrable_domain",
      "revision",
      "status",
      "sending",
      "receiving",
      "configured_at",
      "observed_at",
      "dns_records",
      "bindings_count",
    ]);
    id(v["domain_id"]);
    id(v["organization_id"]);
    if (
      !("organizationId" in input) ||
      v["organization_id"] !== input.organizationId ||
      ("mailDomainId" in input && v["domain_id"] !== input.mailDomainId)
    )
      invalid();
    host(v["domain"]);
    host(v["registrable_domain"]);
    positive(v["revision"]);
    member(v["status"], ["active", "retiring", "retired"]);
    for (const k of ["sending", "receiving"])
      member(v[k], ["disabled", "pending", "ready", "failed"]);
    time(v["configured_at"]);
    if (v["observed_at"] !== null) time(v["observed_at"]);
    if (!Number.isSafeInteger(v["bindings_count"]) || Number(v["bindings_count"]) < 0) invalid();
    if (!Array.isArray(v["dns_records"])) invalid();
    for (const entry of v["dns_records"]) {
      const r = object(entry);
      exact(r, ["type", "name", "value", "purpose", "status"], ["priority"]);
      member(r["type"], ["TXT", "MX", "CNAME"]);
      for (const k of ["name", "value", "purpose", "status"])
        if (typeof r[k] !== "string" || /[\r\n\0]/u.test(r[k])) invalid();
      if (
        r["priority"] !== undefined &&
        (!Number.isSafeInteger(r["priority"]) ||
          Number(r["priority"]) < 0 ||
          Number(r["priority"]) > 65535)
      )
        invalid();
      if (r["type"] === "MX" && r["priority"] === undefined) invalid();
    }
    return;
  }
  if (["binding_get", "binding_set", "binding_detach"].includes(input.action)) {
    exact(v, [
      "mail_domain_id",
      "organization_id",
      "project_id",
      "environment_id",
      "revision",
      "sending",
      "sender_addresses",
      "default_from",
      "default_reply_to",
      "legacy",
      "status",
      "application_domain_identity",
    ]);
    for (const k of ["mail_domain_id", "organization_id", "project_id", "environment_id"]) id(v[k]);
    if (
      !("projectId" in input) ||
      !("environmentId" in input) ||
      v["project_id"] !== input.projectId ||
      v["environment_id"] !== input.environmentId ||
      ("mailDomainId" in input && v["mail_domain_id"] !== input.mailDomainId)
    )
      invalid();
    positive(v["revision"]);
    for (const k of ["sending", "legacy"]) if (typeof v[k] !== "boolean") invalid();
    member(v["status"], ["active", "detached", "suspended"]);
    if (
      !Array.isArray(v["sender_addresses"]) ||
      v["sender_addresses"].length > 32 ||
      new Set(v["sender_addresses"]).size !== v["sender_addresses"].length
    )
      invalid();
    for (const a of v["sender_addresses"]) mailbox(a);
    for (const k of ["default_from", "default_reply_to"]) if (v[k] !== null) mailbox(v[k]);
    if (
      !v["legacy"] &&
      (!v["sender_addresses"].includes(v["default_from"]) || v["sender_addresses"].length === 0)
    )
      invalid();
    if (v["application_domain_identity"] !== null) {
      const identity = object(v["application_domain_identity"]);
      exact(identity, ["hostname", "registrable_domain", "revision", "status"]);
      host(identity["hostname"]);
      host(identity["registrable_domain"]);
      positive(identity["revision"]);
      member(identity["status"], ["pending", "verified", "expired", "revoked"]);
    }
    return;
  }
  if (
    ["identity_get", "identity_declare", "identity_verify", "identity_revoke"].includes(
      input.action,
    )
  ) {
    exact(v, [
      "organization_id",
      "project_id",
      "hostname",
      "registrable_domain",
      "status",
      "revision",
      "challenge",
      "verified_at",
      "expires_at",
    ]);
    id(v["organization_id"]);
    id(v["project_id"]);
    if (!("projectId" in input) || v["project_id"] !== input.projectId) invalid();
    host(v["hostname"]);
    host(v["registrable_domain"]);
    positive(v["revision"]);
    member(v["status"], ["pending", "verified", "expired", "revoked"]);
    const challenge = object(v["challenge"]);
    exact(challenge, ["type", "name", "value"]);
    if (
      challenge["type"] !== "TXT" ||
      typeof challenge["name"] !== "string" ||
      challenge["name"] !== `_omh-project.${v["hostname"]}` ||
      typeof challenge["value"] !== "string" ||
      challenge["value"].length < 16 ||
      challenge["value"].length > 255 ||
      /[\r\n\0]/u.test(challenge["value"])
    )
      invalid();
    if (v["verified_at"] !== null) time(v["verified_at"]);
    time(v["expires_at"]);
    return;
  }
  if (input.action === "domain_dns_authorize" || input.action === "identity_authorize") {
    exact(v, ["authorization_id", "authorization_url", "expires_at"]);
    id(v["authorization_id"]);
    time(v["expires_at"]);
    if (
      typeof v["authorization_url"] !== "string" ||
      !/^https:\/\/dash\.cloudflare\.com\/oauth2\/auth\?/u.test(v["authorization_url"])
    )
      invalid();
    return;
  }
  exact(v, ["status", "zone", "scopes", "expires_at"]);
  member(v["status"], ["not_authorized", "pending", "authorized", "expired", "revoked"]);
  if (
    !Array.isArray(v["scopes"]) ||
    v["scopes"].length > 2 ||
    new Set(v["scopes"]).size !== v["scopes"].length ||
    v["scopes"].some((s) => s !== "dns.write" && s !== "zone.read")
  )
    invalid();
  if (v["zone"] !== null) host(v["zone"]);
  if (v["expires_at"] !== null) time(v["expires_at"]);
  if (
    v["status"] === "not_authorized" &&
    (v["zone"] !== null || v["expires_at"] !== null || v["scopes"].length)
  )
    invalid();
}
function object(v: unknown): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) invalid();
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
function member(v: unknown, values: readonly string[]) {
  if (typeof v !== "string" || !values.includes(v)) invalid();
}
function id(v: unknown) {
  if (typeof v !== "string" || !ULID.test(v)) invalid();
}
function host(v: unknown) {
  if (typeof v !== "string" || !HOST.test(v)) invalid();
}
function positive(v: unknown) {
  if (!Number.isSafeInteger(v) || Number(v) < 1) invalid();
}
function time(v: unknown) {
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v)
    invalid();
}
function mailbox(v: unknown) {
  if (
    typeof v !== "string" ||
    v.length > 254 ||
    !/^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-z0-9.-]+\.[a-z]{2,63}$/u.test(v) ||
    v.startsWith(".") ||
    v.includes("..") ||
    v.includes(".@")
  )
    invalid();
}
function invalid(): never {
  throw new TypeError("Shared mail response contract invalid");
}
