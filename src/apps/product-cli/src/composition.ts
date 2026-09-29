import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  createClient,
  getGithubOrganizationConnection,
  getProject,
  revokeCurrentSession,
} from "@ohmyhost/sdk-ts";
import { WORKOS_USER_API_KEY_PATTERN } from "@ohmyhost/workos-auth-contracts/user-api-keys";

import {
  WorkosDeviceFlowClient,
  parseDeviceTokens,
  WORKOS_AUTHKIT_DEVICE_TOKEN_ENDPOINT,
  type WorkosPublicHttpRequest,
  type WorkosPublicHttpResponse,
  type WorkosPublicTransport,
} from "@ohmyhost/workos-auth-contracts/device-flow";

import {
  ProductCli,
  classifyCliFailure,
  cliMetadataResult,
  CREDENTIAL_STORE_UNAVAILABLE_ACTION,
  endedLoginAction,
  INTERNAL_ERROR_ACTION,
  invalidCommandAction,
  refreshFailedAction,
  NetworkTransportError,
  LifecycleTransportError,
  TokenRefreshRejectedError,
  PublicResponseTooLargeError,
  SecretInputError,
  type CliResult,
  type DiagnosticSink,
  type DeviceAuthorizationPresenter,
  type TokenRefresher,
  type TokenRevoker,
} from "./cli.js";
import {
  extractProfileName,
  InvalidCommandError,
  parseProductCliCommand,
  recognizedCommandLabel,
  type ProductCliCommand,
} from "./command.js";
import {
  CredentialStoreUnavailableError,
  type CredentialStore,
  type CurrentCredential,
  type StoredCredential,
} from "./credential-store.js";
import { GeneratedSdkProductApi, type ProductApi } from "./product-api.js";
import {
  defaultProfileName,
  describeProfile,
  isProfileName,
  NativeKeyringProfileRegistry,
  ProfileLimitError,
  profileLimitAction,
  ProfileSelectionError,
  profileSelectionError,
  publicProfile,
  selectProfile,
  selectProfileForOrganization,
  type LocalProfile,
  type ProfileRegistry,
  type ProfileRequest,
  type ProfileSelector,
} from "./profile-store.js";
import { verifiedUserId, workspaceOf, type WorkspaceSession } from "./workspace.js";
import {
  chooseLinkedProject,
  linkedOrganization,
  OwnerOnlyProjectLinkStore,
  readProjectLinks,
  removeLegacyProjectLink,
  type DirectoryLinks,
  type LinkedProject,
} from "./project-link-store.js";
import {
  initializeRepository,
  RepositoryInitBlockedError,
  RepositoryInitConflictError,
  RepositoryInitError,
} from "./repository-init.js";
import { runLocalPsql } from "./psql-session.js";
import { parseCurrentIdentity, ResponseContractError } from "./runtime-contract.js";
import { resolveDeviceTokenExpiresAt } from "./device-token-expiry.js";

export type ProductCliEnvironment = Readonly<{
  OHMYHOST_ENVIRONMENT?: string;
  OHMYHOST_TOKEN?: string;
  /** Binds this process to one saved login by name; a request for another login is refused. */
  OHMYHOST_PROFILE?: string;
}>;

export interface ProductCliIo {
  writeStdout(value: string): void;
  writeStderr(value: string): void;
}

export interface ProductCliCompositionOverrides {
  /** Saved logins; the native credential store of the selected platform environment by default. */
  readonly profiles?: ProfileRegistry;
  /** Directory whose project link supplies a missing --project; defaults to the process directory. */
  readonly workingDirectory?: string;
  readonly readSecretValue?: (signal: AbortSignal) => Promise<string>;
}

/** What one command or tool call asked for. Identifiers are context, never credentials. */
export interface ProfileRequestInput {
  readonly name?: string;
  readonly organizationId?: string;
  /** The user this call must run as; a login or OHMYHOST_TOKEN of another user is refused. */
  readonly userId?: string;
  /** `organization use`: the login to bind is the one in that organization or the one without. */
  readonly bindOrganization?: boolean;
}

export interface AuthenticatedProductApiOverrides {
  readonly environment?: ProductCliEnvironment;
  readonly profiles?: ProfileRegistry;
  readonly request?: ProfileRequestInput;
  /** How the caller names a login in its error guidance: a CLI flag or an MCP argument. */
  readonly selector?: ProfileSelector;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
  readonly productApiOrigin?: string;
  readonly tokenRefresher?: TokenRefresher;
}

export class ProductApiAuthenticationError extends Error {
  public constructor(
    readonly code:
      | "authentication_required"
      | "token_refresh_failed"
      | "invalid_environment_token"
      | "invalid_profile_binding",
  ) {
    super(code);
    this.name = "ProductApiAuthenticationError";
  }
}

/** Which account a transport acts as. It names the login, never a credential. */
export interface EffectiveContext {
  readonly credential: "profile" | "environment_token";
  readonly profile: LocalProfile | null;
}

type OutputCommand = ReturnType<typeof recognizedCommandLabel>;

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PUBLIC_RESPONSE_BYTES = 1_048_576;
const PRODUCT_ENVIRONMENTS = Object.freeze({
  development: Object.freeze({
    commandPrefix: "OHMYHOST_ENVIRONMENT=development ohmyhost",
    apiOrigin: "https://dev.app.ohmyho.st",
    clientId: "client_01JWHRCGD1FZJK8DNJH75V97SE",
    verificationUri: "https://orderly-laugh-73-staging.authkit.app/device",
    credentialService: "ohmyhost",
    linkDirectory: ".ohmyhost",
  }),
  production: Object.freeze({
    commandPrefix: "OHMYHOST_ENVIRONMENT=production ohmyhost",
    apiOrigin: "https://app.ohmyho.st",
    clientId: "client_01JWHRCGK30FQWWH2ZG7E29TAJ",
    verificationUri: "https://divine-climb-22.authkit.app/device",
    credentialService: "ohmyhost.production",
    linkDirectory: ".ohmyhost/production",
  }),
});

export function resolveProductCliEnvironment(environment: ProductCliEnvironment = {}) {
  const name = environment.OHMYHOST_ENVIRONMENT ?? "production";
  if (name !== "development" && name !== "production") throw new Error("invalid_environment");
  return PRODUCT_ENVIRONMENTS[name];
}

function environmentToken(environment: ProductCliEnvironment = {}): string | undefined {
  const value = environment.OHMYHOST_TOKEN;
  if (value !== undefined && !WORKOS_USER_API_KEY_PATTERN.test(value))
    throw new ProductApiAuthenticationError("invalid_environment_token");
  return value;
}

