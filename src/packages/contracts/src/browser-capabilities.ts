const RESOURCE_GROUPS = [
  "connect",
  "scripts",
  "styles",
  "images",
  "fonts",
  "frames",
  "frameAncestors",
] as const;
type BrowserResourceGroup = (typeof RESOURCE_GROUPS)[number];

export type BrowserPolicy = Readonly<
  Record<BrowserResourceGroup, readonly string[]> & {
    workers: Readonly<{ self: boolean; blob: boolean }>;
    cors: Readonly<{ origins: readonly string[]; credentials: boolean }>;
  }
>;

const POLICY_KEYS = [...RESOURCE_GROUPS, "workers", "cors"];
const MAX_ORIGINS = 16;

/** Source declarations may omit capabilities; each omission retains the restrictive default. */
export function normalizeBrowserPolicy(value: unknown): BrowserPolicy {
  const input = value === undefined ? {} : policyRecord(value, POLICY_KEYS);
  const workers =
    input["workers"] === undefined ? {} : policyRecord(input["workers"], ["self", "blob"]);
  const cors =
    input["cors"] === undefined ? {} : policyRecord(input["cors"], ["origins", "credentials"]);
  const resources = Object.fromEntries(
    RESOURCE_GROUPS.map((group) => [group, normalizeOrigins(input[group], group === "connect")]),
  ) as Record<BrowserResourceGroup, readonly string[]>;
  return Object.freeze({
    ...resources,
    workers: Object.freeze({
      self: normalizeBoolean(workers["self"]),
      blob: normalizeBoolean(workers["blob"]),
    }),
    cors: Object.freeze({
      origins: normalizeOrigins(cors["origins"], false),
      credentials: normalizeBoolean(cors["credentials"]),
    }),
  });
}

/** Private routing and artifact custody accept the complete normalized policy only. */
export function parseBrowserPolicy(value: unknown): BrowserPolicy {
  const input = policyRecord(value, POLICY_KEYS, true);
  const workers = policyRecord(input["workers"], ["self", "blob"], true);
  const cors = policyRecord(input["cors"], ["origins", "credentials"], true);
  if (
    typeof workers["self"] !== "boolean" ||
    typeof workers["blob"] !== "boolean" ||
    typeof cors["credentials"] !== "boolean"
  )
    throw invalidPolicy();
  const normalized = normalizeBrowserPolicy(input);
  for (const group of RESOURCE_GROUPS) {
    if (!sameOrigins(input[group], normalized[group])) throw invalidPolicy();
  }
  if (!sameOrigins(cors["origins"], normalized.cors.origins)) throw invalidPolicy();
  return normalized;
}

function policyRecord(
  value: unknown,
  keys: readonly string[],
  complete = false,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    (complete && Object.keys(value).length !== keys.length)
  )
    throw invalidPolicy();
  return value as Record<string, unknown>;
}

function normalizeBoolean(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw invalidPolicy();
  return value;
}

function normalizeOrigins(value: unknown, allowWebSocket: boolean): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_ORIGINS) throw invalidPolicy();
  const origins: string[] = [];
  for (const origin of value) {
    if (!browserOrigin(origin, allowWebSocket) || origins.includes(origin)) throw invalidPolicy();
    origins.push(origin);
  }
  return Object.freeze(origins.sort());
}

function browserOrigin(value: unknown, allowWebSocket: boolean): value is string {
  if (typeof value !== "string" || value.length > 256) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || (allowWebSocket && url.protocol === "wss:")) &&
      url.origin === value &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.hostname.includes(".") &&
      !url.hostname.endsWith(".local") &&
      !url.hostname.endsWith(".internal") &&
      !/^\d+(?:\.\d+){3}$/u.test(url.hostname) &&
      url.hostname
        .split(".")
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
    );
  } catch {
    return false;
  }
}

function sameOrigins(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((origin, index) => origin === expected[index])
  );
}

function invalidPolicy(): TypeError {
  return new TypeError("Invalid browser capability policy");
}
