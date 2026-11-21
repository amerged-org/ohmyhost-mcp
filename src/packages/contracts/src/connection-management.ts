const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const requestId = /^[a-f0-9]{64}$/u;
const appName = /^[A-Za-z0-9_-]{1,128}$/u;
const moduleId = /^[A-Za-z0-9_.:-]{1,128}$/u;
const makeOrigins = new Set([
  "https://eu1.make.com",
  "https://eu2.make.com",
  "https://us1.make.com",
  "https://us2.make.com",
  "https://we.make.com",
  "https://eu1.make.celonis.com",
  "https://us1.make.celonis.com",
]);

export interface MakeCredentialSelection {
  app_name: string;
  app_version: number;
  module_ids?: string[];
  endpoint_names?: string[];
}

function selectors(raw: unknown, format: RegExp): boolean {
  return (
    Array.isArray(raw) &&
    raw.length >= 1 &&
    raw.length <= 64 &&
    raw.every(
      (value) =>
        typeof value === "string" &&
        format.test(value) &&
        value.replaceAll(/[-_.:]/gu, "").toLowerCase() !== "arbitrarycall",
    ) &&
    new Set(raw).size === raw.length
  );
}

export function parseMakeCredentialSelections(raw: unknown): MakeCredentialSelection[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 64)
    throw new TypeError("Invalid Make credential selections");
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new TypeError("Invalid Make credential selection");
    const value = entry as Record<string, unknown>;
    if (
      Object.keys(value).some(
        (key) => !["app_name", "app_version", "module_ids", "endpoint_names"].includes(key),
      ) ||
      typeof value["app_name"] !== "string" ||
      !appName.test(value["app_name"]) ||
      !Number.isSafeInteger(value["app_version"]) ||
      Number(value["app_version"]) < 1 ||
      !(Object.hasOwn(value, "module_ids") || Object.hasOwn(value, "endpoint_names")) ||
      (Object.hasOwn(value, "module_ids") && !selectors(value["module_ids"], moduleId)) ||
      (Object.hasOwn(value, "endpoint_names") && !selectors(value["endpoint_names"], appName))
    )
      throw new TypeError("Invalid Make credential selection");
  }
  return raw as MakeCredentialSelection[];
}

function parseMakeCredentialResult(raw: unknown, create: boolean): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new TypeError("Invalid connection response");
  const value = raw as Record<string, unknown>;
  const state = value["state"];
  if (
    Object.keys(value).some(
      (key) =>
        !["state", "request_id", "provider_status", "authorization_url", "expires_at"].includes(
          key,
        ),
    ) ||
    !["created", "running", "uncertain", "reconnect_required"].includes(String(state)) ||
    ((state === "created" || value["request_id"] !== undefined) &&
      (typeof value["request_id"] !== "string" || !requestId.test(value["request_id"]))) ||
    (state === "created"
      ? typeof value["provider_status"] !== "string" ||
        !/^[a-z_]{1,64}$/u.test(value["provider_status"])
      : value["provider_status"] !== undefined || value["expires_at"] !== undefined)
  )
    throw new TypeError("Invalid connection response");
  if (value["expires_at"] !== null && value["expires_at"] !== undefined) date(value["expires_at"]);
  if (value["authorization_url"] === undefined) return;
  if (!create || state !== "created" || typeof value["authorization_url"] !== "string")
    throw new TypeError("Invalid connection response");
  const url = new URL(value["authorization_url"]);
  if (
    !makeOrigins.has(url.origin) ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/[1-9][0-9]*\/credentials-requests\/inbox$/u.test(url.pathname) ||
    url.searchParams.size !== 1 ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(url.searchParams.get("requestId") ?? "")
  )
    throw new TypeError("Invalid connection response");
}

function record(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new TypeError("Invalid connection response");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    throw new TypeError("Invalid connection response");
  return value;
}
function date(raw: unknown): void {
  if (typeof raw !== "string" || !Number.isFinite(Date.parse(raw)))
    throw new TypeError("Invalid connection response");
}
function items(raw: unknown): void {
  if (!Array.isArray(raw) || raw.length > 10000) throw new TypeError("Invalid connection response");
  for (const row of raw) {
    const v = record(row, ["id", "name"]);
    if (
      !Number.isSafeInteger(v["id"]) ||
      Number(v["id"]) < 1 ||
      typeof v["name"] !== "string" ||
      !v["name"] ||
      v["name"].length > 1024
    )
      throw new TypeError("Invalid connection response");
  }
}
export function parseConnectionResponse(
  kind:
    | "connection-begin"
    | "connection-list"
    | "connection-status"
    | "connection-discover"
    | "connection-disconnect"
    | "connection-import"
    | "connection-credential-request-create"
    | "connection-credential-request-status",
  raw: unknown,
  expectedOrigin?: string,
): unknown {
  if (
    kind === "connection-credential-request-create" ||
    kind === "connection-credential-request-status"
  ) {
    parseMakeCredentialResult(raw, kind === "connection-credential-request-create");
  } else if (kind === "connection-begin") {
    const v = record(raw, ["request_id", "url", "expires_at"]);
    date(v["expires_at"]);
    if (
      typeof v["request_id"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(v["request_id"]) ||
      typeof v["url"] !== "string"
    )
      throw new TypeError("Invalid connection response");
    const url = new URL(v["url"]);
    if (
      !["https://app.ohmyho.st", "https://dev.app.ohmyho.st"].includes(url.origin) ||
      (expectedOrigin !== undefined && url.origin !== expectedOrigin) ||
      url.pathname !== "/connections/authorize" ||
      url.hash ||
      url.searchParams.size !== 1 ||
      !/^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get("request") ?? "")
    )
      throw new TypeError("Invalid connection response");
  } else if (kind === "connection-status") {
    const v = record(raw, ["state", "expires_at"]);
    date(v["expires_at"]);
    if (!["pending", "consumed", "expired"].includes(String(v["state"])))
      throw new TypeError("Invalid connection response");
  } else if (kind === "connection-disconnect") {
    const v = record(raw, ["state"]);
    if (!["disconnected", "revocation_pending"].includes(String(v["state"])))
      throw new TypeError("Invalid connection response");
  } else if (kind === "connection-import") {
    const v = record(raw, [
      "id",
      "grant_id",
      "project_id",
      "environment_id",
      "provider_organization_id",
      "team_id",
      "connection_id",
    ]);
    for (const key of ["id", "grant_id", "project_id", "environment_id"])
      if (typeof v[key] !== "string" || !ulid.test(v[key] as string))
        throw new TypeError("Invalid connection response");
    for (const key of ["provider_organization_id", "team_id", "connection_id"])
      if (!Number.isSafeInteger(v[key]) || Number(v[key]) < 1)
        throw new TypeError("Invalid connection response");
  } else if (kind === "connection-discover") {
    const v = record(raw, ["organizations", "teams", "connections"]);
    items(v["organizations"]);
    items(v["teams"]);
    items(v["connections"]);
  } else {
    const v = record(raw, ["connections"]);
    if (!Array.isArray(v["connections"]) || v["connections"].length > 10000)
      throw new TypeError("Invalid connection response");
    for (const row of v["connections"]) {
      const grant = record(row, ["id", "provider", "state", "created_at"]);
      date(grant["created_at"]);
      if (
        typeof grant["id"] !== "string" ||
        !ulid.test(grant["id"]) ||
        grant["provider"] !== "make" ||
        !["active", "refreshing", "reconnect_required", "disconnecting", "disconnected"].includes(
          String(grant["state"]),
        )
      )
        throw new TypeError("Invalid connection response");
    }
  }
  return raw;
}
