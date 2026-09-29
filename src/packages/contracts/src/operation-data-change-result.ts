import {
  parseOperationDeploymentResult,
  type OperationDeploymentResult,
} from "./operation-deployment-result.js";

export const OPERATION_DATA_CHANGE_RESULT_SCHEMA_VERSION =
  "ohmyhost.operation-data-change-result/v1" as const;
export interface OperationDataChangeResult {
  readonly schemaVersion: typeof OPERATION_DATA_CHANGE_RESULT_SCHEMA_VERSION;
  readonly operationId: string;
  readonly change:
    | "isolate_prod_keeps_data"
    | "isolate_dev_keeps_data"
    | "share_prod_keeps_data"
    | "reset_dev";
  readonly data_mode: "shared" | "isolated";
  readonly redeploy_environments: readonly ("dev" | "prod")[];
  readonly deleted_database: boolean;
  readonly deleted_files: number;
}
export type OperationResult = OperationDeploymentResult | OperationDataChangeResult;

export function createOperationDataChangeResult(
  input: Omit<OperationDataChangeResult, "schemaVersion">,
): OperationDataChangeResult {
  return parseOperationDataChangeResult({
    schemaVersion: OPERATION_DATA_CHANGE_RESULT_SCHEMA_VERSION,
    ...input,
  });
}
export function parseOperationDataChangeResult(value: unknown): OperationDataChangeResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).sort().join(",") !==
      "change,data_mode,deleted_database,deleted_files,operationId,redeploy_environments,schemaVersion" ||
    input["schemaVersion"] !== OPERATION_DATA_CHANGE_RESULT_SCHEMA_VERSION ||
    typeof input["operationId"] !== "string" ||
    !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(input["operationId"])
  )
    invalid();
  const change = input["change"];
  if (
    change !== "isolate_prod_keeps_data" &&
    change !== "isolate_dev_keeps_data" &&
    change !== "share_prod_keeps_data" &&
    change !== "reset_dev"
  )
    invalid();
  const retiring = change === "reset_dev" || change === "share_prod_keeps_data";
  const redeploy = input["redeploy_environments"];
  if (
    input["data_mode"] !== (change === "share_prod_keeps_data" ? "shared" : "isolated") ||
    !Array.isArray(redeploy) ||
    redeploy.length !== 1 ||
    redeploy[0] !== (change === "isolate_dev_keeps_data" ? "prod" : "dev") ||
    typeof input["deleted_database"] !== "boolean" ||
    !Number.isSafeInteger(input["deleted_files"]) ||
    Number(input["deleted_files"]) < 0 ||
    (!retiring && (input["deleted_database"] || input["deleted_files"] !== 0))
  )
    invalid();
  return Object.freeze({
    schemaVersion: OPERATION_DATA_CHANGE_RESULT_SCHEMA_VERSION,
    operationId: input["operationId"],
    change,
    data_mode: input["data_mode"] as "shared" | "isolated",
    redeploy_environments: Object.freeze([redeploy[0] as "dev" | "prod"]),
    deleted_database: input["deleted_database"],
    deleted_files: Number(input["deleted_files"]),
  });
}

/** Keep the deployment-specific parser and its return type unchanged. */
export function parseOperationResult(value: unknown): OperationResult {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)["schemaVersion"] ===
      OPERATION_DATA_CHANGE_RESULT_SCHEMA_VERSION
    ? parseOperationDataChangeResult(value)
    : parseOperationDeploymentResult(value);
}
function invalid(): never {
  throw new TypeError("Operation data change result is invalid");
}
