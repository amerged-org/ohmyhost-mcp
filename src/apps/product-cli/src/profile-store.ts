import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  CredentialStoreIntegrityError,
  CredentialStoreUnavailableError,
  LEGACY_CREDENTIAL_ACCOUNT,
  NativeNapiKeyringCredentialStore,
  createNativeEntryFactory,
  type CredentialStore,
  type CurrentCredential,
  type KeyringEntryFactory,
} from "./credential-store.js";

/**
 * One saved interactive login: a verified user signed in to at most one organization. The name is
 * the customer's alias; the user and organization identify it. None of these fields is a secret.
 */
export interface LocalProfile {
  readonly name: string;
  readonly userId: string;
  readonly organizationId: string | null;
  readonly organizationName: string | null;
}

/** Saved logins of one platform environment: a non-secret index and one secret entry each. */
export interface ProfileRegistry {
  list(): Promise<readonly LocalProfile[]>;
  credential(profile: LocalProfile): CredentialStore;
  /**
   * Writes the credential first, so an index entry never names a missing login. `replaces` is the
   * login this one supersedes, such as the organization-less login that was just bound.
   */
  save(
    profile: LocalProfile,
    credential: CurrentCredential,
    replaces?: LocalProfile,
  ): Promise<void>;
  remove(profile: LocalProfile): Promise<void>;
  /** The single entry of clients before named profiles, read only to migrate it. */
  legacy(): CredentialStore;
}

/** The requested name already belongs to a login of another user or organization. */
export class ProfileNameConflictError extends Error {
  public constructor(readonly profile: LocalProfile) {
    super("The profile name is used by another saved login");
    this.name = "ProfileNameConflictError";
  }
}

/** A login beyond the most saved logins one environment keeps; nothing was written. */
export class ProfileLimitError extends Error {
  public constructor(readonly saved: number) {
    super("The saved logins of this environment reached their limit");
    this.name = "ProfileLimitError";
  }
}

const MAX_PROFILES = 64;
/** Each lost race means another writer finished a change, so this bounds concurrent writers. */
const MAX_INDEX_ATTEMPTS = 64;
const INDEX_FILE = /^index-([1-9][0-9]{0,14})\.json$/u;
const SERVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/u;
const USER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const ORGANIZATION_ID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

export const isProfileName = (value: string): boolean => PROFILE_NAME.test(value);
export const isProfileUserId = (value: string): boolean => USER_ID.test(value);

/** The keyring account of one login; the key is its user and organization, never its alias. */
const profileAccount = (profile: LocalProfile): string =>
  `profile:${profile.userId}:${profile.organizationId ?? "none"}`;

export const sameLogin = (left: LocalProfile, right: LocalProfile): boolean =>
  profileAccount(left) === profileAccount(right);

/** Where one environment lists its saved logins. It holds names and IDs, never a token. */
export const profileIndexDirectory = (serviceName: string): string =>
  join(homedir(), ".ohmyhost", "profiles", serviceName);

/** The index after saving `profile`, which supersedes its own earlier entry and `replaces`. */
const nextProfileIndex = (
  current: readonly LocalProfile[],
  profile: LocalProfile,
  replaces?: LocalProfile,
): LocalProfile[] => [
  ...current.filter(
    (saved) =>
      !sameLogin(saved, profile) && (replaces === undefined || !sameLogin(saved, replaces)),
  ),
  profile,
];

/** Refuses a name another login uses and one login too many. */
const admitProfile = (next: readonly LocalProfile[], profile: LocalProfile): void => {
  const conflict = next.find((saved) => saved.name === profile.name && saved !== profile);
  if (conflict !== undefined) throw new ProfileNameConflictError(conflict);
  if (next.length > MAX_PROFILES) throw new ProfileLimitError(next.length - 1);
};

/**
 * Tokens stay in the operating system's credential store, one entry per login. The list of logins
 * is a separate non-secret file index, so saving or removing one login never rewrites a shared
 * credential entry that another process may be changing at the same moment.
 */
export class NativeKeyringProfileRegistry implements ProfileRegistry {
  readonly #createEntry: KeyringEntryFactory;
  readonly #index: ProfileIndexFiles;

