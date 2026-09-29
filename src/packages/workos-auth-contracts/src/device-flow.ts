import {
  expectPositiveInteger,
  expectRecord,
  expectString,
  parseJsonObject,
  WorkosContractError,
} from "./parsing.js";

export interface WorkosPublicHttpRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly redirect: "error";
}

export interface WorkosPublicHttpResponse {
  readonly status: number;
  readonly body: string;
}

export interface WorkosPublicTransport {
  send(request: WorkosPublicHttpRequest): Promise<WorkosPublicHttpResponse>;
}

export interface WorkosClock {
  now(): Date;
}

export interface DeviceAuthorization {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete?: string;
  readonly expiresInSeconds: number;
  readonly intervalSeconds: number;
}

export interface DeviceTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: string;
  readonly expiresInSeconds?: number;
  readonly organizationId?: string;
}

export interface WorkosDeviceFlowTokens extends DeviceTokens {
  readonly provenance: {
    readonly kind: "workos_authkit_device_flow";
    readonly clientId: string;
  };
}

export type DevicePollResult =
  | { readonly state: "pending"; readonly nextPollAt: Date }
  | { readonly state: "complete"; readonly tokens: WorkosDeviceFlowTokens };

export const WORKOS_AUTHKIT_DEVICE_AUTHORIZATION_ENDPOINT =
  "https://api.workos.com/user_management/authorize/device";
export const WORKOS_AUTHKIT_DEVICE_TOKEN_ENDPOINT =
  "https://api.workos.com/user_management/authenticate";

const allowedDeviceTokenFields = new Set([
  "access_token",
  "refresh_token",
  "token_type",
  "expires_in",
  "organization_id",
  "authentication_method",
  "user",
]);

const assertSafeVerificationEndpoint = (value: string, field: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WorkosContractError("invalid_endpoint", `${field} must be an absolute HTTPS URL`);
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new WorkosContractError("invalid_endpoint", `${field} must be an absolute HTTPS URL`);
  }
  return url.toString();
};

export const parseDeviceAuthorization = (
  value: unknown,
  expectedVerificationUri: string,
): DeviceAuthorization => {
  const input = expectRecord(value);
  const verificationUri = assertSafeVerificationEndpoint(
    expectString(input["verification_uri"], "verification_uri"),
    "verification_uri",
  );
  const expectedUri = assertSafeVerificationEndpoint(
    expectedVerificationUri,
    "expectedVerificationUri",
  );
  if (verificationUri !== expectedUri) {
    throw new WorkosContractError(
      "unexpected_verification_uri",
      "Device verification URI is not allowed",
    );
  }
  const complete = expectString(input["verification_uri_complete"], "verification_uri_complete", {
    optional: true,
  });
  const userCode = expectString(input["user_code"], "user_code");
  const expectedComplete = `${expectedUri}?user_code=${encodeURIComponent(userCode)}`;
  if (
    complete !== undefined &&
    assertSafeVerificationEndpoint(complete, "verification_uri_complete") !== expectedComplete
  ) {
    throw new WorkosContractError(
      "unexpected_verification_uri",
      "Complete device verification URI is not allowed",
    );
  }
  return {
    deviceCode: expectString(input["device_code"], "device_code"),
    userCode,
    verificationUri,
    ...(complete === undefined ? {} : { verificationUriComplete: complete }),
    expiresInSeconds: expectPositiveInteger(input["expires_in"], "expires_in"),
    intervalSeconds: expectPositiveInteger(input["interval"], "interval", { optional: true }) ?? 5,
  };
};

export const parseDeviceTokens = (value: unknown): DeviceTokens => {
  const input = expectRecord(value);
  for (const field of Object.keys(input)) {
    if (!allowedDeviceTokenFields.has(field)) {
      throw new WorkosContractError(
        "unexpected_device_token_field",
        "Device Flow response contained an unexpected field",
      );
    }
  }
  const expiresIn = expectPositiveInteger(input["expires_in"], "expires_in", { optional: true });
  const organizationId = expectString(input["organization_id"], "organization_id", {
    optional: true,
  });
  return {
    accessToken: expectString(input["access_token"], "access_token"),
    refreshToken: expectString(input["refresh_token"], "refresh_token"),
    tokenType: expectString(input["token_type"], "token_type", { optional: true }) ?? "Bearer",
    ...(expiresIn === undefined ? {} : { expiresInSeconds: expiresIn }),
    ...(organizationId === undefined ? {} : { organizationId }),
  };
};

