const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
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
    | "connection-disconnect",
  raw: unknown,
  expectedOrigin?: string,
): unknown {
  if (kind === "connection-begin") {
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
