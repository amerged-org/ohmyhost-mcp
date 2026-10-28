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
  readonly database:
    | null
    | PgcfDatabaseCompute
    | {
        readonly min_cu: number;
        readonly max_cu: number;
        readonly min_memory_gb: number;
        readonly max_memory_gb: number;
        readonly suspend_timeout_seconds: number;
        readonly state: "init" | "active" | "idle";
        readonly pending_state: "init" | "active" | "idle" | null;
        readonly disabled: boolean;
        readonly region: string;
      };
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
  if (record(db) && db["provider"] === "pgcf") {
    assertPgcfCompute(db);
    return;
  }
  if (
    !record(db) ||
    !exact(db, [
      "disabled",
      "max_cu",
      "max_memory_gb",
      "min_cu",
      "min_memory_gb",
      "pending_state",
      "region",
      "state",
      "suspend_timeout_seconds",
    ]) ||
    typeof db["min_cu"] !== "number" ||
    typeof db["max_cu"] !== "number" ||
    !Number.isFinite(db["min_cu"]) ||
    !Number.isFinite(db["max_cu"]) ||
    db["min_cu"] < 0.25 ||
    db["max_cu"] < db["min_cu"] ||
    db["max_cu"] > Number.MAX_SAFE_INTEGER / 4096 ||
    db["min_memory_gb"] !== db["min_cu"] * 4 ||
    db["max_memory_gb"] !== db["max_cu"] * 4 ||
    !Number.isSafeInteger(db["suspend_timeout_seconds"]) ||
    Number(db["suspend_timeout_seconds"]) < -1 ||
    Number(db["suspend_timeout_seconds"]) > 604800 ||
    !["init", "active", "idle"].includes(String(db["state"])) ||
    (db["pending_state"] !== null &&
      !["init", "active", "idle"].includes(String(db["pending_state"]))) ||
    typeof db["disabled"] !== "boolean" ||
    typeof db["region"] !== "string" ||
    !/^aws-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]+$/u.test(db["region"])
  )
    throw new TypeError("Invalid database compute configuration");
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
