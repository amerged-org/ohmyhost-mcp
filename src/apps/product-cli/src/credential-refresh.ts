import type { CredentialStore, CurrentCredential, StoredCredential } from "./credential-store.js";
import type { LoginRef, ProfileRegistry } from "./profile-store.js";

/** The saved credential disappeared while this process waited to renew it; nothing was written. */
export class LoginGoneError extends Error {
  public constructor() {
    super("The saved login has no credential any more");
    this.name = "LoginGoneError";
  }
}

/** Ownership for a store that is not shared between processes: the operation simply runs. */
export const DIRECT_OWNERSHIP: Pick<ProfileRegistry, "owning"> = {
  owning: (_logins, operation) => operation(),
};

export interface LoginRenewal {
  readonly registry: Pick<ProfileRegistry, "owning">;
  readonly login: LoginRef;
  readonly store: CredentialStore;
  /** Whether a credential can be used as it is, without asking the provider. */
  readonly usable: (credential: StoredCredential) => boolean;
  /** Spends the credential's refresh token and answers the renewed credential, ready to save. */
  readonly renew: (credential: StoredCredential) => Promise<CurrentCredential>;
  /** Whether an error is the provider's final rejection of this login. */
  readonly rejected: (error: unknown) => boolean;
  /** Removes this login; it runs only after the provider rejected it. */
  readonly forget: () => Promise<void>;
  readonly signal?: AbortSignal;
  /**
   * The credential this call has just read, where ownership is a direct call and no other process
   * can have renewed it meanwhile: it spares the native store a second read. A shared file store
   * leaves it out, because the credential is read again as the owner.
   */
  readonly current?: StoredCredential;
}

/**
 * Renews a saved login as its single owner. A refresh token is spent at the provider before
 * anything is written, so ownership is taken first and the credential is read again as the owner: one
 * that another process renewed meanwhile is used as it is and the provider is not asked, and one
 * that is gone ends the call with nothing written. Only the provider's own rejection, seen as the
 * owner, removes the login.
 */
export const renewLogin = async (
  input: LoginRenewal,
): Promise<{ readonly credential: StoredCredential; readonly refreshed: boolean }> =>
  await input.registry.owning(
    [input.login],
    async () => {
      const current = input.current ?? (await input.store.read());
      if (current === undefined) throw new LoginGoneError();
      if (input.usable(current)) return { credential: current, refreshed: false };
      let renewed: CurrentCredential;
      try {
        renewed = await input.renew(current);
      } catch (error) {
        if (input.rejected(error)) await input.forget();
        throw error;
      }
      await input.store.replace(renewed);
      return { credential: renewed, refreshed: true };
    },
    input.signal,
  );