/** The saved login this process is bound to; an empty value means no binding. */
function environmentProfile(environment: ProductCliEnvironment = {}): string | undefined {
  const value = environment.OHMYHOST_PROFILE;
  if (value === undefined || value === "") return undefined;
  if (!isProfileName(value)) throw new ProductApiAuthenticationError("invalid_profile_binding");
  return value;
}

const profileRequest = (
  input: ProfileRequestInput | undefined,
  bound: string | undefined,
): ProfileRequest => ({
  ...(input?.name === undefined ? {} : { name: input.name }),
  ...(bound === undefined ? {} : { bound }),
  ...(input?.organizationId === undefined ? {} : { organizationId: input.organizationId }),
  ...(input?.userId === undefined ? {} : { userId: input.userId }),
});

export const createProductionAuthenticatedProductApi = async (
  signal: AbortSignal,
  overrides: AuthenticatedProductApiOverrides = {},
): Promise<ProductApi> => {
  const transport = await createAuthenticatedProductTransport(signal, overrides);
  return new GeneratedSdkProductApi(transport.baseUrl, transport.accessToken, transport.fetch);
};

/**
 * Private client composition data, never a public API or MCP response. Each call chooses its own
 * login from its request and the process binding; nothing another process chose can change it.
 */
export const createAuthenticatedProductTransport = async (
  signal: AbortSignal,
  overrides: AuthenticatedProductApiOverrides = {},
) => {
  const platform = resolveProductCliEnvironment(overrides.environment);
  const apiToken = environmentToken(overrides.environment);
  const bound = environmentProfile(overrides.environment);
  const baseUrl = overrides.productApiOrigin ?? platform.apiOrigin;
  const boundedFetch = createBoundedFetch(
    overrides.fetch ?? fetch,
    signal,
    REQUEST_TIMEOUT_MS,
    MAX_PUBLIC_RESPONSE_BYTES,
  );
  const registry =
    overrides.profiles ?? new NativeKeyringProfileRegistry(undefined, platform.credentialService);
  const binding = overrides.request?.bindOrganization === true;
  const request = profileRequest(overrides.request, bound);
  if (apiToken !== undefined) {
    // A user API token carries a fixed scope; it must match whatever this call asked for.
    await verifyEnvironmentTokenContext({
      token: apiToken,
      request: binding ? profileRequest({}, bound) : request,
      registry,
      baseUrl,
      fetch: boundedFetch,
    });
    return {
      baseUrl,
      accessToken: apiToken,
      fetch: boundedFetch,
      workspace: undefined,
      context: { credential: "environment_token", profile: null } as EffectiveContext,
    };
  }
  const now = overrides.now ?? (() => new Date());
  const refresher =
    overrides.tokenRefresher ??
    new PublicWorkosTokenRefresher(overrides.environment, overrides.fetch, now);
  const profiles = await loadProfiles(registry, {
    baseUrl,
    fetch: boundedFetch,
    signal,
    now,
    refresher,
  });
  const selection =
    binding && request.organizationId !== undefined
      ? selectProfileForOrganization(profiles, {
          ...request,
          organizationId: request.organizationId,
        })
      : selectProfile(profiles, request);
  if (selection.outcome !== "selected")
    throw profileSelectionError(
      selection,
      request,
      platform.commandPrefix,
      overrides.selector ?? "cli",
    );
  const profile = selection.profile;
  const store = registry.credential(profile);
  const stored = await store.read();
  if (stored === undefined) throw missingLogin(profile, platform.commandPrefix);
  const credential = await currentCredential(stored, store, signal, now, refresher, () =>
    registry.remove(profile),
  );
  return {
    baseUrl,
    accessToken: credential.accessToken,
    fetch: boundedFetch,
    workspace: { store, refresher, profiles: registry, profile } satisfies WorkspaceSession,
    context: { credential: "profile", profile } as EffectiveContext,
  };
};

/** The saved logins and this process's binding; the MCP `profile_list` answer. */
export const listSavedProfiles = async (
  signal: AbortSignal,
  overrides: AuthenticatedProductApiOverrides = {},
): Promise<{
  readonly profiles: readonly ReturnType<typeof publicProfile>[];
  readonly bound: string | null;
  readonly environment_token: boolean;
}> => {
  const platform = resolveProductCliEnvironment(overrides.environment);
  const apiToken = environmentToken(overrides.environment);
  const bound = environmentProfile(overrides.environment);
  const registry =
    overrides.profiles ?? new NativeKeyringProfileRegistry(undefined, platform.credentialService);
  const now = overrides.now ?? (() => new Date());
  const profiles =
    apiToken === undefined
      ? await loadProfiles(registry, {
          baseUrl: overrides.productApiOrigin ?? platform.apiOrigin,
          fetch: createBoundedFetch(
            overrides.fetch ?? fetch,
            signal,
            REQUEST_TIMEOUT_MS,
            MAX_PUBLIC_RESPONSE_BYTES,
          ),
          signal,
          now,
          refresher:
            overrides.tokenRefresher ??
            new PublicWorkosTokenRefresher(overrides.environment, overrides.fetch, now),
        })
      : await registry.list();
  return {
    profiles: profiles.map(publicProfile),
    bound: bound ?? null,
    environment_token: apiToken !== undefined,
  };
};

/** An index entry whose credential is gone, for example after it was removed by hand. */
const missingLogin = (profile: LocalProfile, commandPrefix: string): ProfileSelectionError =>
  new ProfileSelectionError(
    "authentication_required",
    5,
    `The saved login ${profile.name} has no credential on this computer. Run '${commandPrefix} login${
      profile.organizationId === null ? "" : ` --organization ${profile.organizationId}`
    } --profile-name ${profile.name} --json'.`,
  );

