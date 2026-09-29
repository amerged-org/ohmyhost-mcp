import {
  expectPositiveInteger,
  expectRecord,
  expectString,
  WorkosContractError,
} from "./parsing.js";

export interface WorkosSessionStatusRequest {
  readonly sessionId: string;
  readonly userId: string;
  readonly organizationId: string | null;
  readonly tokenExpiresAt: number;
}

export interface WorkosSessionStatusResponse {
  readonly active: boolean;
}

const assertOnlyKeys = (input: Record<string, unknown>, allowed: readonly string[]): void => {
  const allowedKeys = new Set(allowed);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new WorkosContractError(
      "session_status_field_not_allowed",
      "Session-status field is not allowed",
    );
  }
};

export const parseWorkosSessionStatusRequest = (value: unknown): WorkosSessionStatusRequest => {
  const input = expectRecord(value, "invalid_session_status_request");
  assertOnlyKeys(input, ["sessionId", "userId", "organizationId", "tokenExpiresAt"]);
  return {
    sessionId: expectString(input["sessionId"], "sessionId"),
    userId: expectString(input["userId"], "userId"),
    organizationId:
      input["organizationId"] === null
        ? null
        : expectString(input["organizationId"], "organizationId"),
    tokenExpiresAt: expectPositiveInteger(input["tokenExpiresAt"], "tokenExpiresAt"),
  };
};

export const parseWorkosSessionStatusResponse = (value: unknown): WorkosSessionStatusResponse => {
  const input = expectRecord(value, "invalid_session_status_response");
  assertOnlyKeys(input, ["active"]);
  if (typeof input["active"] !== "boolean") {
    throw new WorkosContractError(
      "invalid_session_status_response",
      "Session-status active field must be a boolean",
    );
  }
  return { active: input["active"] };
};
