import * as sdk from "@ohmyhost/sdk-ts";

type Scope = { readonly projectId: string; readonly environmentId: string };
type Write = { readonly idempotencyKey: string };
export type NativeAuthCommand = Scope &
  (
    | { action: "config_get" }
    | (Write & {
        action: "config_set";
        configurationRevision: number;
        enabled: boolean;
        signupPolicy: "open" | "invite-only";
        applicationName: string;
        canonicalOrigin?: string | null;
        allowedRedirectPaths?: readonly string[];
        resetPasswordPath?: string;
        invitationPath?: string;
      })
    | { action: "provider_get"; provider: "google" | "github" }
    | (Write & {
        action: "provider_set";
        provider: "google" | "github";
        configurationRevision: number;
        enabled: boolean;
        clientId?: string;
        clientSecret?: string;
      })
    | { action: "users_list"; limit?: number; cursor?: string; search?: string }
    | (Write & { action: "user_create"; email: string })
    | { action: "user_get"; userId: string }
    | (Write & {
        action:
          | "user_delete"
          | "user_invite"
          | "user_suspend"
          | "user_reactivate"
          | "user_revoke_sessions";
        userId: string;
      })
  );

/** All local clients use the generated SDK and never return provider input secrets. */
export async function executeNativeAuth(
  client: sdk.OhMyHostClient,
  command: NativeAuthCommand,
): Promise<unknown> {
  const scope = { project_id: command.projectId, environment_id: command.environmentId };
  const options = { client };
  switch (command.action) {
    case "config_get":
      return sdk.getNativeAuthConfiguration(scope, options);
    case "config_set":
      return sdk.updateNativeAuthConfiguration(
        {
          ...scope,
          "Idempotency-Key": command.idempotencyKey,
          nativeAuthConfigurationUpdate: {
            configurationRevision: command.configurationRevision,
            enabled: command.enabled,
            signupPolicy: command.signupPolicy,
            applicationName: command.applicationName,
            ...(command.canonicalOrigin === undefined
              ? {}
              : { canonicalOrigin: command.canonicalOrigin }),
            ...(command.allowedRedirectPaths === undefined
              ? {}
              : { allowedRedirectPaths: [...command.allowedRedirectPaths] }),
            ...(command.resetPasswordPath === undefined
              ? {}
              : { resetPasswordPath: command.resetPasswordPath }),
            ...(command.invitationPath === undefined
              ? {}
              : { invitationPath: command.invitationPath }),
          },
        },
        options,
      );
    case "provider_get": {
      const result = await sdk.getNativeAuthProvider(
        { ...scope, provider: command.provider },
        options,
      );
      return providerStatus(result);
    }
    case "provider_set": {
      const result = await sdk.updateNativeAuthProvider(
        {
          ...scope,
          provider: command.provider,
          "Idempotency-Key": command.idempotencyKey,
          nativeAuthProviderUpdateWritable: {
            configurationRevision: command.configurationRevision,
            enabled: command.enabled,
            ...(command.clientId === undefined ? {} : { clientId: command.clientId }),
            ...(command.clientSecret === undefined ? {} : { clientSecret: command.clientSecret }),
          },
        },
        options,
      );
      return providerStatus(result);
    }
    case "users_list":
      return sdk.listNativeAuthUsers(
        {
          ...scope,
          ...(command.limit === undefined ? {} : { limit: command.limit }),
          ...(command.cursor === undefined ? {} : { cursor: command.cursor }),
          ...(command.search === undefined ? {} : { search: command.search }),
        },
        options,
      );
    case "user_create":
      return sdk.createNativeAuthUser(
        {
          ...scope,
          "Idempotency-Key": command.idempotencyKey,
          nativeAuthUserCreate: { email: command.email },
        },
        options,
      );
    case "user_get":
      return sdk.getNativeAuthUser({ ...scope, user_id: command.userId }, options);
    case "user_delete":
      return sdk.deleteNativeAuthUser(
        { ...scope, user_id: command.userId, "Idempotency-Key": command.idempotencyKey },
        options,
      );
    case "user_invite":
      return sdk.resendNativeAuthInvitation(
        { ...scope, user_id: command.userId, "Idempotency-Key": command.idempotencyKey },
        options,
      );
    case "user_suspend":
      return sdk.suspendNativeAuthUser(
        { ...scope, user_id: command.userId, "Idempotency-Key": command.idempotencyKey },
        options,
      );
    case "user_reactivate":
      return sdk.reactivateNativeAuthUser(
        { ...scope, user_id: command.userId, "Idempotency-Key": command.idempotencyKey },
        options,
      );
    case "user_revoke_sessions":
      return sdk.revokeNativeAuthUserSessions(
        { ...scope, user_id: command.userId, "Idempotency-Key": command.idempotencyKey },
        options,
      );
  }
}

function providerStatus(result: sdk.NativeAuthProviderStatus): sdk.NativeAuthProviderStatus {
  const {
    provider,
    enabled,
    configured,
    clientId,
    secretPresent,
    callbackUrl,
    scopes,
    lastSuccessfulFlowAt,
  } = result;
  return {
    provider,
    enabled,
    configured,
    clientId,
    secretPresent,
    callbackUrl,
    scopes,
    lastSuccessfulFlowAt,
  };
}