const currentCredential = async (
  stored: StoredCredential,
  store: CredentialStore,
  signal: AbortSignal,
  now: () => Date,
  tokenRefresher: TokenRefresher,
  forget: () => Promise<void>,
): Promise<CurrentCredential> => {
  const expiresAt = stored.expiresAt === undefined ? NaN : Date.parse(stored.expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt > now().getTime() + REQUEST_TIMEOUT_MS) {
    return stored as CurrentCredential;
  }
  try {
    const refreshed = await tokenRefresher.refresh(
      stored.refreshToken,
      boundedSignal(signal, REQUEST_TIMEOUT_MS),
      stored.workosOrganizationId,
    );
    const refreshedExpiry = Date.parse(refreshed.expiresAt);
    if (
      refreshed.accessToken.length === 0 ||
      refreshed.refreshToken.length === 0 ||
      !Number.isFinite(refreshedExpiry) ||
      refreshedExpiry <= now().getTime()
    ) {
      throw new Error("invalid refreshed credential");
    }
    // WorkOS returns a bare credential; the selection only survives if we carry it forward.
    const carried = { ...refreshed, ...workspaceOf(stored) };
    await store.replace(carried);
    return carried;
  } catch (error) {
    if (error instanceof TokenRefreshRejectedError) {
      // The provider ended this login; only this saved login is removed.
      await forget();
      throw new ProductApiAuthenticationError("authentication_required");
    }
    throw new ProductApiAuthenticationError("token_refresh_failed");
  }
};

interface ProfileLoadContext {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly signal: AbortSignal;
  readonly now: () => Date;
  readonly refresher: TokenRefresher;
}

/**
 * The saved logins of this platform environment. A login saved by a client before named profiles
 * becomes one named login, verified with the API; it is removed only once that login is written.
 */
export const loadProfiles = async (
  registry: ProfileRegistry,
  context: ProfileLoadContext,
): Promise<readonly LocalProfile[]> => {
  const legacy = registry.legacy();
  const stored = await legacy.read();
  if (stored !== undefined) await migrateLegacyLogin(registry, legacy, stored, context);
  return registry.list();
};

const migrateLegacyLogin = async (
  registry: ProfileRegistry,
  legacy: CredentialStore,
  stored: StoredCredential,
  context: ProfileLoadContext,
): Promise<void> => {
  let credential: CurrentCredential;
  try {
    credential = await currentCredential(
      stored,
      legacy,
      context.signal,
      context.now,
      context.refresher,
      () => legacy.clear(),
    );
  } catch (error) {
    // The provider had already ended that login, so it was removed and nothing is left to move.
    if (error instanceof ProductApiAuthenticationError && error.code === "authentication_required")
      return;
    throw error;
  }
  const api = new GeneratedSdkProductApi(context.baseUrl, credential.accessToken, context.fetch);
  let identity: unknown;
  try {
    identity = await api.getCurrentIdentity();
  } catch (error) {
    // The API refused it, so it cannot be verified or moved. It stays: only the provider ends a
    // login for good, which the next refresh then detects and removes.
    if (!isProblem(error, "unauthenticated")) throw error;
    return;
  }
  const userId = verifiedUserId(identity);
  const organizationId = parseCurrentIdentity(identity).organization_ids[0] ?? null;
  const organizationName =
    organizationId === null
      ? null
      : ((await api.getAccountProfile()).organizations.find(
          (organization) => organization.id === organizationId,
        )?.name ?? null);
  // A saved login of the same account may hold a stale or missing credential, for example after an
  // interrupted earlier move, so it receives the one just verified under its own name. The old entry
  // goes only after that write: until then it keeps the refreshed, usable credential.
  const login = { userId, organizationId, organizationName };
  await registry.save(
    { name: defaultProfileName(await registry.list(), login), ...login },
    credential,
  );
  await legacy.clear();
};

const isProblem = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;

/**
 * OHMYHOST_TOKEN overrides saved logins, but it cannot silently stand in for another account: a
 * requested login or organization must be the token's own, or nothing is sent.
 */
const verifyEnvironmentTokenContext = async (input: {
  readonly token: string;
  readonly request: ProfileRequest;
  readonly registry: ProfileRegistry;
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
}): Promise<{ readonly userId: string; readonly organizationId: string | null } | null> => {
  const { request } = input;
  const named = request.name ?? request.bound;
  if (named === undefined && request.organizationId === undefined && request.userId === undefined)
    return null;
  const refuse = (target: string): ProfileSelectionError =>
    new ProfileSelectionError(
      "environment_token_context_mismatch",
      2,
      `${target} Unset OHMYHOST_TOKEN to use the saved login, or load the key of that account from its private env file. Nothing was sent.`,
    );
  if (request.name !== undefined && request.bound !== undefined && request.name !== request.bound)
    throw refuse(
      `This call names profile ${request.name}, but the process is bound to OHMYHOST_PROFILE=${request.bound}.`,
    );
  const profile =
    named === undefined
      ? undefined
      : (await input.registry.list()).find((saved) => saved.name === named);
  if (named !== undefined && profile === undefined)
    throw refuse(
      `OHMYHOST_TOKEN overrides saved logins in this process, and no saved login is named ${named}.`,
    );
  const { userId, organizationId } = await readTokenIdentity(input);
  const owner = `OHMYHOST_TOKEN belongs to user ${userId} in organization ${organizationId ?? "none"},`;
  if (
    profile !== undefined &&
    (profile.userId !== userId || profile.organizationId !== organizationId)
  )
    throw refuse(`${owner} but this call names ${describeProfile(profile)}.`);
  if (request.organizationId !== undefined && request.organizationId !== organizationId)
    throw refuse(`${owner} but this call targets organization ${request.organizationId}.`);
  if (request.userId !== undefined && request.userId !== userId)
    throw refuse(`${owner} but this call targets user ${request.userId}.`);
  return { userId, organizationId };
};

/** Whose key OHMYHOST_TOKEN is, as the API reports it. */
const readTokenIdentity = async (input: {
  readonly token: string;
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
}): Promise<{ readonly userId: string; readonly organizationId: string | null }> => {
  const identity = parseCurrentIdentity(
    await new GeneratedSdkProductApi(input.baseUrl, input.token, input.fetch).getCurrentIdentity(),
  );
  return {
    userId: identity.actor_id.startsWith("user:") ? identity.actor_id.slice(5) : identity.actor_id,
    organizationId: identity.organization_ids[0] ?? null,
  };
};

/** The organization a command names explicitly; `organization use` names its target instead. */
const commandOrganizationId = (command: ProductCliCommand): string | undefined => {
  if (command.kind === "organization-use" || command.kind === "login") return undefined;
  if (command.kind === "feedback-submit") return command.report.organization_id;
  return "organizationId" in command && typeof command.organizationId === "string"
    ? command.organizationId
    : undefined;
};

const commandProjectId = (command: ProductCliCommand): string | undefined => {
  if (command.kind === "managed-mail") return command.request.projectId;
  return "projectId" in command && typeof command.projectId === "string"
    ? command.projectId
    : undefined;
};

