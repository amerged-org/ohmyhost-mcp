/** Stable contracts shared by Native Auth's trusted platform boundaries. */
export const NATIVE_AUTH_BASE_PATH = "/api/auth/v1" as const;
export const NATIVE_AUTH_BINDING_NAME = "OHMYHOST_AUTH" as const;
export const NATIVE_AUTH_REQUEST_DEADLINE_MS = 15_000;
/** Immutable platform-owned Native schema cohort; a changed schema requires a new migration. */
export const NATIVE_AUTH_SCHEMA_V1_SHA256 = // gitleaks:allow -- public migration digest
  "65446cd8208df79d09d44513b8a22495c4b6b26012b1be6d21920037629bd147" as const;
export const NATIVE_AUTH_SCHEMA_V2_SHA256 = // gitleaks:allow -- public migration digest
  "dc432e4f593dffff9c7549ef00956a91d6270678d6af34a32b7344164ebd2f71" as const;
export const NATIVE_AUTH_SCHEMA_MIGRATION_VERSION = 3 as const;
export const NATIVE_AUTH_SCHEMA_MIGRATION_SHA256 =
  "799e3678b725c268176abc97e61ca796ff98c3ab32f2cfb119994aa9e35d3eeb" as const;
export const NATIVE_AUTH_DEFAULT_REDIRECT_PATHS = Object.freeze([
  "/",
  "/login",
  "/reset-password",
  "/accept-invitation",
] as const);

/** Canonical local application path, with no escapes or ambiguous path segments. */
export function isNativeAuthRedirectPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 256 &&
    /^\/[A-Za-z0-9/_~.-]*$/u.test(value) &&
    !value.includes("//") &&
    !value.split("/").some((segment) => segment === "." || segment === "..")
  );
}

export type NativeAuthProvider = "google" | "github";
export type NativeAuthSignupPolicy = "open" | "invite-only";
export type NativeAuthUserStatus = "pending" | "active" | "suspended";

/** Derived from trusted routing, never from a browser-provided project or origin. */
export interface NativeAuthRealmContext {
  readonly projectId: string;
  readonly environmentId: string;
  readonly canonicalOrigin: string;
  readonly realmGeneration: number;
  readonly configurationRevision: number;
}

export interface NativeAuthSession {
  readonly user: Readonly<{ id: string; email: string }>;
  readonly session: Readonly<{ id: string; expiresAt: string }>;
}

/** Authenticated browser self projection; independent Native mailbox proof owns recovery. */
export interface NativeAuthSelfSession extends NativeAuthSession {
  readonly user: Readonly<{ id: string; email: string; recoveryAvailable: boolean }>;
}

/** A private read-only binding. Store or admission failures reject instead of returning null. */
export interface NativeAuthBinding {
  validateSession(
    input: Readonly<{
      cookie: string;
    }>,
  ): Promise<NativeAuthSession | null>;
}

export interface NativeAuthProviderStatus {
  readonly provider: NativeAuthProvider;
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly clientId: string | null;
  readonly secretPresent: boolean;
  readonly callbackUrl: string | null;
  readonly scopes: readonly string[];
  readonly lastSuccessfulFlowAt: string | null;
}

/** Secret is input-only and must never be included in status or replay receipts. */
export interface NativeAuthProviderUpdate {
  readonly configurationRevision: number;
  readonly enabled: boolean;
  readonly clientId?: string;
  readonly clientSecret?: string;
}

export interface NativeAuthConfiguration {
  readonly enabled: boolean;
  readonly configurationRevision: number;
  readonly revocationEpoch: number;
  readonly signupPolicy: NativeAuthSignupPolicy;
  readonly canonicalOrigin: string | null;
  readonly applicationName: string;
  readonly allowedRedirectPaths: readonly string[];
  readonly resetPasswordPath: string;
  readonly invitationPath: string;
  readonly readiness: Readonly<{
    paid: boolean;
    sender: boolean;
    origin: boolean;
    storage: boolean;
  }>;
}

export interface NativeAuthConfigurationUpdate {
  readonly configurationRevision: number;
  readonly enabled: boolean;
  readonly signupPolicy: NativeAuthSignupPolicy;
  readonly applicationName: string;
  readonly canonicalOrigin?: string | null;
  readonly allowedRedirectPaths?: readonly string[];
  readonly resetPasswordPath?: string;
  readonly invitationPath?: string;
}

export interface NativeAuthUser {
  readonly id: string;
  readonly email: string;
  readonly status: NativeAuthUserStatus;
  readonly recoveryAvailable: boolean;
  readonly createdAt: string;
}

export interface NativeAuthUserCreate {
  readonly email: string;
}

export interface NativeAuthUserPage {
  readonly items: readonly NativeAuthUser[];
  readonly nextCursor: string | null;
}

/** Exact browser-facing methods and paths; no engine admin or token APIs are reachable. */
const PUBLIC_ROUTES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  GET: Object.freeze([
    "/get-session",
    "/verify-email",
    "/callback/google",
    "/callback/github",
    "/list-accounts",
  ]),
  POST: Object.freeze([
    "/sign-up/email",
    "/sign-in/email",
    "/sign-in/social",
    "/sign-out",
    "/request-password-reset",
    "/reset-password",
    "/change-password",
    "/send-verification-email",
    "/link-social",
    "/unlink-account",
    "/accept-invitation",
    "/reauthenticate",
    "/enroll-recovery",
  ]),
});

export function isNativeAuthPublicRoute(method: string, pathname: string): boolean {
  if (!pathname.startsWith(`${NATIVE_AUTH_BASE_PATH}/`)) return false;
  if (!Object.hasOwn(PUBLIC_ROUTES, method)) return false;
  return PUBLIC_ROUTES[method]?.includes(pathname.slice(NATIVE_AUTH_BASE_PATH.length)) === true;
}
