/** The platform supplies the project separately through its trusted dispatch context. */
export interface StorageGatewayOriginScope {
  readonly organizationId: string;
  readonly environmentId: string;
  readonly dataEnvironmentId: string;
}
export interface PinnedStorageGatewayOrigin extends StorageGatewayOriginScope {
  readonly baseOrigin: string;
}

const GATEWAY_FAMILY =
  /(?:^|\.)ohmyho-(mail|storage)-gateway-[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*\.workers\.dev\.?$/u;
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const PIN_ORGANIZATION = /^s1-([0-7][0-9a-hjkmnp-tv-z]{25})$/u;
const PIN_ENVIRONMENTS = /^([0-7][0-9a-hjkmnp-tv-z]{25})-([0-7][0-9a-hjkmnp-tv-z]{25})$/u;

/** A malformed prefixed pin is still a platform gateway and must never reach public fetch. */
export function classifyPlatformGatewayHostname(hostname: unknown): "mail" | "storage" | null {
  if (typeof hostname !== "string") return null;
  const family = GATEWAY_FAMILY.exec(hostname)?.[1];
  return family === "mail" || family === "storage" ? family : null;
}

/** Encodes all three immutable data identities using two canonical, bounded DNS labels. */
export function createPinnedStorageGatewayOrigin(baseOrigin: string, scope: unknown): string {
  const base = canonicalOrigin(baseOrigin);
  if (
    base === null ||
    base.hostname.split(".").length !== 4 ||
    classifyPlatformGatewayHostname(base.hostname) !== "storage" ||
    typeof scope !== "object" ||
    scope === null ||
    Array.isArray(scope)
  )
    throw new TypeError("Storage gateway origin scope is invalid");
  const record = scope as Record<string, unknown>;
  const values = [record["organizationId"], record["environmentId"], record["dataEnvironmentId"]];
  if (values.some((value) => typeof value !== "string" || value.length !== 26 || !ULID.test(value)))
    throw new TypeError("Storage gateway origin scope is invalid");
  const [organization, environment, data] = values.map((value) => String(value).toLowerCase());
  const origin = `https://s1-${organization}.${environment}-${data}.${base.hostname}`;
  if (canonicalOrigin(origin) === null) throw new TypeError("Storage gateway origin is too long");
  return origin;
}

/** Decodes only the versioned canonical pin; the trusted caller must bind its base and project. */
export function parsePinnedStorageGatewayOrigin(value: unknown): PinnedStorageGatewayOrigin | null {
  const origin = canonicalOrigin(value);
  if (origin === null) return null;
  const labels = origin.hostname.split(".");
  if (labels.length !== 6) return null;
  const organization = PIN_ORGANIZATION.exec(labels[0] ?? "")?.[1];
  const environments = PIN_ENVIRONMENTS.exec(labels[1] ?? "");
  const environment = environments?.[1];
  const data = environments?.[2];
  const baseHostname = labels.slice(2).join(".");
  if (
    organization === undefined ||
    environment === undefined ||
    data === undefined ||
    classifyPlatformGatewayHostname(baseHostname) !== "storage"
  )
    return null;
  return Object.freeze({
    baseOrigin: `https://${baseHostname}`,
    organizationId: organization.toUpperCase(),
    environmentId: environment.toUpperCase(),
    dataEnvironmentId: data.toUpperCase(),
  });
}

function canonicalOrigin(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.origin === value &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.hostname.length <= 253 &&
      url.hostname
        .split(".")
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
      ? url
      : null;
  } catch {
    return null;
  }
}