export const runProductionCli = async (
  argv: readonly string[],
  environment: ProductCliEnvironment,
  io: ProductCliIo,
  signal: AbortSignal,
  overrides: ProductCliCompositionOverrides = {},
): Promise<number> => {
  const diagnostics = new StderrDiagnosticSink(io);
  const written = (result: CliResult): number => {
    io.writeStdout(result.stdout);
    if (result.stderr.length > 0) io.writeStderr(result.stderr);
    return result.exitCode;
  };
  let args: readonly string[];
  let profileName: string | undefined;
  try {
    const extracted = extractProfileName(argv);
    args = extracted.argv;
    profileName = extracted.profileName;
  } catch {
    return written(invalidCommandFailure(argv, environment));
  }
  const workingDirectory = overrides.workingDirectory ?? process.cwd();
  let command: ProductCliCommand;
  let linked: Extract<LinkedProject, { outcome: "linked" }> | null;
  let links: DirectoryLinks = { links: [], legacy: null };
  try {
    const parsed = await parseWithLinkedProject(args, async () => {
      let platform: ReturnType<typeof resolveProductCliEnvironment>;
      try {
        platform = resolveProductCliEnvironment(environment);
      } catch {
        return { outcome: "none" };
      }
      links = await readProjectLinks(
        join(workingDirectory, platform.linkDirectory),
        platform.apiOrigin,
      );
      let named = profileName;
      try {
        named ??= environmentProfile(environment);
      } catch {
        // An invalid binding is reported once the command is known.
      }
      const profiles =
        named === undefined
          ? []
          : await (
              overrides.profiles ??
              new NativeKeyringProfileRegistry(undefined, platform.credentialService)
            ).list();
      // The login a command names picks that organization's link of this checkout.
      return chooseLinkedProject(
        links,
        profiles.find((profile) => profile.name === named)?.organizationId ?? undefined,
      );
    });
    command = parsed.command;
    linked = parsed.linked;
    if (linked !== null) io.writeStderr(`ohmyhost: using linked project ${linked.projectId}\n`);
  } catch (error) {
    if (error instanceof LinkedProjectAmbiguousError)
      return written(
        errorDocument(
          recognizedCommandLabel(args),
          2,
          "linked_project_selection_required",
          false,
          `This directory is linked to projects of several organizations (${error.organizationIds.join(", ")}). Pass --project ULID, or choose the login with --profile-name NAME; '${resolveProductCliEnvironment(environment).commandPrefix} profile list --json' shows the saved logins.`,
        ),
      );
    if (error instanceof CredentialStoreUnavailableError)
      return written(
        errorDocument(
          recognizedCommandLabel(args),
          3,
          "credential_store_unavailable",
          false,
          CREDENTIAL_STORE_UNAVAILABLE_ACTION,
        ),
      );
    const result =
      error instanceof InvalidCommandError
        ? invalidCommandFailure(args, environment)
        : errorDocument(
            recognizedCommandLabel(args),
            1,
            "internal_error",
            false,
            INTERNAL_ERROR_ACTION,
          );
    if (!(error instanceof InvalidCommandError)) {
      diagnostics.record({
        correlationId: randomUUID(),
        category: "internal",
        subsystem: "parser",
        errorKind: "unexpected",
      });
    }
    return written(result);
  }
  if (command.kind === "init") {
    if (profileName !== undefined)
      return written(
        errorDocument(
          "init",
          2,
          "invalid_command",
          false,
          "ohmyhost init runs offline and uses no login: remove --profile-name and run it again.",
        ),
      );
    return runOfflineInit(command, io, diagnostics);
  }
  if (command.kind === "help" || command.kind === "version") {
    return written(
      cliMetadataResult(command.kind, command.kind === "help" ? command.topic : undefined),
    );
  }
  let platform: ReturnType<typeof resolveProductCliEnvironment>;
  try {
    platform = resolveProductCliEnvironment(environment);
  } catch {
    return written(
      errorDocument(
        recognizedCommandLabel(args),
        2,
        "invalid_environment",
        false,
        "Set OHMYHOST_ENVIRONMENT to development or production.",
      ),
    );
  }
  let apiToken: string | undefined;
  try {
    apiToken = environmentToken(environment);
  } catch {
    return written(
      errorDocument(
        recognizedCommandLabel(args),
        2,
        "invalid_environment_token",
        false,
        "Set OHMYHOST_TOKEN to a valid user API key, or unset it to use interactive login.",
      ),
    );
  }
  let bound: string | undefined;
  try {
    bound = environmentProfile(environment);
  } catch {
    return written(
      errorDocument(
        recognizedCommandLabel(args),
        2,
        "invalid_profile_binding",
        false,
        `Set OHMYHOST_PROFILE to the name of a saved login ('${platform.commandPrefix} profile list --json'), or unset it.`,
      ),
    );
  }
  if (apiToken !== undefined && (command.kind === "login" || command.kind === "logout")) {
    return written(
      errorDocument(
        recognizedCommandLabel(args),
        2,
        "environment_token_active",
        false,
        "Unset OHMYHOST_TOKEN before changing interactive login credentials. Logout does not revoke a user API key.",
      ),
    );
  }
  // A command handed over from an OHMYHOST_TOKEN process runs only with a key of that account,
  // never with a saved login, even one of the same user.
  const requiredToken = command.kind === "secret-set" ? command.environmentToken : undefined;
  // Either handed form names its account; the login or key that would run it must be exactly that
  // account, so a login of the same name on another computer is refused before anything is read.
  const handedAccount =
    command.kind === "secret-set" ? (requiredToken ?? command.profileAccount) : undefined;
  if (requiredToken !== undefined && apiToken === undefined)
    return written(
      errorDocument(
        recognizedCommandLabel(args),
        2,
        "environment_token_required",
        false,
        `This command runs only with OHMYHOST_TOKEN holding a key of user ${requiredToken.userId} in organization ${requiredToken.organizationId}; a saved login cannot run it. Load that key from its private env file into this process and retry. Nothing was sent.`,
      ),
    );
  const registry =
    overrides.profiles ?? new NativeKeyringProfileRegistry(undefined, platform.credentialService);
  const linkDirectory = join(workingDirectory, platform.linkDirectory);
  const projectId = commandProjectId(command);
  // A command that named its project read no link yet, but the link still says whose project it is.
  if (projectId !== undefined && linked === null)
    links = await readProjectLinks(linkDirectory, platform.apiOrigin);
  // The organization this command is about: named on the command, or recorded by this checkout's
  // link of its project. It narrows the saved logins and is checked against OHMYHOST_TOKEN.
  const organizationId =
    handedAccount?.organizationId ??
    commandOrganizationId(command) ??
    linked?.organizationId ??
    (projectId === undefined ? undefined : linkedOrganization(links, projectId));
  const request = profileRequest(
    {
      ...(profileName === undefined ? {} : { name: profileName }),
      ...(organizationId === undefined || organizationId === null ? {} : { organizationId }),
      ...(handedAccount === undefined ? {} : { userId: handedAccount.userId }),
    },
    bound,
  );
  const transport = new FetchWorkosPublicTransport(signal, REQUEST_TIMEOUT_MS);
  const now = (): Date => new Date();
  const refresher = new PublicWorkosTokenRefresher(environment);
  const boundedFetch = (): typeof globalThis.fetch =>
    createBoundedFetch(fetch, signal, REQUEST_TIMEOUT_MS, MAX_PUBLIC_RESPONSE_BYTES);
  let profile: LocalProfile | undefined;
  try {
    if (apiToken !== undefined) {
      if (command.kind !== "profile-list")
        await verifyEnvironmentTokenContext({
          token: apiToken,
          request,
          registry,
          baseUrl: platform.apiOrigin,
          fetch: boundedFetch(),
        });
      if (linked !== null && linked.organizationId === null)
        await adoptLegacyLink({
          links,
          directory: linkDirectory,
          repositoryRoot: workingDirectory,
          apiOrigin: platform.apiOrigin,
          organizationId: (
            await readTokenIdentity({
              token: apiToken,
              baseUrl: platform.apiOrigin,
              fetch: boundedFetch(),
            })
          ).organizationId,
          accessToken: apiToken,
          fetch: boundedFetch(),
          actor: "OHMYHOST_TOKEN",
          commandPrefix: platform.commandPrefix,
        });
    } else if (command.kind === "logout" && !command.revoke) {
      // Removing a saved login needs no network: it is chosen from the local index alone.
      return await runOfflineLogout(registry, request, platform.commandPrefix, io, diagnostics);
    } else if (command.kind !== "login") {
      // A login adds its own entry and needs nothing else; every other command first moves a
      // login saved before named profiles into one, then chooses among the saved logins.
      const profiles = await loadProfiles(registry, {
        baseUrl: platform.apiOrigin,
        fetch: boundedFetch(),
        signal,
        now,
        refresher,
      });
      if (command.kind !== "profile-list") {
        const selection =
          command.kind === "organization-use"
            ? selectProfileForOrganization(profiles, {
                ...request,
                organizationId: command.organizationId,
              })
            : selectProfile(profiles, request);
        if (selection.outcome !== "selected")
          throw profileSelectionError(selection, request, platform.commandPrefix, "cli");
        profile = selection.profile;
        io.writeStderr(`ohmyhost: acting as ${describeProfile(profile)}\n`);
        if (linked !== null && linked.organizationId === null) {
          const selected = await createAuthenticatedProductTransport(signal, {
            environment,
            profiles: registry,
            request: { name: profile.name },
          });
          await adoptLegacyLink({
            links,
            directory: linkDirectory,
            repositoryRoot: workingDirectory,
            apiOrigin: platform.apiOrigin,
            organizationId: profile.organizationId,
            accessToken: selected.accessToken,
            fetch: selected.fetch,
            actor: `profile ${profile.name}`,
            commandPrefix: platform.commandPrefix,
          });
        }
      }
    }
  } catch (error) {
    const result = compositionFailure(
      recognizedCommandLabel(args),
      error,
      signal,
      platform.commandPrefix,
      profile,
    );
    if (result.exitCode === 1)
      diagnostics.record({
        correlationId: randomUUID(),
        category: "internal",
        subsystem: "authentication",
        errorKind: "unexpected",
      });
    return written(result);
  }
  const selected = profile;
  const productApiOrigin = platform.apiOrigin;
  const lifecycle = new GeneratedSdkSessionRevoker({
    environment,
    profiles: registry,
    ...(selected === undefined ? {} : { request: { name: selected.name } }),
  });
  const cli = new ProductCli({
    ...(apiToken === undefined ? {} : { apiToken }),
    commandPrefix: platform.commandPrefix,
    profiles: registry,
    ...(selected === undefined ? {} : { profile: selected }),
    // A login in a process bound to one saved login renews exactly that one.
    ...((profileName ?? bound) === undefined ? {} : { profileName: profileName ?? bound }),
    ...(bound === undefined ? {} : { profileBinding: bound }),
    deviceFlow: new WorkosDeviceFlowClient(
      {
        clientId: platform.clientId,
        scope: "openid offline_access",
        verificationUri: platform.verificationUri,
      },
      transport,
      { now },
    ),
    deviceAuthorizationPresenter: new StderrDeviceAuthorizationPresenter(io),
    productApi: (accessToken) =>
      new GeneratedSdkProductApi(productApiOrigin, accessToken, boundedFetch()),
    // Login receives read-only identity, workspace and GitHub queries instead of the product surface.
    accountProfile: async (accessToken) =>
      await new GeneratedSdkProductApi(
        productApiOrigin,
        accessToken,
        boundedFetch(),
      ).getAccountProfile(),
    currentIdentity: async (accessToken) =>
      await new GeneratedSdkProductApi(
        productApiOrigin,
        accessToken,
        boundedFetch(),
      ).getCurrentIdentity(),
    githubConnectionStatus: (accessToken, organizationId) =>
      getGithubOrganizationConnection(
        { organization_id: organizationId },
        {
          client: createClient({
            baseUrl: productApiOrigin,
            auth: accessToken,
            throwOnError: true,
            fetch: boundedFetch(),
          }),
          signal,
        },
      ),
    projectLinkStore: new OwnerOnlyProjectLinkStore(linkDirectory, workingDirectory),
    productApiOrigin,
    tokenRefresher: refresher,
    tokenRevoker: lifecycle,
    now,
    waitUntil,
    lifecycleTimeoutMs: REQUEST_TIMEOUT_MS,
    createCorrelationId: randomUUID,
    diagnosticSink: diagnostics,
    operationEventSink: { write: (value) => io.writeStdout(value) },
    readSecretValue:
      overrides.readSecretValue ??
      ((readSignal) => readSecretValueFromStandardInput(process.stdin, readSignal)),
    spawnPsql: runLocalPsql,
  });
  return written(await cli.runCommand(command, signal));
};

