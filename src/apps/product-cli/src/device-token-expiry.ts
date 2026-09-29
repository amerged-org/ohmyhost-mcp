export class DeviceTokenExpiryError extends Error {
  public constructor() {
    super("The Device Flow token expiry is invalid.");
    this.name = "DeviceTokenExpiryError";
  }
}

const invalidExpiry = (): DeviceTokenExpiryError => new DeviceTokenExpiryError();

const decodeBase64Url = (value: string): Uint8Array => {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    throw invalidExpiry();
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw invalidExpiry();
  }
  const canonical = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  if (canonical !== value) throw invalidExpiry();
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const parseJsonSegment = (value: string): Readonly<Record<string, unknown>> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64Url(value)));
  } catch {
    throw invalidExpiry();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalidExpiry();
  }
  return parsed as Readonly<Record<string, unknown>>;
};

const readJwtExpirySeconds = (accessToken: string): number => {
  const segments = accessToken.split(".");
  if (segments.length !== 3) throw invalidExpiry();
  const [header, payload, signature] = segments;
  if (header === undefined || payload === undefined || signature === undefined) {
    throw invalidExpiry();
  }
  parseJsonSegment(header);
  decodeBase64Url(signature);
  const claims = parseJsonSegment(payload);
  const expiry = claims["exp"];
  if (
    !Object.hasOwn(claims, "exp") ||
    typeof expiry !== "number" ||
    !Number.isSafeInteger(expiry) ||
    expiry <= 0 ||
    expiry > 8_640_000_000_000
  ) {
    throw invalidExpiry();
  }
  return expiry;
};

export const resolveDeviceTokenExpiresAt = (
  accessToken: string,
  expiresInSeconds: number | undefined,
  now: Date,
): string => {
  const nowMilliseconds = now.getTime();
  if (!Number.isFinite(nowMilliseconds)) throw invalidExpiry();

  const jwtExpirySeconds = readJwtExpirySeconds(accessToken);
  const jwtExpiryMilliseconds = jwtExpirySeconds * 1_000;
  if (!Number.isSafeInteger(jwtExpiryMilliseconds) || jwtExpiryMilliseconds <= nowMilliseconds) {
    throw invalidExpiry();
  }

  if (expiresInSeconds !== undefined) {
    if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0) throw invalidExpiry();
    const relativeExpirySeconds = Math.floor(nowMilliseconds / 1_000) + expiresInSeconds;
    if (
      !Number.isSafeInteger(relativeExpirySeconds) ||
      relativeExpirySeconds !== jwtExpirySeconds
    ) {
      throw invalidExpiry();
    }
  }

  return new Date(jwtExpiryMilliseconds).toISOString();
};
