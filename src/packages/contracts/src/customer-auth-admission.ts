export interface ManagedCustomerAuthCapabilities {
  readonly auth?: Readonly<{ provider: string }>;
  readonly database?: Readonly<{ enabled: boolean }>;
  readonly mail?: Readonly<{ enabled: boolean }>;
}

export function managedCustomerAuthDatabaseMessage(path: string): string {
  return `"${path}" selects the managed Better Auth bridge, which requires the managed PostgreSQL database. Set database.enabled: true with an admitted migrations path, or set auth.provider: none and keep the application-owned authentication configuration. Commit and push the change, then plan the new commit.`;
}

/** Managed auth needs its real database; Mail remains an independent optional capability. */
export function managedCustomerAuthAdmissionIssue(
  capabilities: ManagedCustomerAuthCapabilities | null | undefined,
): Readonly<{
  code: "managed_auth_database_required";
  message: string;
}> | null {
  if (capabilities?.auth?.provider !== "better-auth") {
    return null;
  }
  if (capabilities.database?.enabled !== true) {
    return Object.freeze({
      code: "managed_auth_database_required" as const,
      message: managedCustomerAuthDatabaseMessage("ohmyhost.yaml"),
    });
  }
  return null;
}
