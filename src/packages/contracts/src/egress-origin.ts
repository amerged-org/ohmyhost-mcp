// Self-contained on purpose: the build sandbox loads this file directly, so it imports nothing.

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
// Local names never resolve in the platform's network: mDNS (.local, .localdomain), home and office networks (.lan,
// .home.arpa, .corp) and internal zones (.internal, localhost). An IP literal is never a routed DNS name.
const LOCAL_NAME = /(?:^|\.)(?:local|localhost|localdomain|internal|lan|home\.arpa|corp)$/u;
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/u;
// The platform supplies the mail, storage and connection origins. Customers never declare them.
const PLATFORM_GATEWAY_NAME =
  /(?:^|\.)ohmyho-(?:mail|storage)-gateway-[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*\.workers\.dev$/u;

/**
 * The one DNS rule for an egress origin, shared by every validator that accepts one: `https://` with no port, path,
 * credentials or other parts, and a hostname of at most 253 characters with at least one dot whose labels are 1 to 63
 * lowercase letters, digits or hyphens that start and end with a letter or digit. Local names and IP literals are refused.
 * Platform-injected origins pass here; customer-authored ones must also pass `isCustomerEgressOrigin`.
 */
export function isDnsEgressOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const { hostname } = url;
  return (
    url.protocol === "https:" &&
    url.origin === value &&
    url.port === "" &&
    hostname.length <= 253 &&
    hostname.includes(".") &&
    hostname.split(".").every((label) => DNS_LABEL.test(label)) &&
    !LOCAL_NAME.test(hostname) &&
    !IPV4_LITERAL.test(hostname)
  );
}

/** A customer-authored egress origin: the DNS rule, and never a platform or Cloudflare API host. */
export function isCustomerEgressOrigin(value: unknown): value is string {
  if (!isDnsEgressOrigin(value)) return false;
  const { hostname } = new URL(value);
  return (
    !PLATFORM_GATEWAY_NAME.test(hostname) &&
    hostname !== "ohmyho.st" &&
    !hostname.endsWith(".ohmyho.st") &&
    hostname !== "omh.st" &&
    !hostname.endsWith(".omh.st") &&
    hostname !== "api.cloudflare.com"
  );
}
