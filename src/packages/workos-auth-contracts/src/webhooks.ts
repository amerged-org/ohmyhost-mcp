import { expectRecord, expectString, parseJsonObject, WorkosContractError } from "./parsing.js";

export interface WorkosWebhookSignature {
  readonly issuedAtMs: number;
  readonly signatures: readonly string[];
}

export interface WorkosWebhookEnvelope {
  readonly id: string;
  readonly event: string;
  readonly createdAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface VerifyWorkosWebhookInput {
  readonly rawBody: Uint8Array;
  readonly signatureHeader: string;
  readonly secret: string;
  readonly now: Date;
  readonly toleranceMs: number;
  readonly maximumBodyBytes: number;
}

export const parseWorkosWebhookSignature = (header: string): WorkosWebhookSignature => {
  let issuedAtMs: number | undefined;
  const signatures: string[] = [];
  for (const rawPart of header.split(",")) {
    const [rawName, rawValue, ...rest] = rawPart.trim().split("=");
    if (rest.length > 0 || rawName === undefined || rawValue === undefined) continue;
    if (rawName === "t") {
      if (issuedAtMs !== undefined || !/^\d+$/u.test(rawValue)) {
        throw new WorkosContractError("invalid_signature_header", "Webhook timestamp is invalid");
      }
      issuedAtMs = Number(rawValue);
    } else if (rawName === "v1" && /^[a-f0-9]{64}$/iu.test(rawValue)) {
      signatures.push(rawValue.toLowerCase());
    }
  }
  if (issuedAtMs === undefined || !Number.isSafeInteger(issuedAtMs) || signatures.length === 0) {
    throw new WorkosContractError(
      "invalid_signature_header",
      "Webhook signature header is invalid",
    );
  }
  return { issuedAtMs, signatures };
};

export const parseWorkosWebhookEnvelope = (value: unknown): WorkosWebhookEnvelope => {
  const input = expectRecord(value, "invalid_webhook_envelope");
  const event = expectString(input["event"], "event");
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u.test(event)) {
    throw new WorkosContractError("invalid_webhook_event", "Webhook event type is invalid");
  }
  const createdAt = expectString(input["created_at"], "created_at");
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new WorkosContractError("invalid_webhook_envelope", "Webhook creation time is invalid");
  }
  return {
    id: expectString(input["id"], "id"),
    event,
    createdAt: new Date(createdAt).toISOString(),
    data: expectRecord(input["data"], "invalid_webhook_data"),
  };
};

export const verifyAndParseWorkosWebhook = async (
  input: VerifyWorkosWebhookInput,
): Promise<WorkosWebhookEnvelope> => {
  if (input.secret.length === 0) {
    throw new WorkosContractError("invalid_webhook_secret", "Webhook secret is invalid");
  }
  if (
    !Number.isSafeInteger(input.maximumBodyBytes) ||
    input.maximumBodyBytes <= 0 ||
    input.rawBody.byteLength > input.maximumBodyBytes
  ) {
    throw new WorkosContractError("webhook_body_too_large", "Webhook body exceeds its limit");
  }
  if (!Number.isSafeInteger(input.toleranceMs) || input.toleranceMs < 0) {
    throw new WorkosContractError("invalid_tolerance", "Webhook tolerance is invalid");
  }
  const signature = parseWorkosWebhookSignature(input.signatureHeader);
  const nowMs = input.now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new WorkosContractError("invalid_clock", "Webhook verification clock is invalid");
  }
  if (Math.abs(nowMs - signature.issuedAtMs) > input.toleranceMs) {
    throw new WorkosContractError(
      "webhook_timestamp_outside_tolerance",
      "Webhook timestamp is stale",
    );
  }
  const prefix = new TextEncoder().encode(`${signature.issuedAtMs}.`);
  const message = new Uint8Array(prefix.byteLength + input.rawBody.byteLength);
  message.set(prefix);
  message.set(input.rawBody, prefix.byteLength);
  const importKey = async () => {
    try {
      return await globalThis.crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(input.secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
    } catch {
      throw new WorkosContractError("invalid_webhook_secret", "Webhook secret is invalid");
    }
  };
  const key = await importKey();
  let valid = false;
  for (const expectedHexDigest of signature.signatures) {
    const expected = Uint8Array.from(expectedHexDigest.match(/.{2}/gu) ?? [], (byte) =>
      Number.parseInt(byte, 16),
    );
    try {
      valid = (await globalThis.crypto.subtle.verify("HMAC", key, expected, message)) || valid;
    } catch {
      // Only a verified signature can change the accumulated result.
    }
  }
  if (!valid)
    throw new WorkosContractError("invalid_webhook_signature", "Webhook signature is invalid");
  return parseWorkosWebhookEnvelope(
    parseJsonObject(new TextDecoder("utf-8", { fatal: true }).decode(input.rawBody)),
  );
};