/**
 * A link written before links named their organization is used only after the API confirms that
 * the acting account can see its project; it is then rewritten for that organization.
 */
const adoptLegacyLink = async (input: {
  readonly links: DirectoryLinks;
  readonly directory: string;
  readonly repositoryRoot: string;
  readonly apiOrigin: string;
  readonly organizationId: string | null;
  readonly accessToken: string;
  readonly fetch: typeof globalThis.fetch;
  readonly actor: string;
  readonly commandPrefix: string;
}): Promise<void> => {
  const legacy = input.links.legacy;
  if (legacy === null) return;
  const refuse = (): ProfileSelectionError =>
    new ProfileSelectionError(
      "linked_project_organization_mismatch",
      2,
      `This directory's link names project ${legacy.project_id}, which ${input.actor} cannot see${
        input.organizationId === null ? "" : ` in organization ${input.organizationId}`
      }. Nothing was sent to it. Pass --project ULID or --profile-name NAME for the account that owns it, or run '${input.commandPrefix} link' again for this account.`,
    );
  let organizationId: string;
  try {
    const project = await getProject(
      { project_id: legacy.project_id },
      {
        client: createClient({
          baseUrl: input.apiOrigin,
          auth: input.accessToken,
          fetch: input.fetch,
          throwOnError: true,
        }),
      },
    );
    organizationId = project.organization_id;
  } catch (error) {
    if (isProblem(error, "resource_not_found") || isProblem(error, "forbidden")) throw refuse();
    throw error;
  }
  if (organizationId !== input.organizationId) throw refuse();
  await new OwnerOnlyProjectLinkStore(input.directory, input.repositoryRoot).save({
    version: 2,
    api_origin: input.apiOrigin,
    organization_id: organizationId,
    project_id: legacy.project_id,
    installation_id: legacy.installation_id,
    repository_full_name: legacy.repository_full_name,
  });
  await removeLegacyProjectLink(input.directory);
};

