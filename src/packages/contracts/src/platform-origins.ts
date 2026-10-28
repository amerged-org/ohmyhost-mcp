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
