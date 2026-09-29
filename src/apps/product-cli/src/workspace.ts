import type { TokenRefresher } from "./cli.js";
import type { CredentialStore, StoredCredential } from "./credential-store.js";
import type { LocalProfile, ProfileRegistry } from "./profile-store.js";
import { parseCurrentIdentity, type PublicWorkspace } from "./runtime-contract.js";

/** The saved login a workspace selection works on; absent for a user API token. */
export interface WorkspaceSession {
  readonly store: CredentialStore;
  readonly refresher: TokenRefresher;
  readonly profiles: ProfileRegistry;
  readonly profile: LocalProfile;
}

/** A user API token carries a fixed scope and can never select another workspace. */
export class InteractiveSessionRequiredError extends Error {
  public constructor() {
    super("Workspace selection requires an interactive login");
    this.name = "InteractiveSessionRequiredError";
  }
}

/**
 * A saved login keeps the organization it was signed in to. Another organization is its own login,
 * so switching one login between organizations can never retarget another agent's work.
 */
export class ProfileOrganizationFixedError extends Error {
  public constructor(
    readonly profile: LocalProfile,
    readonly organization: { readonly id: string },
  ) {
    super("The saved login is bound to another organization");
    this.name = "ProfileOrganizationFixedError";
  }
}

/** The provider answered with an identity other than the one that was requested. */
export class AccountVerificationError extends Error {
  public constructor() {
    super("The signed-in account does not match the requested one");
    this.name = "AccountVerificationError";
  }
}

export type WorkspaceSelection =
  | { readonly outcome: "selected"; readonly organization: PublicWorkspace }
  | { readonly outcome: "no_workspace" }
  | { readonly outcome: "choice_required"; readonly organizations: readonly PublicWorkspace[] }
  | { readonly outcome: "not_a_member"; readonly organizations: readonly PublicWorkspace[] };

/**
 * Decide which workspace a login or creation should select. A caller that named one gets exactly
 * that one or nothing; an unnamed choice is only made when the answer cannot be wrong.
 */
export const chooseWorkspace = (
  organizations: readonly PublicWorkspace[],
  requested: string | undefined,
): WorkspaceSelection => {
  if (requested !== undefined) {
    const match = organizations.find((organization) => organization.id === requested);
    return match === undefined
      ? { outcome: "not_a_member", organizations }
      : { outcome: "selected", organization: match };
  }
  if (organizations.length === 0) return { outcome: "no_workspace" };
  const only = organizations[0];
  if (organizations.length === 1 && only !== undefined)
    return { outcome: "selected", organization: only };
  return { outcome: "choice_required", organizations };
};

/** The user a verified identity answer names; only interactive users and their keys have one. */
export const verifiedUserId = (identity: unknown): string => {
  const actor = parseCurrentIdentity(identity).actor_id;
  if (!actor.startsWith("user:") || actor.length === 5) throw new AccountVerificationError();
  return actor.slice(5);
};

/**
 * Check that a token belongs to the expected user and organization before anything is stored.
 * A null organization means the token must not carry one.
 */
export const assertVerifiedLogin = (
  identity: unknown,
  userId: string,
  organizationId: string | null,
): void => {
  const organizations = parseCurrentIdentity(identity).organization_ids;
  if (
    verifiedUserId(identity) !== userId ||
    (organizationId === null
      ? organizations.length !== 0
      : organizations.length !== 1 || organizations[0] !== organizationId)
  )
    throw new AccountVerificationError();
};

/**
 * Bind a saved login that has no organization yet to one of its user's organizations. The provider
 * scopes the session to that organization and the result is verified before it replaces the login.
 */
export const selectWorkspace = async (
  session: WorkspaceSession,
  organization: PublicWorkspace,
  signal: AbortSignal,
  identity: (accessToken: string) => Promise<unknown>,
): Promise<LocalProfile> => {
  if (session.profile.organizationId === organization.id) return session.profile;
  if (session.profile.organizationId !== null)
    throw new ProfileOrganizationFixedError(session.profile, organization);
  const stored = await session.store.read();
  if (stored === undefined) throw new InteractiveSessionRequiredError();
  const refreshed = await session.refresher.refresh(
    stored.refreshToken,
    signal,
    organization.workos_id,
  );
  assertVerifiedLogin(
    await identity(refreshed.accessToken),
    session.profile.userId,
    organization.id,
  );
  // That user's existing login in the organization keeps its name; binding under this login's alias
  // would silently rename it for every agent that selects it by name.
  const existing = (await session.profiles.list()).find(
    (saved) => saved.userId === session.profile.userId && saved.organizationId === organization.id,
  );
  const bound: LocalProfile = {
    ...session.profile,
    name: existing?.name ?? session.profile.name,
    organizationId: organization.id,
    organizationName: organization.name,
  };
  await session.profiles.save(
    bound,
    { ...refreshed, workosOrganizationId: organization.workos_id, organizationId: organization.id },
    session.profile,
  );
  return bound;
};

/**
 * The workspace fields of a credential, present only once one has been selected. A refresh returns
 * a bare credential, so carrying these forward is what keeps the selection alive.
 */
export const workspaceOf = (
  credential: StoredCredential,
): { workosOrganizationId?: string; organizationId?: string } => ({
  ...(credential.workosOrganizationId === undefined
    ? {}
    : { workosOrganizationId: credential.workosOrganizationId }),
  ...(credential.organizationId === undefined ? {} : { organizationId: credential.organizationId }),
});

/** The customer-visible projection; the provider identifier stays inside the client. */
export const publicWorkspace = (
  organization: PublicWorkspace,
): { readonly id: string; readonly name: string } => ({
  id: organization.id,
  name: organization.name,
});
