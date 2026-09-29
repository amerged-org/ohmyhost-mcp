import {
  expectPositiveInteger,
  expectRecord,
  expectString,
  WorkosContractError,
} from "./parsing.js";

export interface WorkosJwtHeader {
  readonly alg: "RS256";
  readonly kid: string;
  readonly typ?: string;
}

export interface WorkosSessionClaims {
  readonly kind: "session";
  readonly issuer: string;
  readonly subject: string;
  readonly clientId: string;
  readonly expiresAt: number;
  readonly issuedAt: number;
  readonly notBefore?: number;
  readonly organizationId?: string;
  readonly sessionId?: string;
  readonly role?: string;
  readonly permissions: readonly string[];
}

export interface WorkosM2mClaims {
  readonly kind: "m2m";
  readonly issuer: string;
  readonly audience: readonly string[];
  readonly subject: string;
  readonly clientId: string;
  readonly organizationId: string;
  readonly expiresAt: number;
  readonly issuedAt: number;
  readonly notBefore?: number;
  readonly sessionId?: string;
  readonly tokenId?: string;
  readonly scopes: readonly string[];
}

export type WorkosTokenClaims = WorkosSessionClaims | WorkosM2mClaims;

export interface WorkosRsaJwk {
  readonly kty: "RSA";
  readonly kid: string;
  readonly alg: "RS256";
  readonly use: "sig";
  readonly n: string;
  readonly e: string;
}

const parseAudience = (value: unknown): readonly string[] => {
  if (typeof value === "string" && value.length > 0) return [value];
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    return [...new Set(value)];
  }
  throw new WorkosContractError("invalid_claim", "Token audience is invalid");
};

const parseScopes = (value: unknown): readonly string[] => {
  if (value === undefined) return [];
  if (typeof value === "string") return [...new Set(value.split(" ").filter(Boolean))].sort();
  if (
    Array.isArray(value) &&
    value.every((scope) => typeof scope === "string" && scope.length > 0)
  ) {
    return [...new Set(value)].sort();
  }
  throw new WorkosContractError("invalid_claim", "Token scopes are invalid");
};

const parseEpoch = (value: unknown, field: string): number => expectPositiveInteger(value, field);

const decodeCanonicalBase64Url = (value: unknown, field: string): Uint8Array => {
  const encoded = expectString(value, field);
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length % 4 === 1) {
    throw new WorkosContractError("invalid_jwk", `JWK field ${field} is invalid`);
  }
  try {
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const binary = globalThis.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const canonical = globalThis
      .btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    if (canonical !== encoded) throw new Error("Non-canonical base64url");
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new WorkosContractError("invalid_jwk", `JWK field ${field} is invalid`);
  }
};

const validateRsaMaterial = (modulus: unknown, exponent: unknown) => {
  const n = decodeCanonicalBase64Url(modulus, "n");
  const e = decodeCanonicalBase64Url(exponent, "e");
  if (
    n.length < 256 ||
    (n.length === 256 && (n[0] ?? 0) < 0x80) ||
    ((n[n.length - 1] ?? 0) & 1) === 0
  ) {
    throw new WorkosContractError("invalid_jwk", "JWK RSA modulus is too short");
  }
  if (e.length === 0 || e.length > 4) {
    throw new WorkosContractError("invalid_jwk", "JWK RSA exponent is invalid");
  }
  const exponentValue = e.reduce((value, byte) => value * 256 + byte, 0);
  if (!Number.isSafeInteger(exponentValue) || exponentValue < 3 || exponentValue % 2 === 0) {
    throw new WorkosContractError("invalid_jwk", "JWK RSA exponent is invalid");
  }
};

export const parseWorkosJwtHeader = (value: unknown): WorkosJwtHeader => {
  const input = expectRecord(value, "invalid_jwt_header");
  if (input["alg"] !== "RS256") {
    throw new WorkosContractError("unsupported_algorithm", "Token algorithm is not allowed");
  }
  const typ = expectString(input["typ"], "typ", { optional: true });
  return {
    alg: "RS256",
    kid: expectString(input["kid"], "kid"),
    ...(typ === undefined ? {} : { typ }),
  };
};

export const parseWorkosTokenClaims = (
  value: unknown,
  kind: "session" | "m2m",
): WorkosTokenClaims => {
  const input = expectRecord(value, "invalid_jwt_claims");
  const common = {
    issuer: expectString(input["iss"], "iss"),
    subject: expectString(input["sub"], "sub"),
    expiresAt: parseEpoch(input["exp"], "exp"),
    issuedAt: parseEpoch(input["iat"], "iat"),
  };
  const notBefore = input["nbf"] === undefined ? undefined : parseEpoch(input["nbf"], "nbf");
  if (kind === "m2m") {
    if (!common.subject.startsWith("client_")) {
      throw new WorkosContractError(
        "invalid_principal_kind",
        "Connect M2M token subject must identify a client",
      );
    }
    const organizationId = expectString(input["org_id"], "org_id");
    const sessionId = expectString(input["sid"], "sid", { optional: true });
    const tokenId = expectString(input["jti"], "jti", { optional: true });
    return {
      kind,
      ...common,
      audience: parseAudience(input["aud"]),
      clientId: common.subject,
      organizationId,
      ...(notBefore === undefined ? {} : { notBefore }),
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(tokenId === undefined ? {} : { tokenId }),
      scopes: parseScopes(input["scope"]),
    };
  }
  if (!common.subject.startsWith("user_")) {
    throw new WorkosContractError(
      "invalid_principal_kind",
      "Session token subject must identify a user",
    );
  }
  const clientId = expectString(input["client_id"], "client_id");
  const organizationId = expectString(input["org_id"], "org_id", {
    optional: true,
  });
  const sessionId = expectString(input["sid"], "sid", { optional: true });
  const role = expectString(input["role"], "role", { optional: true });
  const permissions = parseScopes(input["permissions"]);
  return {
    kind,
    ...common,
    ...(notBefore === undefined ? {} : { notBefore }),
    clientId,
    ...(organizationId === undefined ? {} : { organizationId }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(role === undefined ? {} : { role }),
    permissions,
  };
};

export const parseWorkosJwks = (value: unknown): readonly WorkosRsaJwk[] => {
  const input = expectRecord(value, "invalid_jwks");
  if (!Array.isArray(input["keys"]) || input["keys"].length === 0) {
    throw new WorkosContractError("invalid_jwks", "JWKS must contain signing keys");
  }
  const seen = new Set<string>();
  return input["keys"].map((candidate) => {
    const key = expectRecord(candidate, "invalid_jwk");
    if (key["kty"] !== "RSA" || key["alg"] !== "RS256" || key["use"] !== "sig") {
      throw new WorkosContractError("invalid_jwk", "JWKS contains an unsupported signing key");
    }
    const kid = expectString(key["kid"], "kid");
    if (seen.has(kid))
      throw new WorkosContractError("duplicate_jwk", "JWKS key IDs must be unique");
    seen.add(kid);
    validateRsaMaterial(key["n"], key["e"]);
    return {
      kty: "RSA",
      kid,
      alg: "RS256",
      use: "sig",
      n: expectString(key["n"], "n"),
      e: expectString(key["e"], "e"),
    };
  });
};