  public constructor(
    createEntry: KeyringEntryFactory | undefined = undefined,
    private readonly serviceName = "ohmyhost",
    indexDirectory?: string,
  ) {
    if (!SERVICE_NAME.test(serviceName)) throw new CredentialStoreUnavailableError();
    this.#createEntry = createEntry ?? createNativeEntryFactory(serviceName);
    this.#index = new ProfileIndexFiles(indexDirectory ?? profileIndexDirectory(serviceName));
  }

  public async list(): Promise<readonly LocalProfile[]> {
    return (await this.#index.read()).profiles;
  }

  public credential(profile: LocalProfile): CredentialStore {
    return new NativeNapiKeyringCredentialStore(
      this.#createEntry,
      this.serviceName,
      profileAccount(profile),
    );
  }

  public legacy(): CredentialStore {
    return new NativeNapiKeyringCredentialStore(
      this.#createEntry,
      this.serviceName,
      LEGACY_CREDENTIAL_ACCOUNT,
    );
  }

  public async save(
    profile: LocalProfile,
    credential: CurrentCredential,
    replaces?: LocalProfile,
  ): Promise<void> {
    assertProfile(profile);
    // Refused before anything is written, so a conflicting or surplus login changes nothing.
    const before = await this.list();
    admitProfile(nextProfileIndex(before, profile, replaces), profile);
    await this.credential(profile).replace(credential);
    try {
      await this.#index.update((current) => {
        const next = nextProfileIndex(current, profile, replaces);
        admitProfile(next, profile);
        return next;
      });
    } catch (error) {
      // Another process changed the index meanwhile, or it could not be written: a login new to
      // this computer leaves no token behind that no index entry names.
      if (!before.some((saved) => sameLogin(saved, profile)))
        await this.credential(profile).clear();
      throw error;
    }
    if (replaces !== undefined && !sameLogin(replaces, profile))
      await this.credential(replaces).clear();
  }

  public async remove(profile: LocalProfile): Promise<void> {
    await this.credential(profile).clear();
    await this.#index.update((current) =>
      current.some((saved) => sameLogin(saved, profile))
        ? current.filter((saved) => !sameLogin(saved, profile))
        : undefined,
    );
  }
}

/**
 * The saved logins as numbered files that are never rewritten. A change reads the newest one and
 * creates the next number through an exclusive hard link, so when two processes change the index at
 * once exactly one wins and the other re-reads and applies its change on top: no login is lost, no
 * lock can outlive a crashed process, and a crash leaves either the complete new file or none.
 */
export class ProfileIndexFiles {
  public constructor(private readonly directory: string) {}

  public async read(): Promise<{
    readonly version: number;
    readonly profiles: readonly LocalProfile[];
  }> {
    for (let attempt = 0; attempt < MAX_INDEX_ATTEMPTS; attempt += 1) {
      const version = await this.#newest();
      if (version === 0) return { version, profiles: [] };
      let serialized: string;
      try {
        serialized = await readFile(this.#file(version), "utf8");
      } catch (error) {
        // A newer change removed this file after it was listed; look again.
        if (fileErrorCode(error) === "ENOENT") continue;
        throw new CredentialStoreUnavailableError();
      }
      return { version, profiles: parseProfileIndex(serialized) };
    }
    throw new CredentialStoreUnavailableError();
  }

  /** Applies `change` to the newest index; `undefined` means nothing to change. */
  public async update(
    change: (current: readonly LocalProfile[]) => readonly LocalProfile[] | undefined,
  ): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
    } catch {
      throw new CredentialStoreUnavailableError();
    }
    for (let attempt = 0; attempt < MAX_INDEX_ATTEMPTS; attempt += 1) {
      const { version, profiles } = await this.read();
      const next = change(profiles);
      if (next === undefined) return;
      const temporary = join(this.directory, `.index-${randomUUID()}.tmp`);
      try {
        await writeDurably(temporary, serializeProfileIndex(next));
        await link(temporary, this.#file(version + 1));
      } catch (error) {
        // Another process created this version first: apply the change to its result instead.
        if (fileErrorCode(error) === "EEXIST") continue;
        throw new CredentialStoreUnavailableError();
      } finally {
        await removeTemporary(temporary);
      }
      // A writer delayed since its read can link a number that newer changes already superseded
      // and pruned; its file is then not the newest, so the change is applied again on top.
      if ((await this.#newest()) !== version + 1) continue;
      await this.#prune(version);
      return;
    }
    throw new CredentialStoreUnavailableError();
  }

  async #newest(): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if (fileErrorCode(error) === "ENOENT") return 0;
      throw new CredentialStoreUnavailableError();
    }
    return names.reduce((newest, name) => Math.max(newest, indexVersion(name)), 0);
  }

