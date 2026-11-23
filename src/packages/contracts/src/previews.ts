/** Private contracts between Control API, Core and the project preview runtime. */
export type PreviewEnvironment = "dev" | "prod";
export type PreviewState = "cold" | "starting" | "ready" | "sleeping";

/** Assigned by Core at accepted source publication, not inferred from delivery time. */
export interface SourceVersion {
  readonly sourceConnectionId: string;
  readonly sourceGeneration: number;
  readonly sequence: number;
  readonly commitSha: string;
}

/** Only the trusted Control API handles plaintext labels and the encryption keyring. */
export interface PreviewCapabilityEnvelope {
  /** SHA-256 of the canonical ASCII token, encoded as lowercase hex. */
  readonly lookupSha256: string;
  /** Base64url AES-GCM ciphertext including authentication tag. */
  readonly ciphertext: string;
  /** Base64url 96-bit AES-GCM nonce. */
  readonly nonce: string;
  readonly keyVersion: number;
  readonly tokenGeneration: number;
}

export interface PreviewDelegation {
  readonly grantId: string;
  readonly clientId: string;
  readonly consentHash: string;
  readonly action: string;
  readonly authorizationRestriction?: Readonly<{
    actions?: readonly string[];
    organizationIds?: readonly string[];
    projectIds?: readonly string[];
    mailDomainIds?: readonly string[];
  }>;
}

export interface PreviewCustomerScope {
  readonly organizationId: string;
  readonly projectId: string;
  readonly environment: PreviewEnvironment;
  readonly principalId: string;
  readonly delegation?: PreviewDelegation;
}

/** Opaque custody stays inside the trusted runtime and never appears in a public response. */
export interface PreviewBackup {
  readonly handle: string;
  readonly source: SourceVersion;
  readonly expiresAt: string;
}

/** Closed table of reasons a start attempt can fail; Core stores the code, never message text. */
export const PREVIEW_FAILURE_CODES = [
  "source_migration_filename_noncanonical",
  "source_refused",
  "source_configuration_missing",
  "source_unavailable",
  "admission_credits",
  "admission_scope",
  "startup_install_failed",
  "startup_server_not_ready",
  "startup_server_exited",
  "startup_failed",
  "backup_recovery",
  "containment",
  "native_auth_launch_unavailable",
  "native_preparing",
  "paid_plan_required",
] as const;
export type PreviewFailureCode = (typeof PREVIEW_FAILURE_CODES)[number];

/** Closed facts about a failure: at most 1 KiB serialized, never message text or SQL. */
export interface PreviewFailureDetail {
  readonly paths?: string[];
  readonly rule?: string;
  readonly path?: string;
}
export const PREVIEW_FAILURE_DETAIL_MAX_BYTES = 1024;

export interface PreviewFailureRecord {
  readonly code: PreviewFailureCode;
  readonly detail: PreviewFailureDetail | null;
  /** The saved version the failed attempt tried to apply; null when none was selected. */
  readonly sourceSequence: number | null;
  readonly failedAt: string;
}

/** A preview link lives this long from creation; the deadline is immutable. */
export const PREVIEW_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** A retryable failure is not retried before this cool-down has passed. */
export const PREVIEW_RETRY_AFTER_SECONDS = 10;

export interface PreviewRecord {
  readonly previewId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly environment: PreviewEnvironment;
  readonly environmentId: string;
  readonly dataEnvironmentId: string;
  readonly assignmentVersion: number;
  readonly billingEpochId: string;
  readonly ownershipVersion: number;
  readonly lifecycleVersion: number;
  readonly region: "eu" | "us";
  readonly rowVersion: number;
  readonly runtimeGeneration: number;
  readonly tokenGeneration: number;
  readonly authGeneration: number;
  readonly state: PreviewState;
  readonly targetSource: SourceVersion | null;
  readonly appliedSource: SourceVersion | null;
  readonly lastActivityAt: string;
  /** Immutable: creation plus 24 hours. The link stops working here and the next open starts afresh. */
  readonly expiresAt: string;
  /** The typed reason the last start attempt failed; cleared by the next start and by ready. */
  readonly failure: PreviewFailureRecord | null;
  /** Non-null while Dev is entitled; runtime must recheck at this deadline. */
  readonly paidUntil: string | null;
  readonly retirement: "none" | "rotating" | "destroying" | "suspended";
}

