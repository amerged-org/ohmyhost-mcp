import { publicOperationFailure, type PublicOperationFailure } from "./operation-failure.js";

export type DatabaseEnvironment = "dev" | "prod";
export type DatabaseJson =
  | null
  | string
  | number
  | boolean
  | readonly DatabaseJson[]
  | { readonly [key: string]: DatabaseJson };
export interface ProjectDatabaseWriteRequest {
  readonly environment: DatabaseEnvironment;
  readonly statement: string;
  readonly parameters: readonly DatabaseJson[];
}
export interface ProjectDatabaseWriteReceipt {
  readonly operation_id: string;
  readonly environment: DatabaseEnvironment;
  readonly state: "running" | "succeeded" | "failed";
  readonly command: "INSERT" | "UPDATE" | "DELETE" | null;
  readonly affected_rows: number | null;
  readonly error: PublicOperationFailure | null;
}
/** These limits apply to one direct DML statement; PostgreSQL owns SQL grammar. */
export function parseProjectDatabaseWrite(value: unknown): ProjectDatabaseWriteRequest {
  if (
    !record(value) ||
    !exact(value, ["environment", "statement", "parameters"]) ||
    !["dev", "prod"].includes(String(value["environment"])) ||
    typeof value["statement"] !== "string" ||
    !/^\s*(?:insert|update|delete)\b/iu.test(value["statement"]) ||
    new TextEncoder().encode(value["statement"]).byteLength > 65_536 ||
    value["statement"].includes("\0") ||
    !Array.isArray(value["parameters"]) ||
    value["parameters"].length > 100
  )
    throw new TypeError("Invalid database write");
  const budget = { nodes: 0 };
  for (const parameter of value["parameters"]) json(parameter, 0, budget);
  if (new TextEncoder().encode(JSON.stringify(value["parameters"])).byteLength > 65_536)
    throw new TypeError("Invalid database parameters");
  return {
    environment: value["environment"] as DatabaseEnvironment,
    statement: value["statement"],
    parameters: value["parameters"] as DatabaseJson[],
  };
}
export function assertProjectDatabaseWriteReceipt(
  value: unknown,
): asserts value is ProjectDatabaseWriteReceipt {
  if (
    !record(value) ||
    !exact(value, ["operation_id", "environment", "state", "command", "affected_rows", "error"]) ||
    typeof value["operation_id"] !== "string" ||
    !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(value["operation_id"]) ||
    !["dev", "prod"].includes(String(value["environment"])) ||
    !["running", "succeeded", "failed"].includes(String(value["state"]))
  )
    throw new TypeError("Invalid database write receipt");
  if (value["state"] === "succeeded") {
    if (
      !["INSERT", "UPDATE", "DELETE"].includes(String(value["command"])) ||
      !Number.isSafeInteger(value["affected_rows"]) ||
      Number(value["affected_rows"]) < 0 ||
      Number(value["affected_rows"]) > 1000 ||
      value["error"] !== null
    )
      throw new TypeError("Invalid database write result");
  } else {
    if (value["command"] !== null || value["affected_rows"] !== null)
      throw new TypeError("Invalid database write result");
    if (value["state"] === "running") {
      if (value["error"] !== null) throw new TypeError("Invalid database write result");
    } else {
      const error = value["error"];
      if (
        !record(error) ||
        typeof error["code"] !== "string" ||
        !error["code"].startsWith("database_write_") ||
        JSON.stringify(error) !== JSON.stringify(publicOperationFailure(error["code"]))
      )
        throw new TypeError("Invalid database write error");
    }
  }
}
export type DatabaseAccessMode = "read" | "write";
export const DATABASE_ACCESS_MIN_TTL_SECONDS = 300;
export const DATABASE_ACCESS_DEFAULT_TTL_SECONDS = 3600;
export const DATABASE_ACCESS_MAX_TTL_SECONDS = 86_400;
export interface ProjectDatabaseAccessRequest {
  readonly environment: DatabaseEnvironment;
  readonly mode: DatabaseAccessMode;
  readonly ttl_seconds: number;
  readonly label: string | null;
}
export interface ProjectDatabaseAccess {
  readonly access_id: string;
  readonly environment: DatabaseEnvironment;
  readonly mode: DatabaseAccessMode;
  readonly role_name: string;
  readonly host: string;
  readonly database: "neondb";
  readonly label: string | null;
  readonly state: "active" | "expired" | "revoked";
  readonly issued_at: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
  readonly revocation_reason: "principal" | "expired" | "budget" | "creation_failed" | null;
}
export interface ProjectDatabaseAccessCredential extends ProjectDatabaseAccess {
  readonly connection_uri: string;
  readonly psql_command: string;
}
export interface ProjectDatabaseAccessPage {
  readonly items: readonly ProjectDatabaseAccess[];
}
const ACCESS_KEYS = [
  "access_id",
  "environment",
  "mode",
  "role_name",
  "host",
  "database",
  "label",
  "state",
  "issued_at",
  "expires_at",
  "revoked_at",
  "revocation_reason",
] as const;
const ACCESS_ROLE_PATTERN = /^ohmyho_da_[0-7][0-9a-hjkmnp-tv-z]{25}_[0-9a-z]{8}$/u;
/** The customer chooses only the environment, the rights, the lifetime and a label. */
export function parseProjectDatabaseAccessRequest(value: unknown): ProjectDatabaseAccessRequest {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => !["environment", "mode", "ttl_seconds", "label"].includes(key),
    ) ||
    !["dev", "prod"].includes(String(value["environment"])) ||
    (value["mode"] !== undefined && !["read", "write"].includes(String(value["mode"])))
  )
    throw new TypeError("Invalid database access request");
  const ttl = value["ttl_seconds"] ?? DATABASE_ACCESS_DEFAULT_TTL_SECONDS;
  if (
    !Number.isSafeInteger(ttl) ||
    Number(ttl) < DATABASE_ACCESS_MIN_TTL_SECONDS ||
    Number(ttl) > DATABASE_ACCESS_MAX_TTL_SECONDS
  )
    throw new TypeError("Invalid database access lifetime");
  return {
    environment: value["environment"] as DatabaseEnvironment,
    mode: (value["mode"] ?? "read") as DatabaseAccessMode,
    ttl_seconds: Number(ttl),
    label: accessLabel(value["label"]),
  };
}
export function assertProjectDatabaseAccess(
  value: unknown,
): asserts value is ProjectDatabaseAccess {
  if (!record(value) || !exact(value, ACCESS_KEYS)) throw new TypeError("Invalid database access");
  assertAccessFields(value);
}
export function assertProjectDatabaseAccessCredential(
  value: unknown,
): asserts value is ProjectDatabaseAccessCredential {
  if (!record(value) || !exact(value, [...ACCESS_KEYS, "connection_uri", "psql_command"]))
    throw new TypeError("Invalid database access credential");
  assertAccessFields(value);
  const uri = value["connection_uri"];
  if (typeof uri !== "string" || value["psql_command"] !== `psql '${uri}'`)
    throw new TypeError("Invalid database access credential");
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new TypeError("Invalid database access credential");
  }
  if (
    parsed.protocol !== "postgresql:" ||
    decodeURIComponent(parsed.username) !== value["role_name"] ||
    parsed.password === "" ||
    parsed.hostname !== value["host"] ||
    parsed.host !== value["host"] ||
    decodeURIComponent(parsed.pathname.slice(1)) !== "neondb" ||
    parsed.search !== "?sslmode=require"
  )
    throw new TypeError("Invalid database access credential");
}
export function assertProjectDatabaseAccessPage(
  value: unknown,
): asserts value is ProjectDatabaseAccessPage {
  if (
    !record(value) ||
    !exact(value, ["items"]) ||
    !Array.isArray(value["items"]) ||
    value["items"].length > 50
  )
    throw new TypeError("Invalid database access page");
  for (const item of value["items"]) assertProjectDatabaseAccess(item);
}
function assertAccessFields(value: Record<string, unknown>): void {
  const revoked = value["revoked_at"],
    reason = value["revocation_reason"];
  if (
    typeof value["access_id"] !== "string" ||
    !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(value["access_id"]) ||
    !["dev", "prod"].includes(String(value["environment"])) ||
    !["read", "write"].includes(String(value["mode"])) ||
    typeof value["role_name"] !== "string" ||
    !ACCESS_ROLE_PATTERN.test(value["role_name"]) ||
    typeof value["host"] !== "string" ||
    !/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/u.test(value["host"]) ||
    value["database"] !== "neondb" ||
    (value["label"] !== null && accessLabel(value["label"]) !== value["label"]) ||
    !["active", "expired", "revoked"].includes(String(value["state"])) ||
    !timestamp(value["issued_at"]) ||
    !timestamp(value["expires_at"]) ||
    Date.parse(String(value["expires_at"])) <= Date.parse(String(value["issued_at"])) ||
    (revoked !== null && !timestamp(revoked)) ||
    (revoked === null) !== (reason === null) ||
    (reason !== null &&
      !["principal", "expired", "budget", "creation_failed"].includes(String(reason))) ||
    (value["state"] === "revoked") !== (revoked !== null)
  )
    throw new TypeError("Invalid database access");
}
function accessLabel(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new TypeError("Invalid database access label");
  const label = value.trim();
  if (label.length < 1 || label.length > 64 || /\p{Cc}/u.test(label))
    throw new TypeError("Invalid database access label");
  return label;
}
function timestamp(value: unknown): boolean {
  return typeof value === "string" && new Date(value).toISOString() === value;
}
function json(value: unknown, depth: number, budget: { nodes: number }): void {
  if (++budget.nodes > 10_000 || depth > 8) throw new TypeError("Invalid database parameter");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const entry of value) json(entry, depth + 1, budget);
    return;
  }
  if (record(value)) {
    for (const entry of Object.values(value)) json(entry, depth + 1, budget);
    return;
  }
  throw new TypeError("Invalid database parameter");
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