/** Failures while choosing the account, before the command itself runs. */
const compositionFailure = (
  command: OutputCommand,
  error: unknown,
  signal: AbortSignal,
  commandPrefix: string,
  profile: LocalProfile | undefined,
): CliResult => {
  if (error instanceof ProfileSelectionError)
    return errorDocument(command, error.exitCode, error.code, false, error.suggestedAction);
  if (error instanceof ProfileLimitError)
    return errorDocument(
      command,
      2,
      "profile_limit_reached",
      false,
      profileLimitAction(commandPrefix),
    );
  if (error instanceof ProductApiAuthenticationError)
    return error.code === "authentication_required"
      ? errorDocument(
          command,
          5,
          "authentication_required",
          false,
          endedLoginAction(commandPrefix, profile),
        )
      : errorDocument(
          command,
          5,
          "token_refresh_failed",
          true,
          refreshFailedAction(commandPrefix, profile),
        );
  return classifyCliFailure(command, error, signal);
};

const runOfflineInit = async (
  command: Extract<ProductCliCommand, { kind: "init" }>,
  io: ProductCliIo,
  diagnostics: DiagnosticSink,
): Promise<number> => {
  try {
    const result = await initializeRepository({
      directory: command.directory,
      ...(command.project === undefined ? {} : { project: command.project }),
      ...(command.root === undefined ? {} : { root: command.root }),
      ...(command.region === undefined ? {} : { region: command.region }),
      dryRun: command.dryRun,
    });
    // A write that is blocked exits 9 through RepositoryInitBlockedError; a dry run reports the
    // same blockers, so it must not read as a clean analysis either.
    const blocked = result.blockers.length > 0;
    io.writeStdout(
      `${JSON.stringify({
        version: 1,
        command: "init",
        status: blocked ? "blocked" : result.status,
        written: result.written,
        applicationRoot: result.applicationRoot,
        applicationRootSource: result.applicationRootSource,
        configuration: {
          path: result.configurationPath,
          sha256: result.configurationSha256,
          yaml: result.configurationYaml,
        },
        inventory: result.inventory,
        compatibility: result.compatibility,
        blockers: result.blockers,
        requirements: result.requirements,
        companion: result.companion,
        // The functions runtime reports its own bindings and packages; dropping it left a
        // storage-enabled functions app with no contract to read at all.
        worker: result.worker,
        runtime: result.runtime,
      })}\n`,
    );
    return blocked ? 9 : 0;
  } catch (error) {
    const known = error instanceof RepositoryInitError;
    diagnostics.record({
      correlationId: randomUUID(),
      category: known ? "configuration" : "internal",
      subsystem: "runtime",
      errorKind: known ? "invalid_response" : "unexpected",
    });
    const code =
      error instanceof RepositoryInitBlockedError
        ? "repository_init_blocked"
        : error instanceof RepositoryInitConflictError
          ? "repository_configuration_exists"
          : known
            ? error.code
            : "internal_error";
    const exitCode = error instanceof RepositoryInitBlockedError ? 9 : known ? 2 : 1;
    const result = errorDocument(
      "init",
      exitCode,
      code,
      false,
      known ? initFailureAction(error) : INTERNAL_ERROR_ACTION,
    );
    io.writeStdout(result.stdout);
    return result.exitCode;
  }
};

/** How to fix one init failure: what went wrong, then the exact next step. */
const initFailureAction = (error: RepositoryInitError): string => {
  if (error instanceof RepositoryInitBlockedError)
    return "Run 'ohmyhost init --dry-run --json' and resolve every reported blocker.";
  if (error instanceof RepositoryInitConflictError)
    return "ohmyhost.yaml already exists and init never overwrites it; that file stays authoritative. Run 'ohmyhost init --dry-run --json' to check it and list blockers, then edit the file by hand. Do not delete it to rerun init.";
  const message = /[.!?]$/u.test(error.message) ? error.message : `${error.message}.`;
  switch (error.code) {
    case "repository_root_required":
      return "Run ohmyhost init from the Git repository root with --root set to the application directory (for example --root website); commit the root ohmyhost.yaml before planning.";
    case "project_name_invalid":
      return "Pass a lowercase deployment slug with '--project', then rerun init.";
    case "application_root_ambiguous":
      return `${message} Run 'ohmyhost init --root DIR --dry-run --json' from the Git repository root with the directory to deploy; ask the customer if it is unclear.`;
    case "application_root_not_found":
    case "application_root_unsupported":
      return `${message} init needs a package.json that depends on next (without vite or @tanstack/react-start), on vite, or on @tanstack/react-start, or a functions app with src/ohmyhost/worker.ts. Pass --root DIR with the app's directory, or fix its package.json, then run init again.`;
    case "application_root_invalid":
    case "application_root_missing":
      return `${message} Pass --root as a path relative to the repository root, for example apps/web.`;
    case "repository_configuration_invalid":
      return `${error.message.replace(/\.$/u, "")}. Fix that, then run 'ohmyhost init --dry-run --json' again; do not delete ohmyhost.yaml.`;
    case "repository_configuration_root_mismatch":
      return error.message;
    default:
      return `${message} Fix that and run 'ohmyhost init --json' again from the Git repository root.`;
  }
};

