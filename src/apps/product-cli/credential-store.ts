export interface StoredCredential {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt?: string;
  /** The workspace this credential is scoped to, as the provider names it. */
  readonly workosOrganizationId?: string;
  /** The same workspace in platform terms, kept for display. */
  readonly organizationId?: string;
}

export interface CurrentCredential extends StoredCredential {
  readonly expiresAt: string;
}

export interface CredentialStore {
  read(): Promise<StoredCredential | undefined>;
  replace(credential: CurrentCredential): Promise<void>;
  clear(): Promise<void>;
}

interface KeyringEntry {
  setPassword(password: string): Promise<void>;
  getPassword(): Promise<string | undefined>;
  deleteCredential(): Promise<boolean>;
}

export type KeyringEntryFactory = (account: string) => Promise<KeyringEntry>;

export class CredentialStoreUnavailableError extends Error {
  public constructor() {
    super("The credential store is unavailable.");
    this.name = "CredentialStoreUnavailableError";
  }
}

export class CredentialStoreIntegrityError extends Error {
  public constructor() {
    super("The credential store integrity check failed.");
    this.name = "CredentialStoreIntegrityError";
  }
}

/** The single login entry of clients before named profiles; it is only read to migrate it. */
export const LEGACY_CREDENTIAL_ACCOUNT = "credential";

export class NativeNapiKeyringCredentialStore implements CredentialStore {
  private readonly createEntry: KeyringEntryFactory;

  public constructor(
    createEntry: KeyringEntryFactory | undefined = undefined,
    serviceName = "ohmyhost",
    private readonly account = LEGACY_CREDENTIAL_ACCOUNT,
  ) {
    this.createEntry = createEntry ?? createNativeEntryFactory(serviceName);
  }

  public async read(): Promise<StoredCredential | undefined> {
    const serialized = await this.entry().then((entry) => entry.getPassword());
    if (serialized === undefined) return undefined;
    return parseVerifiedCredential(serialized);
  }

  public async replace(credential: CurrentCredential): Promise<void> {
    const entry = await this.entry();
    const serialized = serializeCredential(credential);
    await entry.setPassword(serialized);
    parseVerifiedCredential(await entry.getPassword());
  }

  public async clear(): Promise<void> {
    const entry = await this.entry();
    await entry.deleteCredential();
    if ((await entry.getPassword()) !== undefined) throw new CredentialStoreIntegrityError();
  }

  private entry(): Promise<KeyringEntry> {
    return this.createEntry(this.account);
  }
}

const parseVerifiedCredential = (serialized: string | undefined): StoredCredential => {
  try {
    return parseCredential(serialized);
  } catch {
    throw new CredentialStoreIntegrityError();
  }
};

export const createNativeEntryFactory = (serviceName: string): KeyringEntryFactory => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(serviceName)) {
    throw new CredentialStoreUnavailableError();
  }
  return async (account) => {
    const { AsyncEntry } = await import("@napi-rs/keyring");
    let entry: InstanceType<typeof AsyncEntry>;
    try {
      entry = new AsyncEntry(serviceName, account);
    } catch {
      throw new CredentialStoreUnavailableError();
    }
    return {
      setPassword: (password) => runNativeOperation(() => entry.setPassword(password)),
      getPassword: async () => (await runNativeOperation(() => entry.getPassword())) ?? undefined,
      deleteCredential: () => runNativeOperation(() => entry.deleteCredential()),
    };
  };
};

const runNativeOperation = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
  try {
    return await operation();
  } catch {
    throw new CredentialStoreUnavailableError();
  }
};

export const serializeCredential = (credential: CurrentCredential): string =>
  JSON.stringify(credential);

export const parseCredential = (serialized: string | undefined): StoredCredential => {
  if (serialized === undefined) throw new Error("Credential entry is missing");
  const value: unknown = JSON.parse(serialized);
  if (
    typeof value !== "object" ||
    value === null ||
    !("accessToken" in value) ||
    !("refreshToken" in value) ||
    typeof value.accessToken !== "string" ||
    typeof value.refreshToken !== "string" ||
    value.accessToken.length === 0 ||
    value.refreshToken.length === 0 ||
    ("expiresAt" in value && typeof value.expiresAt !== "string") ||
    ("workosOrganizationId" in value &&
      (typeof value.workosOrganizationId !== "string" ||
        !/^org_[A-Za-z0-9_]{1,120}$/u.test(value.workosOrganizationId))) ||
    ("organizationId" in value &&
      (typeof value.organizationId !== "string" ||
        !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(value.organizationId)))
  ) {
    throw new Error("Credential entry is invalid");
  }
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    ...("expiresAt" in value ? { expiresAt: value.expiresAt as string } : {}),
    ...("workosOrganizationId" in value
      ? { workosOrganizationId: value.workosOrganizationId as string }
      : {}),
    ...("organizationId" in value ? { organizationId: value.organizationId as string } : {}),
  };
};