/** Returned exclusively to the authorized Control API; never to a guest or a public client. */
export interface PreviewCustomerRecord {
  readonly preview: PreviewRecord;
  readonly capability: PreviewCapabilityEnvelope;
}

export interface PreparePreviewResult {
  readonly environmentId: string;
  readonly preview: PreviewCustomerRecord | null;
}

export interface EnsurePreviewInput extends PreviewCustomerScope {
  readonly environmentId: string;
  readonly previewId: string;
  readonly capability: PreviewCapabilityEnvelope;
}

export interface RotatePreviewInput extends PreviewCustomerScope {
  readonly previewId: string;
  readonly expectedRowVersion: number;
  readonly expectedTokenGeneration: number;
  readonly requestId: string;
  readonly capability: PreviewCapabilityEnvelope;
}

export interface DestroyPreviewInput extends PreviewCustomerScope {
  readonly previewId: string;
  readonly expectedRowVersion: number;
  readonly requestId: string;
}

export interface PreviewRuntimeFence {
  readonly previewId: string;
  readonly runtimeGeneration: number;
  readonly tokenGeneration: number;
}

export interface PreviewRuntimeRecord extends PreviewRecord {
  readonly backup: PreviewBackup | null;
}

/** Control API's deliberately separate capability, including encrypted recovery custody. */
export interface ProductApiPreviewRuntime {
  readInitialGithubCandidate(input: PreviewCustomerScope): Promise<PreviewGithubCandidate | null>;
  acceptInitialGithubSource(
    input: PreviewCustomerScope & {
      readonly sourceConnectionId: string;
      readonly sourceGeneration: number;
      readonly expectedSequence: number;
      readonly branchRef: string;
      readonly configGeneration: number | null;
      readonly observedDefaultBranch: string | null;
      readonly observedHead: string;
    },
  ): Promise<{ readonly sequence: number; readonly accepted: boolean }>;
  readGithubCandidates(input: {
    readonly inboxEventId: string;
    readonly claimId: string;
  }): Promise<readonly PreviewGithubCandidate[]>;
  acceptGithubSource(input: {
    readonly inboxEventId: string;
    readonly claimId: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly sourceConnectionId: string;
    readonly sourceGeneration: number;
    readonly expectedSequence: number;
    readonly branchRef: string;
    readonly configGeneration: number | null;
    readonly observedDefaultBranch: string | null;
    readonly observedHead: string;
  }): Promise<{ readonly sequence: number; readonly accepted: boolean }>;
  prepare(input: PreviewCustomerScope): Promise<PreparePreviewResult>;
  get(input: PreviewCustomerScope): Promise<PreviewCustomerRecord | null>;
  listProjectPendingSources(input: {
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<readonly { readonly previewId: string; readonly sequence: number }[]>;
  ensure(input: EnsurePreviewInput): Promise<PreviewCustomerRecord>;
  rotate(input: RotatePreviewInput): Promise<PreviewCustomerRecord>;
  confirmRotation(input: PreviewRuntimeFence): Promise<void>;
  destroy(input: DestroyPreviewInput): Promise<PreviewRuntimeRecord>;
  confirmDestroy(input: PreviewRuntimeFence): Promise<void>;
}

/** Only this private capability may operate a preview; no recoverable token is exposed. */
export interface ProjectPreviewRuntime {
  listPendingNativePreparations(input: {
    readonly limit: number;
    readonly after?: string;
  }): Promise<
    readonly {
      readonly operationId: string;
      readonly previewId: string;
      readonly sourceSequence: number;
      readonly state: "pending" | "running" | "uncertain";
    }[]
  >;
  getNativePreparationCursor(): Promise<string | null>;
  setNativePreparationCursor(input: {
    readonly expected: string | null;
    readonly next: string | null;
  }): Promise<void>;
  queueNativePreparation(input: {
    readonly fence: PreviewRuntimeFence;
    readonly source: SourceVersion;
    readonly buildPlanSha256: string;
    readonly authProvider: "omh-native";
  }): Promise<PreviewNativePreparation>;
  readNativePreparation(input: {
    readonly previewId: string;
    readonly sourceSequence: number;
  }): Promise<PreviewNativePreparation | null>;
  listCleanupCandidates(input: {
    readonly limit: number;
    readonly after?: string;
  }): Promise<readonly PreviewCleanupCandidate[]>;
  claimScopeCleanup(input: {
    readonly previewId: string;
    readonly expectedRowVersion: number;
  }): Promise<PreviewCleanupState>;
  finishScopeCleanup(
    input: PreviewRuntimeFence & { readonly deletedBackupHandle: string | null },
  ): Promise<void>;
  resumeSuspended(input: {
    readonly previewId: string;
    readonly expectedRowVersion: number;
  }): Promise<PreviewCleanupState>;
  getCleanupState(input: { readonly previewId: string }): Promise<PreviewCleanupState | null>;
  confirmRotation(input: PreviewRuntimeFence): Promise<void>;
  confirmDestroy(input: PreviewRuntimeFence): Promise<void>;
  recordStopped(input: PreviewRuntimeFence): Promise<PreviewRuntimeRecord>;
  recordFailure(
    input: PreviewRuntimeFence & {
      readonly code: PreviewFailureCode;
      readonly detail: PreviewFailureDetail | null;
      readonly sourceSequence: number | null;
    },
  ): Promise<PreviewRuntimeRecord>;
  resolveTokenHash(input: { readonly tokenHash: string }): Promise<PreviewRuntimeRecord | null>;
  authorizeRuntime(input: PreviewRuntimeFence): Promise<PreviewRuntimeRecord | null>;
  authorizeDatabase(input: PreviewRuntimeFence): Promise<{
    readonly preview: PreviewRuntimeRecord;
    readonly binding: PreviewDatabaseRegistration;
  } | null>;
  readSource(input: {
    readonly previewId: string;
    readonly runtimeGeneration: number;
    readonly tokenGeneration: number;
    readonly sequence: number;
  }): Promise<PreviewSourceDescriptor | null>;
  recordState(
    input: PreviewRuntimeFence & {
      readonly expectedRowVersion: number;
      readonly state: PreviewState;
    },
  ): Promise<PreviewRuntimeRecord>;
  recordAppliedSource(
    input: PreviewRuntimeFence & {
      readonly expectedRowVersion: number;
      readonly source: SourceVersion;
    },
  ): Promise<PreviewRuntimeRecord>;
  recordBackup(
    input: PreviewRuntimeFence & {
      readonly expectedRowVersion: number;
      readonly backup: PreviewBackup | null;
    },
  ): Promise<PreviewRuntimeRecord>;
  listBackupCleanup(
    input: PreviewRuntimeFence,
  ): Promise<readonly { readonly cleanupId: string; readonly handle: string }[]>;
  acknowledgeBackupCleanup(
    input: PreviewRuntimeFence & { readonly cleanupId: string; readonly handle: string },
  ): Promise<void>;
  claimExpiredBackup(
    input: PreviewRuntimeFence & { readonly expectedRowVersion: number },
  ): Promise<PreviewRuntimeRecord>;
  renewActivity(
    input: PreviewRuntimeFence & {
      readonly expectedRowVersion: number;
      readonly occurredAt: string;
    },
  ): Promise<PreviewRuntimeRecord>;
  reserveUsage(
    input: PreviewRuntimeFence & {
      readonly expectedRowVersion: number;
      readonly intervalId: string;
      readonly applicationId: string;
      readonly seconds: number;
      readonly holdSequence: number;
      readonly start: boolean;
    },
  ): Promise<PreviewUsageReservation>;
  closeUsage(input: {
    readonly previewId: string;
    readonly runtimeGeneration: number;
    readonly intervalId: string;
    readonly activeMilliseconds: number;
    readonly containerStartAttempted: boolean;
  }): Promise<void>;

  listPendingSources(input: {
    readonly limit: number;
  }): Promise<readonly { readonly previewId: string; readonly sequence: number }[]>;
  acknowledgeSource(input: {
    readonly previewId: string;
    readonly sequence: number;
  }): Promise<void>;
}

/** Server-selected, current source grant; contains no provider credential. */
export interface PreviewSourceDescriptor {
  readonly targetSource: SourceVersion;
  readonly provider: "github" | "managed";
  readonly organizationId: string;
  readonly billingEpochId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly sourceConnectionId: string;
  readonly region: "eu" | "us";
  readonly repository: Readonly<{ owner: string; name: string; externalRepositoryId: string }>;
  readonly grant: Readonly<{
    status: "approved";
    grantId: string;
    organizationId: string;
    billingEpochId: string;
    projectId: string;
    sourceConnectionId: string;
    installationId: number | null;
    repositoryId: number | string;
    owner: string;
    repository: string;
    permission: "contents:read";
    grantedAt: string;
    revokedAt: null;
  }>;
}

export interface PreviewUsageReservation {
  readonly preview: PreviewRuntimeRecord;
  readonly intervalId: string;
  readonly seconds: number;
  readonly quotedMicros: number;
}
export interface PreviewUsageSettlement {
  readonly intervalId: string;
  readonly activeMilliseconds: number;
  readonly cpuMilliseconds: number;
  readonly chargedMicros: number;
}

/** Current PGCF registration; connection credentials remain in the regional database runtime. */
export interface PreviewDatabaseRegistration {
  readonly provider: "pgcf";
  readonly organizationId: string;
  readonly projectId: string;
  readonly physicalEnvironmentId: string;
  readonly region: "eu" | "us";
  readonly operationId: string;
  readonly registrationVersion: number;
  readonly providerProjectId: string;
  readonly databaseId: string;
  readonly originHost: string;
  readonly originDatabase: string;
  readonly originUser: string;
  readonly authorizedEnvironmentIds: readonly string[];
  readonly status: "active" | "revoked";
}

/** Bound only to the trusted provider metering reader, not the preview actor or guest. */
export interface PreviewUsageReporterRuntime {
  getReconciliationCursor(): Promise<PreviewUsageCursor | null>;
  setReconciliationCursor(input: {
    readonly expected: PreviewUsageCursor | null;
    readonly next: PreviewUsageCursor | null;
  }): Promise<void>;
  listUsageForReconciliation(input: {
    readonly limit: number;
    readonly now?: string;
    readonly after?: {
      readonly previewId: string;
      readonly runtimeGeneration: number;
      readonly intervalId: string;
    };
  }): Promise<readonly PreviewUsageSnapshot[]>;
  observeUsage(input: {
    readonly previewId: string;
    readonly runtimeGeneration: number;
    readonly intervalId: string;
    readonly cpuMilliseconds: number;
    readonly observedAt: string;
    readonly providerFactId: string;
  }): Promise<PreviewUsageSettlement>;
}
export interface PreviewUsageSnapshot extends PreviewAwaitingUsage {
  readonly state: "awaiting_provider" | "settled";
  readonly cpuMilliseconds: number | null;
  readonly providerFactId: string | null;
  readonly observedAt: string | null;
}

export interface PreviewAwaitingUsage {
  readonly previewId: string;
  readonly runtimeGeneration: number;
  readonly intervalId: string;
  readonly applicationId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly activeMilliseconds: number;
  readonly startedAt: string;
  readonly closedAt: string;
}

export interface PreviewGithubCandidate {
  readonly organizationId: string;
  readonly projectId: string;
  readonly sourceConnectionId: string;
  readonly sourceGeneration: number;
  readonly expectedSequence: number;
  readonly branchRef: string | null;
  readonly configGeneration: number | null;
  readonly installationId: string;
  readonly repositoryId: string;
  readonly repositoryFullName: string;
}

/** Ciphertext custody is available only to the private Runtime Secret Delivery service. */
export interface PreviewSecretAuthorityRuntime {
  listCustomerSecretNames(input: {
    readonly fence: PreviewRuntimeFence;
  }): Promise<readonly string[]>;
  readEnvelopes(input: {
    readonly fence: PreviewRuntimeFence;
    readonly names: readonly string[];
  }): Promise<{
    readonly preview: PreviewRuntimeRecord;
    readonly envelopes: readonly PreviewSecretEnvelope[];
  }>;
}
export interface PreviewSecretEnvelope {
  readonly organizationId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly name: string;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly valueSha256: Uint8Array;
  readonly keyVersion: number;
  readonly revision: number;
}

export interface PreviewCleanupState {
  readonly previewId: string;
  readonly region: "eu" | "us";
  readonly rowVersion: number;
  readonly runtimeGeneration: number;
  readonly tokenGeneration: number;
  readonly authGeneration: number;
  readonly state: PreviewState;
  readonly retirement: "none" | "rotating" | "destroying" | "suspended";
  readonly hasBackup: boolean;
  readonly backupHandle: string | null;
  readonly backupExpiresAt: string | null;
}

export interface PreviewCleanupCandidate extends PreviewCleanupState {
  readonly reason:
    | "scope"
    | "entitlement"
    | "assignment"
    | "source"
    | "expired"
    | "backup_cleanup"
    | "rotation"
    | "destroy"
    | "lifetime"
    | "resume";
}

export interface PreviewNativePreparation {
  readonly operationId: string;
  readonly claimId: string;
  readonly previewId: string;
  readonly runtimeGeneration: number;
  readonly tokenGeneration: number;
  readonly authGeneration: number;
  readonly state: "pending" | "running" | "uncertain" | "succeeded" | "failed";
  readonly errorCode: string | null;
}

export interface PreviewUsageCursor {
  readonly previewId: string;
  readonly runtimeGeneration: number;
  readonly intervalId: string;
}

export const PREVIEW_NATIVE_POLICY_SCHEMA_VERSION = 1 as const;
export const PREVIEW_NATIVE_POLICY_SCHEMA_SHA256 =
  "567f5ef1b6adc6d3d02b067d8e7886d44c4700e3236e6cac754462feddf4e5f9" as const;

/** Shared source-sync wire types; the framework plan is supplied by the owning platform package. */
export type PreviewSourceOperation =
  | Readonly<{ kind: "delete"; path: string }>
  | Readonly<{
      kind: "write";
      path: string;
      bytes: Uint8Array;
      sha256: string;
      executable: boolean;
    }>;
export interface PreviewSourcePatch {
  readonly from: SourceVersion | null;
  readonly to: SourceVersion;
  readonly operations: readonly PreviewSourceOperation[];
  readonly dependenciesChanged: boolean;
}
export interface PreviewSourceInstall {
  readonly applicationRoot: string;
  readonly manager: "npm" | "pnpm" | "yarn" | "bun";
  readonly version: string;
  readonly lockfile: string;
  readonly command: string;
}
export interface PreviewSourceInspection<FrameworkPlan = unknown> {
  readonly frameworkPlan: FrameworkPlan;
  readonly buildPlanSha256: string;
  readonly companionSource?: Readonly<{
    schemaVersion: "ohmyhost.vite-api-companion/v1" | "ohmyhost.worker-module/v1";
    path: string;
    byteLength: number;
    sha256: string;
  }>;
}
export interface PreviewSourceDelta<FrameworkPlan = unknown> extends PreviewSourcePatch {
  readonly install: PreviewSourceInstall | null;
  readonly inspection: PreviewSourceInspection<FrameworkPlan>;
}

/** What an assistant reads and says for each failure; the code, not text, is what Core stores. */
const PREVIEW_FAILURE_COPY: Readonly<
  Record<
    PreviewFailureCode,
    {
      readonly retryable: boolean;
      readonly say_to_user: string;
      readonly next_step: (detail: PreviewFailureDetail | null, failedAt: string) => string;
    }
  >
> = {
  source_migration_filename_noncanonical: {
    retryable: false,
    say_to_user:
      "Your app could not start because a database file is named in a way the platform does not accept. I am renaming it.",
    next_step: (detail, failedAt) => {
      const renames = suggestMigrationRenames(detail?.paths ?? [], failedAt);
      const named = renames
        .slice(0, 3)
        .map((item) =>
          item.to === null
            ? `move ${item.from} out of the migrations folder`
            : `rename ${item.from} to ${item.to}`,
        )
        .join("; ");
      const more =
        renames.length > 3 ? ` (${renames.length - 3} more files follow the same rule)` : "";
      return `The preview did not start because migration file names must be YYYYMMDDHHMMSS_name.sql: fourteen digits, an underscore, then lowercase letters, digits, _ or -. ${named === "" ? "Rename every file in the migrations folder named in database.migrations." : `${named[0]?.toUpperCase()}${named.slice(1)}${more}.`} Keep the order of the files, save with source_changes, then call preview_open.`;
    },
  },
  source_refused: {
    retryable: false,
    say_to_user:
      "Your app could not start because a file in it does not meet the platform's rules. I am fixing it.",
    next_step: (detail) =>
      `The saved source was refused${detail?.path ? ` in ${detail.path}` : ""}${detail?.rule ? ` (rule ${detail.rule})` : ""}. Fix it, save with source_changes, then call preview_open. deployment_plan on the saved commit prints the full explanation.`,
  },
  source_configuration_missing: {
    retryable: false,
    say_to_user: "Your app is missing its ohmyho.st configuration file. I am adding it.",
    next_step: () =>
      "Add ohmyhost.yaml at the repository root, save with source_changes, then call preview_open.",
  },
  source_unavailable: {
    retryable: true,
    say_to_user: "I could not read your saved app just now. I am trying again.",
    next_step: () =>
      "Wait 10 seconds and call preview_open again. After three failures tell the user the platform could not read the saved source.",
  },
  admission_credits: {
    retryable: false,
    say_to_user:
      "Your workspace has no credits left for the preview. Please add credits and I will start it again.",
    next_step: () =>
      "Tell the user the workspace needs credits (organization_credits_get shows the balance), then call preview_open.",
  },
  admission_scope: {
    retryable: false,
    say_to_user:
      "This preview is not available in that environment for your plan. I am using the right one.",
    next_step: () =>
      "Use the environment the workspace allows: dev for a Paid workspace with a Dev site, otherwise prod.",
  },
  startup_install_failed: {
    retryable: true,
    say_to_user: "Your app's dependencies could not be installed. I am checking them.",
    next_step: () =>
      "The dependency install failed. A lockfile or dependency problem is the likely cause: read package.json and the lockfile and fix them, then save with source_changes and call preview_open. If they are fine, a registry may have been unavailable: call preview_open again in a few seconds.",
  },
  startup_server_not_ready: {
    retryable: true,
    say_to_user: "Your app did not start in time. I am trying once more.",
    next_step: () =>
      "Call preview_open once more. If it repeats, deployment_logs of a Dev deployment or a new deployment_plan shows the build error.",
  },
  startup_server_exited: {
    retryable: true,
    say_to_user: "Your app stopped while starting. I am looking into it.",
    next_step: () =>
      "Call preview_open once more. If it repeats, deployment_logs of a Dev deployment or a new deployment_plan shows the build error.",
  },
  startup_failed: {
    retryable: true,
    say_to_user: "Your preview could not start. I am trying once more.",
    next_step: () =>
      "The start was interrupted. Call preview_open once more. If it repeats, deployment_logs of a Dev deployment or a new deployment_plan shows the build error.",
  },
  backup_recovery: {
    retryable: true,
    say_to_user: "Your preview's saved state needs recovery. I am checking it.",
    next_step: () =>
      "The preview's saved state needs recovery. Wait a minute, call preview_open again, and use feedback_submit if it repeats.",
  },
  containment: {
    retryable: false,
    say_to_user:
      "Your preview cannot start right now because the platform's isolation is unavailable. I am reporting this.",
    next_step: () =>
      "The platform cannot isolate this preview. Tell the user and send feedback_submit.",
  },
  native_auth_launch_unavailable: {
    retryable: false,
    say_to_user:
      "Sign-in is unavailable for this app right now. Please check with the project owner.",
    next_step: () =>
      "Native Auth is unavailable for this project. Tell the user to ask the project owner to check Native Auth access.",
  },
  native_preparing: {
    retryable: true,
    say_to_user: "Sign-in is being prepared. This takes a moment.",
    next_step: () => "Sign-in is being prepared. Wait 10 seconds and call preview_open again.",
  },
  paid_plan_required: {
    retryable: false,
    say_to_user: "Sign-in for this app needs a Paid workspace.",
    next_step: () =>
      "Native Auth requires a Paid workspace. Tell the user to check the workspace plan.",
  },
};

/** The same saved version fails the same way: only a new save can change the outcome. */
const PREVIEW_FAILURES_NEEDING_NEW_SOURCE: ReadonlySet<PreviewFailureCode> = new Set([
  "source_migration_filename_noncanonical",
  "source_refused",
  "source_configuration_missing",
]);
export function previewFailureNeedsNewSource(code: PreviewFailureCode): boolean {
  return PREVIEW_FAILURES_NEEDING_NEW_SOURCE.has(code);
}
export function previewFailureRetryable(code: PreviewFailureCode): boolean {
  return PREVIEW_FAILURE_COPY[code].retryable;
}
export function previewFailureSay(code: string): string | null {
  return Object.hasOwn(PREVIEW_FAILURE_COPY, code)
    ? PREVIEW_FAILURE_COPY[code as PreviewFailureCode].say_to_user
    : null;
}
export function previewFailureNextStep(record: PreviewFailureRecord): string {
  return PREVIEW_FAILURE_COPY[record.code].next_step(record.detail, record.failedAt);
}

/**
 * The exact rename for every refused migration file: same folder, 14-digit UTC timestamp counted
 * up one second per file in path order, then the old name without its numeric prefix. A subfolder
 * the inspector refuses is left, so the file moves up. A file that is not `.sql` has no rename and
 * must leave the folder.
 */
export function suggestMigrationRenames(
  paths: readonly string[],
  at: string,
): readonly { readonly from: string; readonly to: string | null }[] {
  const start = Date.parse(at);
  const base = Number.isFinite(start) ? start : 0;
  let index = 0;
  return [...paths].sort().map((from) => {
    const slash = from.lastIndexOf("/");
    const file = from.slice(slash + 1);
    // A folder the inspector refuses (it must start with a letter or digit) is left: the file moves up.
    const segments = (slash < 0 ? "" : from.slice(0, slash)).split("/");
    const invalid = segments.findIndex((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment));
    const dir = segments
      .slice(0, invalid < 0 ? segments.length : invalid)
      .filter((segment) => segment !== "")
      .map((segment) => `${segment}/`)
      .join("");
    if (!file.toLowerCase().endsWith(".sql")) return { from, to: null };
    const stem = file
      .slice(0, -4)
      .toLowerCase()
      .replace(/^[0-9]+[_-]*/u, "")
      .replace(/[^a-z0-9_-]+/gu, "_")
      .replace(/^[_-]+/u, "")
      .slice(0, 60);
    const stamp = new Date(base + index * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/u, "")
      .replace(/[-:T]/gu, "");
    index += 1;
    return { from, to: `${dir}${stamp}_${stem === "" ? "migration" : stem}.sql` };
  });
}