  /**
   * Keeps the superseded version for readers that listed it just now; older ones go. Cleanup only:
   * a file left behind is ignored, since readers take the newest version, and another process may
   * be removing the same files at this moment.
   */
  async #prune(superseded: number): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch {
      return;
    }
    for (const name of names) {
      const version = indexVersion(name);
      if (version === 0 || version >= superseded) continue;
      try {
        await unlink(join(this.directory, name));
      } catch {
        // Already removed by another process, or left for the next change to remove.
      }
    }
  }

  #file(version: number): string {
    return join(this.directory, `index-${String(version)}.json`);
  }
}

const indexVersion = (name: string): number => Number(INDEX_FILE.exec(name)?.[1] ?? 0);

/** Removes a temporary file. One never created, or one that stays, is harmless beside the index. */
const removeTemporary = async (path: string): Promise<void> => {
  try {
    await unlink(path);
  } catch {
    // Its write failed before the file existed, or it stays as an ignored leftover.
  }
};

const fileErrorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;

/** Writes a new file and flushes it, so a hard link to it never exposes partial content. */
const writeDurably = async (path: string, text: string): Promise<void> => {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const serializeProfileIndex = (profiles: readonly LocalProfile[]): string =>
  JSON.stringify({
    version: 1,
    profiles: [...profiles]
      .sort((left, right) => (left.name < right.name ? -1 : 1))
      .map((profile) => ({
        name: profile.name,
        user_id: profile.userId,
        organization_id: profile.organizationId,
        organization_name: profile.organizationName,
      })),
  });

const parseProfileIndex = (serialized: string): readonly LocalProfile[] => {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value, ["version", "profiles"]) || value["version"] !== 1)
      throw new Error("Invalid profile index");
    const entries = value["profiles"];
    if (!Array.isArray(entries) || entries.length > MAX_PROFILES)
      throw new Error("Invalid profile index");
    const profiles = entries.map((entry: unknown): LocalProfile => {
      if (!isRecord(entry, ["name", "user_id", "organization_id", "organization_name"]))
        throw new Error("Invalid profile");
      const profile = {
        name: entry["name"],
        userId: entry["user_id"],
        organizationId: entry["organization_id"],
        organizationName: entry["organization_name"],
      } as LocalProfile;
      assertProfile(profile);
      return profile;
    });
    if (
      new Set(profiles.map((profile) => profile.name)).size !== profiles.length ||
      new Set(profiles.map(profileAccount)).size !== profiles.length
    )
      throw new Error("Duplicate profile");
    return profiles;
  } catch {
    throw new CredentialStoreIntegrityError();
  }
};

const assertProfile = (profile: LocalProfile): void => {
  if (
    typeof profile.name !== "string" ||
    !PROFILE_NAME.test(profile.name) ||
    typeof profile.userId !== "string" ||
    !USER_ID.test(profile.userId) ||
    !(
      profile.organizationId === null ||
      (typeof profile.organizationId === "string" && ORGANIZATION_ID.test(profile.organizationId))
    ) ||
    !(
      profile.organizationName === null ||
      (typeof profile.organizationName === "string" &&
        profile.organizationName.length > 0 &&
        profile.organizationName.length <= 128 &&
        !/\p{Cc}/u.test(profile.organizationName))
    ) ||
    (profile.organizationId === null && profile.organizationName !== null)
  )
    throw new CredentialStoreIntegrityError();
};

const isRecord = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");

/** What a command or tool call asked for; every field is optional context, never a credential. */
export interface ProfileRequest {
  /** A name given with this command or call. */
  readonly name?: string;
  /** The name this process is bound to through OHMYHOST_PROFILE. */
  readonly bound?: string;
  readonly organizationId?: string;
  readonly userId?: string;
}

export type ProfileSelection =
  | { readonly outcome: "selected"; readonly profile: LocalProfile }
  | { readonly outcome: "none" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "ambiguous"; readonly candidates: readonly LocalProfile[] }
  | {
      readonly outcome: "conflict";
      readonly field: "binding" | "organization" | "user";
      readonly profile: LocalProfile | null;
    };

