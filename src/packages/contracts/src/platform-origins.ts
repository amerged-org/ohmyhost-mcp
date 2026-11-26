export type SaasCnameTarget = "customers.omh.st" | "customers.ohmyho.st";

export function isSaasCnameTarget(value: unknown): value is SaasCnameTarget {
  return value === "customers.omh.st" || value === "customers.ohmyho.st";
}

export {
  classifyPlatformGatewayHostname,
  createPinnedStorageGatewayOrigin,
  parsePinnedStorageGatewayOrigin,
  type PinnedStorageGatewayOrigin,
  type StorageGatewayOriginScope,
} from "./storage-gateway-origin.js";

export const CLOUDFLARE_DNS_OAUTH_SCOPES = Object.freeze([
  "dns.write",
  "zone.read",
  "offline_access",
] as const);
export const CLOUDFLARE_DNS_CONFIRMATION_PATH = "/v1/cloudflare/oauth/authorize";
export const CLOUDFLARE_DNS_FORWARD_TOKEN =
  /^f1\.([0-7][0-9A-HJKMNP-TV-Z]{25})\.[A-Za-z0-9_-]{43}$/u;
export const CLOUDFLARE_DNS_CONFIRMATION_COOKIE = /^[A-Za-z0-9_-]{43}\.[a-f0-9]{64}$/u;

export function isCloudflareDnsConfirmationUrl(url: URL, authorizationId: string): boolean {
  return (
    (url.origin === "https://app.ohmyho.st" || url.origin === "https://dev.app.ohmyho.st") &&
    !url.username &&
    !url.password &&
    !url.hash &&
    url.pathname === CLOUDFLARE_DNS_CONFIRMATION_PATH &&
    url.searchParams.size === 1 &&
    CLOUDFLARE_DNS_FORWARD_TOKEN.exec(url.searchParams.get("request") ?? "")?.[1] ===
      authorizationId
  );
}

export function isCloudflareProviderAuthorizationUrl(url: URL): boolean {
  return (
    url.origin === "https://dash.cloudflare.com" &&
    !url.username &&
    !url.password &&
    !url.hash &&
    url.pathname === "/oauth2/auth" &&
    url.searchParams.getAll("client_id").length === 1 &&
    url.searchParams.getAll("state").length === 1
  );
}
