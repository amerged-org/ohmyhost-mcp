/** Closed, minimized records accepted by the private growth measurement plane. */
export const GROWTH_EVENT_NAMES = [
  "landing_view",
  "cta_clicked",
  "prompt_copy_succeeded",
  "prompt_copy_failed",
  "account_created",
  "account_deleted",
  "provider_auth_succeeded",
  "login_started",
  "callback_received",
  "login_failed",
  "portal_login_succeeded",
  "workspace_ready",
  "product_call_succeeded",
  "product_call_failed",
  "project_created",
  "source_initialized",
  "source_version_saved",
  "deployment_requested",
  "deployment_succeeded",
  "deployment_failed",
  "preview_open_clicked",
  "payment_succeeded",
  "refund_recorded",
  "dispute_recorded",
] as const;
export const GROWTH_ERRORS = [
  "invalid_input",
  "invalid_link",
  "login_context_missing",
  "login_state_mismatch",
  "login_expired",
  "provider_denied",
  "provider_unavailable",
  "token_exchange_failed",
  "identity_failed",
  "onboarding_failed",
  "authorization_denied",
  "source_failed",
  "build_failed",
  "health_failed",
  "quota_blocked",
  "unknown",
] as const;
export interface GrowthEventV1 {
  schema_version: 1;
  event_id: string;
  event_name: (typeof GROWTH_EVENT_NAMES)[number];
  outcome: "attempted" | "succeeded" | "failed" | "cancelled";
  occurred_at: string;
  received_at: string;
  platform_environment: "development" | "production";
  producer: "website" | "control_api" | "core" | "workos" | "billing";
  evidence_kind: "event" | "snapshot";
  flow_id: string | null;
  account_id: string | null;
  organization_id: string | null;
  project_id: string | null;
  operation_id: string | null;
  deployment_id: string | null;
  transport: "portal" | "remote_mcp" | "rest" | "local_client_reported" | "unknown";
  client_class: "unknown" | "other" | "chatgpt" | "claude" | "codex" | "cursor" | "cli" | "browser";
  client_class_trust: "verified" | "reported" | "unknown";
  error_class: (typeof GROWTH_ERRORS)[number] | null;
  campaign_key: string | null;
  request_country: string | null;
  platform_version?: string | null;
}
interface FactBase {
  schema_version: 1;
  fact_id: string;
  source_id: string;
  occurred_at: string | null;
  observed_at: string;
  source_version: string;
  account_id: string | null;
  organization_id: string | null;
  project_id: string | null;
  operation_id: string | null;
}
export interface DeploymentFactV1 extends FactBase {
  fact_type: "deployment";
  deployment_id: string;
  environment_id: string;
  target_environment: "dev" | "prod";
  kind: "deploy" | "promotion" | "rollback";
  status: "succeeded" | "failed";
  succeeded_at: string | null;
  health_status: "passed" | "failed" | "unknown";
  health_evidence_id: string | null;
}
export interface PaymentFactV1 extends FactBase {
  fact_type: "payment";
  provider_fact_id: string;
  payment_id: string | null;
  amount_minor: number;
  currency: string;
  money_effect: "received" | "refunded" | "withdrawn" | "restored" | "none";
}
export type GrowthFactV1 = DeploymentFactV1 | PaymentFactV1;
export interface GrowthMetricQuery {
  metric: string;
  cohort_start: string;
  cohort_end: string;
  as_of: string;
  platform_environment: "development" | "production";
  segment?: "all" | "test" | "non_test";
}
export interface GrowthMetricResult {
  metric: string;
  numerator: number;
  denominator: number;
  mature_count: number;
  pending_count: number;
  as_of: string;
  source_watermarks: Record<string, string | null>;
  evidence_kind: "event" | "snapshot" | "mixed";
  quality_flags: string[];
}
export interface MoneyCohortResult {
  currency: string;
  gross_receipts: number;
  refunds: number;
  withdrawn: number;
  restored: number;
  net_receipts: number;
  open_disputes: number;
  as_of: string;
  source_watermarks: Record<string, string | null>;
  quality_flags: string[];
}
const eventKeys = [
  "schema_version",
  "event_id",
  "event_name",
  "outcome",
  "occurred_at",
  "received_at",
  "platform_environment",
  "producer",
  "evidence_kind",
  "flow_id",
  "account_id",
  "organization_id",
  "project_id",
  "operation_id",
  "deployment_id",
  "transport",
  "client_class",
  "client_class_trust",
  "error_class",
  "campaign_key",
  "request_country",
];
const baseKeys = [
  "schema_version",
  "fact_type",
  "fact_id",
  "source_id",
  "occurred_at",
  "observed_at",
  "source_version",
  "account_id",
  "organization_id",
  "project_id",
  "operation_id",
];
const deploymentKeys = [
  ...baseKeys,
  "deployment_id",
  "environment_id",
  "target_environment",
  "kind",
  "status",
  "succeeded_at",
  "health_status",
  "health_evidence_id",
];
const paymentKeys = [
  ...baseKeys,
  "provider_fact_id",
  "payment_id",
  "amount_minor",
  "currency",
  "money_effect",
];
function record(
  input: unknown,
  keys: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("invalid growth record");
  const r = input as Record<string, unknown>;
  if (
    Object.keys(r).some((key) => !keys.includes(key) && !optional.includes(key)) ||
    keys.some((k) => !Object.hasOwn(r, k)) ||
    new TextEncoder().encode(JSON.stringify(r)).length > 4096
  )
    throw new Error("invalid growth fields");
  return r;
}
function one(r: Record<string, unknown>, k: string, choices: readonly unknown[]) {
  if (!choices.includes(r[k])) throw new Error(`invalid ${k}`);
}
function id(r: Record<string, unknown>, k: string, nullable = false) {
  const v = r[k];
  if (nullable && v === null) return;
  if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_:-]{0,199}$/.test(v))
    throw new Error(`invalid ${k}`);
}
function date(r: Record<string, unknown>, k: string, nullable = false) {
  const v = r[k];
  if (nullable && v === null) return;
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    throw new Error(`invalid ${k}`);
}
export function parseGrowthEvent(input: unknown): GrowthEventV1 {
  const r = record(input, eventKeys, ["platform_version"]);
  if (r["platform_version"] !== undefined) id(r, "platform_version", true);
  one(r, "schema_version", [1]);
  one(r, "event_name", GROWTH_EVENT_NAMES);
  one(r, "outcome", ["attempted", "succeeded", "failed", "cancelled"]);
  one(r, "platform_environment", ["development", "production"]);
  one(r, "producer", ["website", "control_api", "core", "workos", "billing"]);
  one(r, "evidence_kind", ["event", "snapshot"]);
  for (const k of ["event_id"]) id(r, k);
  for (const k of [
    "flow_id",
    "account_id",
    "organization_id",
    "project_id",
    "operation_id",
    "deployment_id",
    "campaign_key",
  ])
    id(r, k, true);
  date(r, "occurred_at");
  date(r, "received_at");
  one(r, "transport", ["portal", "remote_mcp", "rest", "local_client_reported", "unknown"]);
  one(r, "client_class", [
    "unknown",
    "other",
    "chatgpt",
    "claude",
    "codex",
    "cursor",
    "cli",
    "browser",
  ]);
  one(r, "client_class_trust", ["verified", "reported", "unknown"]);
  one(r, "error_class", [null, ...GROWTH_ERRORS]);
  if (
    r["request_country"] !== null &&
    (typeof r["request_country"] !== "string" ||
      !/^[A-Z]{2}$/.test(r["request_country"]) ||
      (r["producer"] !== "website" &&
        !(r["producer"] === "control_api" && r["transport"] === "portal")))
  )
    throw new Error("invalid request_country");
  if (
    r["producer"] === "website" &&
    (r["account_id"] !== null ||
      r["organization_id"] !== null ||
      r["project_id"] !== null ||
      r["operation_id"] !== null ||
      r["deployment_id"] !== null)
  )
    throw new Error("anonymous identity");
  if (r["client_class_trust"] === "verified" && r["transport"] === "local_client_reported")
    throw new Error("unverified client");
  return r as unknown as GrowthEventV1;
}
export function parseGrowthFact(input: unknown): GrowthFactV1 {
  const type = (input as { fact_type?: unknown } | null)?.fact_type;
  const r = record(input, type === "deployment" ? deploymentKeys : paymentKeys);
  one(r, "schema_version", [1]);
  one(r, "fact_type", ["deployment", "payment"]);
  for (const k of ["fact_id", "source_id"]) id(r, k);
  for (const k of ["account_id", "organization_id", "project_id", "operation_id"]) id(r, k, true);
  date(r, "occurred_at", true);
  date(r, "observed_at");
  id(r, "source_version");
  if (type === "deployment") {
    for (const k of ["deployment_id", "environment_id"]) id(r, k);
    id(r, "health_evidence_id", true);
    date(r, "succeeded_at", true);
    one(r, "target_environment", ["dev", "prod"]);
    one(r, "kind", ["deploy", "promotion", "rollback"]);
    one(r, "status", ["succeeded", "failed"]);
    one(r, "health_status", ["passed", "failed", "unknown"]);
  } else {
    id(r, "provider_fact_id");
    id(r, "payment_id", true);
    if (!Number.isSafeInteger(r["amount_minor"]) || (r["amount_minor"] as number) < 0)
      throw new Error("invalid amount_minor");
    if (typeof r["currency"] !== "string" || !/^[A-Z]{3}$/.test(r["currency"]))
      throw new Error("invalid currency");
    one(r, "money_effect", ["received", "refunded", "withdrawn", "restored", "none"]);
  }
  return r as unknown as GrowthFactV1;
}