export interface WorkosDeviceFlowConfig {
  readonly clientId: string;
  readonly verificationUri: string;
  readonly scope?: string;
}

export interface WorkosDeviceFlowSession {
  readonly authorization: DeviceAuthorization;
  poll(): Promise<DevicePollResult>;
}

const readClock = (clock: WorkosClock): number => {
  const now = clock.now().getTime();
  if (!Number.isFinite(now)) {
    throw new WorkosContractError("invalid_clock", "Device Flow clock is invalid");
  }
  return now;
};

export class WorkosDeviceFlowClient {
  public constructor(
    private readonly config: WorkosDeviceFlowConfig,
    private readonly transport: WorkosPublicTransport,
    private readonly clock: WorkosClock,
  ) {
    if (config.clientId.length === 0) {
      throw new WorkosContractError("invalid_client", "Public client ID must not be empty");
    }
  }

  public async authorize(): Promise<WorkosDeviceFlowSession> {
    const body = new URLSearchParams({ client_id: this.config.clientId });
    if (this.config.scope !== undefined) body.set("scope", this.config.scope);
    const response = await this.transport.send({
      url: WORKOS_AUTHKIT_DEVICE_AUTHORIZATION_ENDPOINT,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      redirect: "error",
    });
    if (response.status < 200 || response.status >= 300) {
      throw new WorkosContractError("device_authorization_failed", "Device authorization failed");
    }
    return new DeviceFlowSession(
      parseDeviceAuthorization(parseJsonObject(response.body), this.config.verificationUri),
      this.config.clientId,
      this.transport,
      this.clock,
    );
  }
}

class DeviceFlowSession implements WorkosDeviceFlowSession {
  readonly #expiresAtMs: number;
  #nextPollAtMs: number;
  #intervalSeconds: number;
  #terminal = false;

  public constructor(
    public readonly authorization: DeviceAuthorization,
    private readonly clientId: string,
    private readonly transport: WorkosPublicTransport,
    private readonly clock: WorkosClock,
  ) {
    const startedAt = readClock(clock);
    this.#expiresAtMs = startedAt + authorization.expiresInSeconds * 1_000;
    this.#intervalSeconds = authorization.intervalSeconds;
    this.#nextPollAtMs = startedAt + this.#intervalSeconds * 1_000;
  }

  public async poll(): Promise<DevicePollResult> {
    if (this.#terminal) {
      throw new WorkosContractError("device_flow_complete", "Device authorization is complete");
    }
    const now = readClock(this.clock);
    if (now >= this.#expiresAtMs) {
      this.#terminal = true;
      throw new WorkosContractError("expired_token", "Device authorization expired");
    }
    if (now < this.#nextPollAtMs) {
      throw new WorkosContractError(
        "poll_too_soon",
        "Device authorization polling is too frequent",
      );
    }
    const response = await this.transport.send({
      url: WORKOS_AUTHKIT_DEVICE_TOKEN_ENDPOINT,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        device_code: this.authorization.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }).toString(),
      redirect: "error",
    });
    const payload = parseJsonObject(response.body);
    if (response.status >= 200 && response.status < 300) {
      this.#terminal = true;
      return {
        state: "complete",
        tokens: {
          ...parseDeviceTokens(payload),
          provenance: { kind: "workos_authkit_device_flow", clientId: this.clientId },
        },
      };
    }
    const error = expectString(payload["error"], "error");
    if (error === "authorization_pending" || error === "slow_down") {
      if (error === "slow_down") this.#intervalSeconds += 5;
      this.#nextPollAtMs = now + this.#intervalSeconds * 1_000;
      return { state: "pending", nextPollAt: new Date(this.#nextPollAtMs) };
    }
    this.#terminal = true;
    if (error === "access_denied" || error === "expired_token") {
      throw new WorkosContractError(error, `Device authorization ended: ${error}`);
    }
    throw new WorkosContractError("token_exchange_failed", "Device token exchange failed");
  }
}
