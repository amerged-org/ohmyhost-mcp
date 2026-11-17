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