class FetchWorkosPublicTransport implements WorkosPublicTransport {
  public constructor(
    private readonly parentSignal: AbortSignal,
    private readonly timeoutMs: number,
    private readonly fetcher: typeof globalThis.fetch = fetch,
  ) {}

  public async send(request: WorkosPublicHttpRequest): Promise<WorkosPublicHttpResponse> {
    let response: Response;
    try {
      response = await this.fetcher(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: request.redirect,
        signal: boundedSignal(this.parentSignal, this.timeoutMs),
      });
    } catch (error) {
      if (isAbortOrTimeout(error)) throw error;
      throw new NetworkTransportError();
    }
    let body: string;
    try {
      body = await readBoundedResponseBody(response, MAX_PUBLIC_RESPONSE_BYTES);
    } catch (error) {
      if (
        error instanceof PublicResponseTooLargeError ||
        error instanceof ResponseContractError ||
        isAbortOrTimeout(error)
      ) {
        throw error;
      }
      throw new NetworkTransportError();
    }
    return { status: response.status, body };
  }
}

export class StderrDeviceAuthorizationPresenter implements DeviceAuthorizationPresenter {
  public constructor(private readonly io: ProductCliIo) {}

  public async present(input: {
    readonly verificationUri: string;
    readonly verificationUriComplete?: string;
    readonly userCode: string;
    readonly expiresInSeconds: number;
  }): Promise<void> {
    // The customer needs to know how long they have, and that running out is not the end of it:
    // a code that lapses is replaced here while the sign-in window lasts.
    const validFor = `It is valid for ${String(Math.max(1, Math.round(input.expiresInSeconds / 60)))} minutes; if it lapses, a fresh code appears here.`;
    this.io.writeStderr(
      input.verificationUriComplete === undefined
        ? `Open ${input.verificationUri} and enter code ${input.userCode}. ${validFor}\n`
        : `Open ${input.verificationUriComplete} to sign in; it already carries code ${input.userCode}. Create your account on that page if you do not have one yet. ${validFor}\n`,
    );
  }
}

export class PublicWorkosTokenRefresher implements TokenRefresher {
  private readonly clientId: string;

  public constructor(
    environment: ProductCliEnvironment = {},
    private readonly fetcher: typeof globalThis.fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.clientId = resolveProductCliEnvironment(environment).clientId;
  }

  public async refresh(
    refreshToken: string,
    signal: AbortSignal,
    workosOrganizationId?: string,
  ): Promise<CurrentCredential> {
    if (typeof refreshToken !== "string" || !/^[\u0021-\u007e]{1,16384}$/u.test(refreshToken))
      throw new TokenRefreshRejectedError();
    try {
      const response = await new FetchWorkosPublicTransport(
        signal,
        REQUEST_TIMEOUT_MS,
        this.fetcher,
      ).send({
        url: WORKOS_AUTHKIT_DEVICE_TOKEN_ENDPOINT,
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          // The workspace is a property of the token, so every refresh must ask for it again.
          ...(workosOrganizationId === undefined ? {} : { organization_id: workosOrganizationId }),
        }).toString(),
        redirect: "error",
      });
      const body: unknown = JSON.parse(response.body);
      if (response.status < 200 || response.status >= 300) {
        if (
          response.status === 400 &&
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          body.error === "invalid_grant"
        )
          throw new TokenRefreshRejectedError();
        throw new LifecycleTransportError();
      }
      const tokens = parseDeviceTokens(body);
      if (tokens.tokenType.toLowerCase() !== "bearer") throw new LifecycleTransportError();
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: resolveDeviceTokenExpiresAt(
          tokens.accessToken,
          tokens.expiresInSeconds,
          this.now(),
        ),
      };
    } catch (error) {
      if (error instanceof TokenRefreshRejectedError || isAbortOrTimeout(error)) throw error;
      throw new LifecycleTransportError();
    }
  }
}

export class GeneratedSdkSessionRevoker implements TokenRevoker {
  constructor(private readonly overrides: AuthenticatedProductApiOverrides = {}) {}

  public async revoke(_refreshToken: string, signal: AbortSignal): Promise<void> {
    try {
      const transport = await createAuthenticatedProductTransport(signal, this.overrides);
      const client = createClient({
        baseUrl: transport.baseUrl,
        auth: transport.accessToken,
        fetch: transport.fetch,
        throwOnError: true,
      });
      const result = await revokeCurrentSession(
        { "Idempotency-Key": randomUUID() },
        { client, signal },
      );
      if (result.revoked !== true) throw new LifecycleTransportError();
    } catch (error) {
      if (signal.aborted) throw error;
      throw new LifecycleTransportError();
    }
  }
}

/** This checkout is linked for several organizations and nothing chose one of them. */
export class LinkedProjectAmbiguousError extends Error {
  public constructor(readonly organizationIds: readonly string[]) {
    super("Several organizations' links apply");
    this.name = "LinkedProjectAmbiguousError";
  }
}

/**
 * A command run inside a linked directory may omit --project; the link supplies it. The link is
 * read only when the command needs a project it did not name.
 */
export async function parseWithLinkedProject(
  argv: readonly string[],
  linkedProject: () => Promise<LinkedProject>,
): Promise<{
  readonly command: ProductCliCommand;
  readonly linked: Extract<LinkedProject, { outcome: "linked" }> | null;
}> {
  try {
    return { command: parseProductCliCommand(argv), linked: null };
  } catch (error) {
    if (!(error instanceof InvalidCommandError) || argv.includes("--project")) throw error;
    const linked = await linkedProject();
    if (linked.outcome === "ambiguous")
      throw new LinkedProjectAmbiguousError(linked.organizationIds);
    if (linked.outcome === "none") throw error;
    try {
      return { command: parseProductCliCommand([...argv, "--project", linked.projectId]), linked };
    } catch {
      throw error;
    }
  }
}

