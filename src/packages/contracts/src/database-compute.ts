import { databaseSizeForClass } from "./database-sizes.js";

export type PgcfComputeState = "provisioning" | "cold" | "warm" | "suspended" | "error";
export interface PgcfDatabaseCompute {
  readonly provider: "pgcf";
  readonly size_class_id: string;
  readonly memory_mib: number;
  readonly cpu_millicores: number;
  readonly storage_mib: number;
  readonly max_connections: number;
  readonly suspend_timeout_seconds: number;
  readonly state: PgcfComputeState;
  readonly pending_state: PgcfComputeState | null;
  readonly disabled: boolean;
  readonly region: "us" | "eu";
}

export interface DatabaseCompute {
  readonly project_id: string;
  readonly environment: "dev" | "prod";
  readonly data_mode: "shared" | "isolated";
  readonly observed_at: string;
  readonly database: null | PgcfDatabaseCompute;
}
export const DATABASE_NOT_SET_UP = {
  status: "not_set_up",
  next_step:
    "If an operation is creating the database, wait for it to finish with operation_get. Otherwise, enable the managed database in ohmyhost.yaml, save the version and deploy it to this environment.",
} as const;
export type DatabaseComputeRead = DatabaseCompute | typeof DATABASE_NOT_SET_UP;

export function assertDatabaseComputeRead(value: unknown): asserts value is DatabaseComputeRead {
  if (record(value) && value["status"] === "not_set_up") {
    if (
      !exact(value, ["next_step", "status"]) ||
      value["next_step"] !== DATABASE_NOT_SET_UP.next_step
    )
      throw new TypeError("Invalid database setup response");
    return;
  }
  assertDatabaseCompute(value);
}

export function assertDatabaseCompute(value: unknown): asserts value is DatabaseCompute {
  if (
    !record(value) ||
    !exact(value, ["data_mode", "database", "environment", "observed_at", "project_id"]) ||
    typeof value["project_id"] !== "string" ||
    !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(value["project_id"]) ||
    !["dev", "prod"].includes(String(value["environment"])) ||
    !["shared", "isolated"].includes(String(value["data_mode"])) ||
    typeof value["observed_at"] !== "string" ||
    !Number.isFinite(Date.parse(value["observed_at"])) ||
    new Date(value["observed_at"]).toISOString() !== value["observed_at"]
  )
    throw new TypeError("Invalid database compute report");
  const db = value["database"];
  if (db === null) return;
  if (!record(db) || db["provider"] !== "pgcf")
    throw new TypeError("Invalid database compute configuration");
  assertPgcfCompute(db);
}
function assertPgcfCompute(db: Record<string, unknown>): void {
  const size = databaseSizeForClass(db["size_class_id"]);
  const states = ["provisioning", "cold", "warm", "suspended", "error"];
  if (
    !exact(db, [
      "cpu_millicores",
      "disabled",
      "max_connections",
      "memory_mib",
      "pending_state",
      "provider",
      "region",
      "size_class_id",
      "state",
      "storage_mib",
      "suspend_timeout_seconds",
    ]) ||
    db["memory_mib"] !== size.memoryMiB ||
    db["cpu_millicores"] !== size.cpuMillicores ||
    db["storage_mib"] !== size.storageMiB ||
    db["max_connections"] !== size.maxConnections ||
    !Number.isSafeInteger(db["suspend_timeout_seconds"]) ||
    Number(db["suspend_timeout_seconds"]) < 60 ||
    Number(db["suspend_timeout_seconds"]) > 900 ||
    !states.includes(String(db["state"])) ||
    (db["pending_state"] !== null && !states.includes(String(db["pending_state"]))) ||
    typeof db["disabled"] !== "boolean" ||
    !["us", "eu"].includes(String(db["region"]))
  )
    throw new TypeError("Invalid fixed database compute configuration");
}
function record(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function exact(v: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(v).sort().join(",") === keys.join(",");
}
