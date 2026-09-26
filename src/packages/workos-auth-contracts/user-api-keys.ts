import { expectRecord, parseIsoDate, WorkosContractError } from "./parsing.js";

export const WORKOS_USER_API_KEY_PATTERN = /^sk_[A-Za-z0-9_-]{20,128}$/u;

export interface WorkosUserApiKeyMetadata {
  readonly id: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly permissions: readonly string[];
  readonly expiresAt: string | null;
}

export interface WorkosUserApiKeyObservationRequest {
  readonly keyId: string;
  readonly userId: string;
  readonly organizationId: string;
}

export function parseWorkosUserApiKeyObservationRequest(
  value: unknown,
): WorkosUserApiKeyObservationRequest {
  const input = expectRecord(value, "invalid_api_key_request");
  if (
    Object.keys(input).sort().join(",") !== "keyId,organizationId,userId" ||
    typeof input["keyId"] !== "string" ||
    !/^api_key_[A-Za-z0-9_]{1,120}$/u.test(input["keyId"]) ||
    typeof input["userId"] !== "string" ||
    !/^user_[A-Za-z0-9_]{1,123}$/u.test(input["userId"]) ||
    typeof input["organizationId"] !== "string" ||
    !/^org_[A-Za-z0-9_]{1,124}$/u.test(input["organizationId"])
  )
    throw new WorkosContractError("invalid_api_key_request", "Invalid API key observation");
  return {
    keyId: input["keyId"],
    userId: input["userId"],
    organizationId: input["organizationId"],
  };
}

export function parseWorkosUserApiKeyRequest(value: unknown): { value: string } {
  const input = expectRecord(value, "invalid_api_key_request");
  if (
    Object.keys(input).join(",") !== "value" ||
    typeof input["value"] !== "string" ||
    !WORKOS_USER_API_KEY_PATTERN.test(input["value"])
  )
    throw new WorkosContractError("invalid_api_key_request", "Invalid API key request");
  return { value: input["value"] };
}

export function parseWorkosUserApiKeyResponse(value: unknown): {
  key: WorkosUserApiKeyMetadata | null;
} {
  const input = expectRecord(value, "invalid_api_key_response");
  if (Object.keys(input).join(",") !== "key")
    throw new WorkosContractError("invalid_api_key_response", "Invalid API key response");
  if (input["key"] === null) return { key: null };
  const key = expectRecord(input["key"], "invalid_api_key_response");
  if (
    Object.keys(key).sort().join(",") !== "expiresAt,id,organizationId,permissions,userId" ||
    typeof key["id"] !== "string" ||
    !/^api_key_[A-Za-z0-9_]{1,120}$/u.test(key["id"]) ||
    typeof key["userId"] !== "string" ||
    !/^user_[A-Za-z0-9_]{1,123}$/u.test(key["userId"]) ||
    typeof key["organizationId"] !== "string" ||
    !/^org_[A-Za-z0-9_]{1,124}$/u.test(key["organizationId"]) ||
    !Array.isArray(key["permissions"]) ||
    key["permissions"].length > 100 ||
    key["permissions"].some(
      (permission: unknown) =>
        typeof permission !== "string" || !/^[a-zA-Z0-9_.*:-]{1,128}$/u.test(permission),
    ) ||
    new Set(key["permissions"]).size !== key["permissions"].length
  )
    throw new WorkosContractError("invalid_api_key_response", "Invalid API key response");
  return {
    key: {
      id: key["id"],
      userId: key["userId"],
      organizationId: key["organizationId"],
      permissions: key["permissions"] as string[],
      expiresAt: key["expiresAt"] === null ? null : parseIsoDate(key["expiresAt"], "expiresAt"),
    },
  };
}