/**
 * Choose the login a command runs as. A requested name or binding is taken exactly; otherwise the
 * requested organization and user narrow the saved logins, and only a single match is used. There
 * is no machine-wide default, so another agent's choice can never retarget this command.
 */
export const selectProfile = (
  profiles: readonly LocalProfile[],
  request: ProfileRequest,
): ProfileSelection => {
  if (request.name !== undefined && request.bound !== undefined && request.name !== request.bound)
    return { outcome: "conflict", field: "binding", profile: null };
  const named = request.name ?? request.bound;
  if (named !== undefined) {
    const profile = profiles.find((saved) => saved.name === named);
    if (profile === undefined) return { outcome: "not_found" };
    if (request.organizationId !== undefined && profile.organizationId !== request.organizationId)
      return { outcome: "conflict", field: "organization", profile };
    if (request.userId !== undefined && profile.userId !== request.userId)
      return { outcome: "conflict", field: "user", profile };
    return { outcome: "selected", profile };
  }
  const candidates = profiles.filter(
    (profile) =>
      (request.organizationId === undefined || profile.organizationId === request.organizationId) &&
      (request.userId === undefined || profile.userId === request.userId),
  );
  const only = candidates[0];
  if (candidates.length === 1 && only !== undefined) return { outcome: "selected", profile: only };
  if (candidates.length > 1) return { outcome: "ambiguous", candidates };
  return profiles.length === 0 ? { outcome: "none" } : { outcome: "not_found" };
};

/**
 * Choose the login that `organization use` binds. A login already in that organization is the
 * answer; otherwise the one login that has no organization yet is bound to it.
 */
export const selectProfileForOrganization = (
  profiles: readonly LocalProfile[],
  request: ProfileRequest & { readonly organizationId: string },
): ProfileSelection => {
  const user = request.userId === undefined ? {} : { userId: request.userId };
  if (request.name !== undefined || request.bound !== undefined)
    return selectProfile(profiles, {
      ...(request.name === undefined ? {} : { name: request.name }),
      ...(request.bound === undefined ? {} : { bound: request.bound }),
      ...user,
    });
  // A requested user narrows the candidates; a login of another user is never bound.
  const candidates = profiles.filter(
    (profile) => request.userId === undefined || profile.userId === request.userId,
  );
  const inOrganization = candidates.filter(
    (profile) => profile.organizationId === request.organizationId,
  );
  if (inOrganization.length > 1) return { outcome: "ambiguous", candidates: inOrganization };
  const unscoped = candidates.filter((profile) => profile.organizationId === null);
  const [member] = inOrganization;
  if (member !== undefined) return { outcome: "selected", profile: member };
  const [open] = unscoped;
  if (unscoped.length === 1 && open !== undefined) return { outcome: "selected", profile: open };
  return selectProfile(profiles, user);
};

/** A readable alias from the organization name that no other saved login uses. */
export const defaultProfileName = (
  profiles: readonly LocalProfile[],
  login: Pick<LocalProfile, "userId" | "organizationId" | "organizationName">,
): string => {
  const same = profiles.find(
    (profile) => profile.userId === login.userId && profile.organizationId === login.organizationId,
  );
  if (same !== undefined) return same.name;
  const base =
    slug(login.organizationName ?? "") || (login.organizationId === null ? "account" : "workspace");
  const free = (name: string): boolean => profiles.every((profile) => profile.name !== name);
  if (free(base)) return base;
  const suffix = (login.organizationId ?? login.userId)
    .replace(/[^A-Za-z0-9]/gu, "")
    .slice(-6)
    .toLowerCase();
  for (let attempt = 1; attempt <= profiles.length + 1; attempt += 1) {
    const candidate = `${base.slice(0, 48)}-${suffix}${attempt === 1 ? "" : `-${String(attempt)}`}`;
    if (free(candidate)) return candidate;
  }
  throw new CredentialStoreIntegrityError();
};

const slug = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .slice(0, 40)
    .replace(/-+$/u, "");

/** The customer-visible projection of a saved login; it carries no credential. */
export const publicProfile = (
  profile: LocalProfile,
): {
  readonly name: string;
  readonly user_id: string;
  readonly organization_id: string | null;
  readonly organization_name: string | null;
} => ({
  name: profile.name,
  user_id: profile.userId,
  organization_id: profile.organizationId,
  organization_name: profile.organizationName,
});

