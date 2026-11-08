/** Credential-free public contracts for temporary previews of saved Git commits. */
export const PREVIEW_MAX_LIFETIME_MILLISECONDS = 60 * 60_000;
export const PREVIEW_IDLE_MILLISECONDS = 5 * 60_000;

export type PreviewDataEnvironment = "dev" | "prod";
export type PreviewStatus =
  | "queued"
  | "starting"
  | "ready"
  | "sleeping"
  | "failed"
  | "stopped"
  | "expired"
  | "superseded";

export interface PreviewCreateRequest {
  readonly commit_sha: string;
  /** Paid may select Dev or Prod. Free can select only Prod. Omission follows the current tier. */
  readonly data_environment?: PreviewDataEnvironment;
}

export interface PreviewComputeQuote {
  readonly rate_card_id: "cloudflare-preview-2026-11-06-v1";
  readonly meter: "preview.container.basic" | "preview.container.standard-1";
  readonly unit: "usd_pico";
  readonly reserved_seconds: 60;
  /** Microcredits held for one runtime interval; unused credit is released. */
  readonly credit_micros: string;
  readonly memory_mib: 1024 | 4096;
  readonly vcpus: 0.25 | 0.5;
  readonly disk_gb: 4 | 8;
}

export interface Preview {
  readonly preview_id: string;
  readonly project_id: string;
  readonly commit_sha: string;
  readonly data_environment: PreviewDataEnvironment;
  readonly status: PreviewStatus;
  readonly created_at: string;
  readonly expires_at: string;
  /** A working preview URL is advertised only after the runtime has confirmed readiness. */
  readonly url: string | null;
  readonly instance_type: "basic" | "standard-1";
  readonly compute_quote: PreviewComputeQuote;
  readonly shared_data: boolean;
  readonly failure_code: string | null;
}
export interface PreviewPage {
  readonly previews: readonly Preview[];
}

export function parsePreviewCreateRequest(value: unknown): PreviewCreateRequest {
  const body = record(value);
  exact(body, ["commit_sha", ...("data_environment" in body ? ["data_environment"] : [])]);
  if (!commit(body["commit_sha"])) invalid();
  if (
    "data_environment" in body &&
    body["data_environment"] !== "dev" &&
    body["data_environment"] !== "prod"
  )
    invalid();
  return body as unknown as PreviewCreateRequest;
}

export function assertPreview(value: unknown): asserts value is Preview {
  const body = record(value);
  exact(body, [
    "preview_id",
    "project_id",
    "commit_sha",
    "data_environment",
    "status",
    "created_at",
    "expires_at",
    "url",
    "instance_type",
    "compute_quote",
    "shared_data",
    "failure_code",
  ]);
  const created = instant(body["created_at"]),
    expires = instant(body["expires_at"]);
  if (
    !ulid(body["preview_id"]) ||
    !ulid(body["project_id"]) ||
    !commit(body["commit_sha"]) ||
    (body["data_environment"] !== "dev" && body["data_environment"] !== "prod") ||
    ![
      "queued",
      "starting",
      "ready",
      "sleeping",
      "failed",
      "stopped",
      "expired",
      "superseded",
    ].includes(String(body["status"])) ||
    expires <= created ||
    expires - created > PREVIEW_MAX_LIFETIME_MILLISECONDS ||
    (body["instance_type"] !== "basic" && body["instance_type"] !== "standard-1") ||
    typeof body["shared_data"] !== "boolean" ||
    (body["failure_code"] !== null &&
      (typeof body["failure_code"] !== "string" ||
        !/^(?:[a-z][a-z0-9_]{0,99}|[A-Z][A-Z0-9_]{0,99})$/u.test(body["failure_code"])))
  )
    invalid();
  const quote = record(body["compute_quote"]);
  exact(quote, [
    "rate_card_id",
    "meter",
    "unit",
    "reserved_seconds",
    "credit_micros",
    "memory_mib",
    "vcpus",
    "disk_gb",
  ]);
  const basic = body["instance_type"] === "basic";
  if (
    quote["rate_card_id"] !== "cloudflare-preview-2026-11-06-v1" ||
    quote["meter"] !== `preview.container.${String(body["instance_type"])}` ||
    quote["unit"] !== "usd_pico" ||
    quote["reserved_seconds"] !== 60 ||
    typeof quote["credit_micros"] !== "string" ||
    !/^[1-9][0-9]{0,15}$/u.test(quote["credit_micros"]) ||
    !Number.isSafeInteger(Number(quote["credit_micros"])) ||
    quote["memory_mib"] !== (basic ? 1024 : 4096) ||
    quote["vcpus"] !== (basic ? 0.25 : 0.5) ||
    quote["disk_gb"] !== (basic ? 4 : 8)
  )
    invalid();
  const usable = body["status"] === "ready" || body["status"] === "sleeping";
  if (body["url"] === null) {
    if (usable) invalid();
  } else {
    if (!usable || typeof body["url"] !== "string") invalid();
    let url: URL;
    try {
      url = new URL(body["url"]);
    } catch {
      invalid();
    }
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "")
      invalid();
  }
}

export function assertPreviewPage(value: unknown): asserts value is PreviewPage {
  const body = record(value);
  exact(body, ["previews"]);
  if (!Array.isArray(body["previews"]) || body["previews"].length > 100) invalid();
  for (const entry of body["previews"]) assertPreview(entry);
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) invalid();
}
function ulid(value: unknown): value is string {
  return typeof value === "string" && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(value);
}
function commit(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}
function instant(value: unknown): number {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    invalid();
  return Date.parse(value);
}
function invalid(): never {
  throw new TypeError("Preview contract is invalid");
}
