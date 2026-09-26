export type BillingTaxIssueCode =
  | "billing_tax_location_required"
  | "billing_tax_calculation_failed"
  | "billing_tax_configuration_required";
export interface BillingTaxIssue {
  code: BillingTaxIssueCode;
  invoice_id: string;
  observed_at: string;
  required_action: "open_billing_portal" | "contact_support";
}

export interface BillingCheckoutView {
  organization_id: string;
  checkout_id: string;
  offer: "topup" | "paid";
  state: "open" | "complete" | "expired";
  payment_confirmed: boolean;
  url: string | null;
  expires_at: string;
  packs: number;
  credited_micros: string;
  revoked_micros: string;
  paid_until: string | null;
  required_action: "none" | "complete_checkout" | "open_billing_portal" | "contact_support";
  billing_issue: BillingTaxIssue | null;
}
export interface BillingPortalView {
  organization_id: string;
  url: string;
  created_at: string;
}
export function assertBillingTaxIssue(value: unknown): asserts value is BillingTaxIssue | null {
  if (value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("billing_response_invalid");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(",") !== "code,invoice_id,observed_at,required_action" ||
    ![
      "billing_tax_location_required",
      "billing_tax_calculation_failed",
      "billing_tax_configuration_required",
    ].includes(String(v["code"])) ||
    typeof v["invoice_id"] !== "string" ||
    !/^in_[A-Za-z0-9_]{1,253}$/u.test(v["invoice_id"]) ||
    !timestamp(v["observed_at"]) ||
    v["required_action"] !==
      (v["code"] === "billing_tax_location_required" ? "open_billing_portal" : "contact_support")
  )
    throw new Error("billing_response_invalid");
}
const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const timestamp = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function stripeUrl(value: unknown, host: string): value is string {
  if (typeof value !== "string" || value.length > 8192) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === host && !u.username && !u.password && !u.port;
  } catch {
    return false;
  }
}
export function assertBillingCheckout(value: unknown): asserts value is BillingCheckoutView {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("billing_response_invalid");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(",") !==
      "billing_issue,checkout_id,credited_micros,expires_at,offer,organization_id,packs,paid_until,payment_confirmed,required_action,revoked_micros,state,url" ||
    typeof v["organization_id"] !== "string" ||
    !ulid.test(v["organization_id"]) ||
    typeof v["checkout_id"] !== "string" ||
    !ulid.test(v["checkout_id"]) ||
    typeof v["offer"] !== "string" ||
    !["topup", "paid"].includes(v["offer"]) ||
    typeof v["state"] !== "string" ||
    !["open", "complete", "expired"].includes(v["state"]) ||
    typeof v["payment_confirmed"] !== "boolean" ||
    typeof v["required_action"] !== "string" ||
    !["none", "complete_checkout", "open_billing_portal", "contact_support"].includes(
      v["required_action"],
    ) ||
    (v["url"] !== null && !stripeUrl(v["url"], "checkout.stripe.com")) ||
    !timestamp(v["expires_at"]) ||
    (v["paid_until"] !== null && !timestamp(v["paid_until"])) ||
    !Number.isInteger(v["packs"]) ||
    Number(v["packs"]) < 1 ||
    Number(v["packs"]) > 100 ||
    (v["offer"] === "paid" && v["packs"] !== 1) ||
    ![v["credited_micros"], v["revoked_micros"]].every(
      (x) => typeof x === "string" && /^(0|[1-9][0-9]{0,18})$/u.test(x),
    )
  )
    throw new Error("billing_response_invalid");
  assertBillingTaxIssue(v["billing_issue"]);
}
export function assertBillingPortal(value: unknown): asserts value is BillingPortalView {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("billing_response_invalid");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(",") !== "created_at,organization_id,url" ||
    typeof v["organization_id"] !== "string" ||
    !ulid.test(v["organization_id"]) ||
    !timestamp(v["created_at"]) ||
    !stripeUrl(v["url"], "billing.stripe.com")
  )
    throw new Error("billing_response_invalid");
}

export interface RechargeView {
  organization_id: string;
  portal_available: boolean;
  enabled: boolean;
  revision: number;
  status:
    | "off"
    | "setup_required"
    | "on"
    | "payment_required"
    | "monthly_limit"
    | "needs_reconciliation"
    | "tax_required";
  monthly_limit_minor: number;
  spent_minor: number;
  currency: "usd";
  amount_minor: 900;
  credits: 1000;
  threshold_credits: 100;
  setup_url: string | null;
  invoice_url: string | null;
  billing_issue: BillingTaxIssue | null;
}
export function assertRecharge(value: unknown): asserts value is RechargeView {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("billing_response_invalid");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(",") !==
      "amount_minor,billing_issue,credits,currency,enabled,invoice_url,monthly_limit_minor,organization_id,portal_available,revision,setup_url,spent_minor,status,threshold_credits" ||
    typeof v["organization_id"] !== "string" ||
    !ulid.test(v["organization_id"]) ||
    typeof v["portal_available"] !== "boolean" ||
    typeof v["enabled"] !== "boolean" ||
    !Number.isSafeInteger(v["revision"]) ||
    Number(v["revision"]) < 0 ||
    !Number.isSafeInteger(v["monthly_limit_minor"]) ||
    Number(v["monthly_limit_minor"]) < 1000 ||
    Number(v["monthly_limit_minor"]) > 100000 ||
    !Number.isSafeInteger(v["spent_minor"]) ||
    Number(v["spent_minor"]) < 0 ||
    v["currency"] !== "usd" ||
    v["amount_minor"] !== 900 ||
    v["credits"] !== 1000 ||
    v["threshold_credits"] !== 100 ||
    typeof v["status"] !== "string" ||
    ![
      "off",
      "setup_required",
      "on",
      "payment_required",
      "monthly_limit",
      "needs_reconciliation",
      "tax_required",
    ].includes(v["status"]) ||
    (v["setup_url"] !== null && !stripeUrl(v["setup_url"], "checkout.stripe.com")) ||
    (v["invoice_url"] !== null && !stripeUrl(v["invoice_url"], "invoice.stripe.com"))
  )
    throw new Error("billing_response_invalid");
  assertBillingTaxIssue(v["billing_issue"]);
}