/** How to make room when an environment keeps the most saved logins it can. */
export const profileLimitAction = (commandPrefix: string): string =>
  `Nothing was saved: this environment already keeps ${String(MAX_PROFILES)} saved logins, the most one computer holds. Remove one you no longer need with '${commandPrefix} logout --profile-name NAME --json' ('${commandPrefix} profile list --json' shows them), then retry.`;

/** A chosen login cannot run the command; the code and action say which context to fix. */
export class ProfileSelectionError extends Error {
  public constructor(
    readonly code:
      | "authentication_required"
      | "profile_not_found"
      | "profile_selection_required"
      | "profile_context_mismatch"
      | "environment_token_context_mismatch"
      | "linked_project_selection_required"
      | "linked_project_organization_mismatch",
    readonly exitCode: number,
    readonly suggestedAction: string,
  ) {
    super(`${code}: ${suggestedAction}`);
    this.name = "ProfileSelectionError";
  }
}

/** How the caller passes a login: a CLI flag or an MCP tool argument. */
export type ProfileSelector = "cli" | "mcp";

/** Turn a selection that did not produce one login into the error that says how to get one. */
export const profileSelectionError = (
  selection: Exclude<ProfileSelection, { readonly outcome: "selected" }>,
  request: ProfileRequest,
  commandPrefix: string,
  selector: ProfileSelector,
): ProfileSelectionError => {
  const choose =
    selector === "cli"
      ? `pass --profile-name NAME (see '${commandPrefix} profile list --json') or set OHMYHOST_PROFILE for this process`
      : "pass profile_name (see profile_list) or set OHMYHOST_PROFILE in this MCP server's configuration";
  const login = `${commandPrefix} login${
    request.organizationId === undefined ? "" : ` --organization ${request.organizationId}`
  }${request.userId === undefined ? "" : ` --user ${request.userId}`}${
    (request.name ?? request.bound) === undefined
      ? ""
      : ` --profile-name ${String(request.name ?? request.bound)}`
  } --json`;
  if (selection.outcome === "none")
    return new ProfileSelectionError(
      "authentication_required",
      5,
      `No login is saved on this computer. Run '${login}'.`,
    );
  if (selection.outcome === "not_found")
    return new ProfileSelectionError(
      "profile_not_found",
      5,
      `No saved login matches ${describeRequest(request)}. Run '${login}' to add it, signing in as that user; '${commandPrefix} profile list --json' shows the saved logins.`,
    );
  if (selection.outcome === "ambiguous")
    return new ProfileSelectionError(
      "profile_selection_required",
      2,
      `Several saved logins could run this: ${selection.candidates
        .map((profile) => profile.name)
        .join(", ")}. Ask the customer which account to use, then ${choose}.`,
    );
  if (selection.field === "binding")
    return new ProfileSelectionError(
      "profile_context_mismatch",
      2,
      `This call names profile ${String(request.name)}, but the process is bound to OHMYHOST_PROFILE=${String(request.bound)}. Use the bound profile or start a process for the other one.`,
    );
  const profile = selection.profile;
  return new ProfileSelectionError(
    "profile_context_mismatch",
    2,
    selection.field === "organization"
      ? `Profile ${String(profile?.name)} is signed in to organization ${String(profile?.organizationId ?? "none")}, but this targets organization ${String(request.organizationId)}. Use the profile of that organization or change the target; nothing was sent.`
      : `Profile ${String(profile?.name)} belongs to user ${String(profile?.userId)}, not ${String(request.userId)}. Use that user's profile; nothing was sent.`,
  );
};

const describeRequest = (request: ProfileRequest): string => {
  const parts = [
    ...((request.name ?? request.bound) === undefined
      ? []
      : [`profile ${String(request.name ?? request.bound)}`]),
    ...(request.organizationId === undefined ? [] : [`organization ${request.organizationId}`]),
    ...(request.userId === undefined ? [] : [`user ${request.userId}`]),
  ];
  return parts.length === 0 ? "this request" : parts.join(", ");
};

/** One line that says which account a command acts as, without any credential. */
export const describeProfile = (profile: LocalProfile): string =>
  `profile ${profile.name} (user ${profile.userId}, ${
    profile.organizationId === null
      ? "no organization"
      : `organization ${profile.organizationName === null ? "" : `${profile.organizationName} `}${profile.organizationId}`
  })`;
