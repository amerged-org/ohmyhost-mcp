export const PROJECT_DATA_CHANGE_KINDS = [
  "isolate_prod_keeps_data",
  "isolate_dev_keeps_data",
  "share_prod_keeps_data",
  "reset_dev",
] as const;
export type ProjectDataChangeKind = (typeof PROJECT_DATA_CHANGE_KINDS)[number];
export interface ProjectDataChangePlan {
  readonly action: "data_change";
  readonly project_id: string;
  readonly change: ProjectDataChangeKind;
  readonly data_mode_before: "shared" | "isolated";
  readonly data_mode_after: "shared" | "isolated";
  readonly effects: readonly string[];
  readonly destructive_effects: readonly string[];
  readonly redeploy_environments: readonly ("dev" | "prod")[];
  readonly risks: readonly string[];
  readonly resource_etag: string;
  readonly confirmation_token: string;
  readonly created_at: string;
  readonly expires_at: string;
}

/** A data change uses exactly the plan the owner reviewed; no loose destructive plan reader. */
export function parseProjectDataChangePlan(value: unknown): ProjectDataChangePlan {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).sort().join(",") !==
      "action,change,confirmation_token,created_at,data_mode_after,data_mode_before,destructive_effects,effects,expires_at,project_id,redeploy_environments,resource_etag,risks" ||
    input["action"] !== "data_change" ||
    typeof input["project_id"] !== "string" ||
    !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(input["project_id"]) ||
    !isProjectDataChangeKind(input["change"]) ||
    !["shared", "isolated"].includes(String(input["data_mode_before"])) ||
    input["data_mode_after"] !==
      (input["change"] === "share_prod_keeps_data" ? "shared" : "isolated") ||
    input["data_mode_before"] !==
      (input["change"].startsWith("isolate_") ? "shared" : "isolated") ||
    !Array.isArray(input["redeploy_environments"]) ||
    input["redeploy_environments"].length !== 1 ||
    input["redeploy_environments"][0] !==
      (input["change"] === "isolate_dev_keeps_data" ? "prod" : "dev") ||
    !planStrings(input["effects"]) ||
    !planStrings(input["destructive_effects"]) ||
    !planStrings(input["risks"]) ||
    typeof input["resource_etag"] !== "string" ||
    !/^"sha256-[a-f0-9]{64}"$/u.test(input["resource_etag"]) ||
    typeof input["confirmation_token"] !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(input["confirmation_token"]) ||
    !instant(input["created_at"]) ||
    !instant(input["expires_at"]) ||
    Date.parse(input["expires_at"]) - Date.parse(input["created_at"]) !== 600_000
  )
    invalid();
  return Object.freeze({
    ...input,
    effects: Object.freeze([...input["effects"]]),
    destructive_effects: Object.freeze([...input["destructive_effects"]]),
    risks: Object.freeze([...input["risks"]]),
    redeploy_environments: Object.freeze([...input["redeploy_environments"]]),
  }) as unknown as ProjectDataChangePlan;
}

export function isProjectDataChangeKind(value: unknown): value is ProjectDataChangeKind {
  return typeof value === "string" && PROJECT_DATA_CHANGE_KINDS.some((kind) => kind === value);
}
function planStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 32 &&
    value.every(
      (text) =>
        typeof text === "string" &&
        text.length > 0 &&
        text.length <= 2_000 &&
        !/[\p{Cc}\p{Cf}]/u.test(text),
    )
  );
}
function instant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function invalid(): never {
  throw new TypeError("Project data change plan is invalid");
}