class StderrDiagnosticSink implements DiagnosticSink {
  public constructor(private readonly io: ProductCliIo) {}

  public record(event: Parameters<DiagnosticSink["record"]>[0]): void {
    this.io.writeStderr(
      `[ohmyhost:${event.correlationId}] ${event.category}/${event.subsystem}/${event.errorKind}\n`,
    );
  }
}

export const readBoundedResponseBody = async (
  response: Response,
  limit: number,
): Promise<string> => {
  assertDeclaredLength(response, limit);
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new PublicResponseTooLargeError();
    }
    body += decodeUtf8(decoder, chunk.value, true);
  }
  return body + decodeUtf8(decoder, undefined, false);
};

export const createBoundedFetch =
  (
    baseFetch: typeof globalThis.fetch,
    parentSignal: AbortSignal,
    timeoutMs: number,
    responseLimit: number,
  ): typeof globalThis.fetch =>
  async (input, init) => {
    const requestHeaders =
      init?.headers === undefined && input instanceof Request
        ? input.headers
        : new Headers(init?.headers);
    const streaming = requestHeaders.get("accept") === "text/event-stream";
    let response: Response;
    try {
      response = await baseFetch(input, {
        ...init,
        signal: AbortSignal.any(
          [
            parentSignal,
            init?.signal,
            ...(streaming ? [] : [AbortSignal.timeout(timeoutMs)]),
          ].filter(
            (candidate): candidate is AbortSignal => candidate !== null && candidate !== undefined,
          ),
        ),
      });
    } catch (error) {
      if (isAbortOrTimeout(error)) throw error;
      throw new NetworkTransportError();
    }
    return streaming ? response : bufferBoundedResponse(response, responseLimit);
  };

const bufferBoundedResponse = async (response: Response, limit: number): Promise<Response> => {
  assertDeclaredLength(response, limit);
  if (response.body === null) return response;
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Array<Uint8Array> = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new PublicResponseTooLargeError();
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (error instanceof PublicResponseTooLargeError || isAbortOrTimeout(error)) throw error;
    throw new NetworkTransportError();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

const assertDeclaredLength = (response: Response, limit: number): void => {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > limit)
  ) {
    throw new PublicResponseTooLargeError();
  }
};

const decodeUtf8 = (
  decoder: TextDecoder,
  chunk: Uint8Array | undefined,
  stream: boolean,
): string => {
  try {
    return decoder.decode(chunk, { stream });
  } catch {
    throw new ResponseContractError();
  }
};

const waitUntil = async (instant: Date, signal: AbortSignal): Promise<void> => {
  const delay = Math.max(0, instant.getTime() - Date.now());
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => signal.removeEventListener("abort", cancel);
    const complete = (): void => {
      cleanup();
      resolve();
    };
    const cancel = (): void => {
      clearTimeout(timer);
      cleanup();
      reject(signal.reason);
    };
    const timer = setTimeout(complete, delay);
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  });
};

const boundedSignal = (parent: AbortSignal, timeoutMs: number): AbortSignal =>
  AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]);

const isAbortOrTimeout = (error: unknown): boolean =>
  error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError");

/**
 * Remove one saved login without network access. Only the chosen login is removed; a login saved
 * before named profiles is removed only when no named login exists.
 */
const runOfflineLogout = async (
  registry: ProfileRegistry,
  request: ProfileRequest,
  commandPrefix: string,
  io: ProductCliIo,
  diagnostics: StderrDiagnosticSink,
): Promise<number> => {
  let result: CliResult;
  try {
    const selection = selectProfile(await registry.list(), request);
    if (selection.outcome === "selected") {
      await registry.remove(selection.profile);
      result = resultDocument("logout", 0, "logged_out", {
        profile: publicProfile(selection.profile),
      });
    } else if (
      selection.outcome === "none" &&
      request.name === undefined &&
      request.bound === undefined
    ) {
      // Nothing is saved under a name: a login of an earlier client goes, and none is logged out.
      await registry.legacy().clear();
      result = resultDocument("logout", 0, "logged_out");
    } else {
      const failure = profileSelectionError(selection, request, commandPrefix, "cli");
      result = errorDocument(
        "logout",
        failure.exitCode,
        failure.code,
        false,
        failure.suggestedAction,
      );
    }
  } catch {
    diagnostics.record({
      correlationId: randomUUID(),
      category: "credential_store",
      subsystem: "credential_store",
      errorKind: "unavailable",
    });
    result = errorDocument(
      "logout",
      3,
      "credential_store_unavailable",
      false,
      CREDENTIAL_STORE_UNAVAILABLE_ACTION,
    );
  }
  io.writeStdout(result.stdout);
  return result.exitCode;
};

export const readSecretValueFromStandardInput = async (
  input: AsyncIterable<Uint8Array | string>,
  signal: AbortSignal,
): Promise<string> => {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for await (const chunk of input) {
    if (signal.aborted) throw signal.reason;
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    totalBytes += bytes.byteLength;
    if (totalBytes > 5_120) throw new SecretInputError();
    chunks.push(bytes);
  }
  if (signal.aborted) throw signal.reason;
  if (totalBytes === 0) throw new SecretInputError();
  const value = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    value.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new SecretInputError();
  } finally {
    value.fill(0);
  }
};

/** The refused command's usage, with the command prefix of the selected platform environment. */
const invalidCommandFailure = (
  argv: readonly string[],
  environment: ProductCliEnvironment,
): CliResult => {
  let commandPrefix = "ohmyhost";
  try {
    commandPrefix = resolveProductCliEnvironment(environment).commandPrefix;
  } catch {
    // An invalid OHMYHOST_ENVIRONMENT is reported once the command itself is valid.
  }
  return errorDocument(
    recognizedCommandLabel(argv),
    2,
    "invalid_command",
    false,
    invalidCommandAction(argv, commandPrefix),
  );
};

const resultDocument = (
  command: OutputCommand,
  exitCode: number,
  status: string,
  body: Readonly<Record<string, unknown>> = {},
): CliResult => ({
  exitCode,
  stdout: `${JSON.stringify({ version: 1, command, status, ...body })}\n`,
  stderr: "",
});

const errorDocument = (
  command: OutputCommand,
  exitCode: number,
  code: string,
  retryable: boolean,
  suggestedAction: string,
): CliResult => ({
  exitCode,
  stdout: `${JSON.stringify({
    version: 1,
    command,
    status: "error",
    error: {
      code,
      retryable,
      suggested_action: suggestedAction,
    },
  })}\n`,
  stderr: "",
});
