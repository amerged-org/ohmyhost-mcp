import {
  frameworkConversionDetail,
  parseFrameworkConversionDiagnostic,
  type FrameworkConversionDiagnostic,
} from "./framework-admission.js";

const failures = {
  authorization_changed: [
    "Authorization changed before this operation could finish.",
    "Read the current project and sign-in status. Reconnect the client or ask the project owner to grant the required access, then submit a new request with a new idempotency key. This terminal operation cannot resume; preserve the project's existing data and deployment.",
  ],
  source_commit_conflict: [
    "Another source change was saved before this version could be committed.",
    "Read the current source and compare it with this operation's original version. Merge both changes, then submit the combined files using the current commit and a new idempotency key. Do not overwrite the remote version or reuse this failed operation.",
  ],
  source_snapshot_invalid: [
    "The uploaded source did not match its complete verified manifest.",
    "Capture a stable source snapshot and start a new upload with a new idempotency key. Verify every file hash, path and size, upload all selected files and seal the complete manifest before deployment. This failed upload cannot be published.",
  ],
  source_upload_expired: [
    "The source upload expired before it was committed.",
    "Read the current source version, capture the intended files again and start a new upload with a new idempotency key. Complete every file upload and seal the manifest before expiry. The expired upload cannot be deployed.",
  ],
  operation_abandoned: [
    "ohmyho.st stopped this operation before it finished and ended it.",
    "Repeating this operation cannot resume it. Read project status for what is live; if this operation names a deployment_id, read 'ohmyhost deployment logs --project PROJECT_ULID --deployment DEPLOYMENT_ULID --json' or MCP deployment_logs. Then submit the request once more with a new idempotency key: a deployment, promotion, rollback, deletion or data change from a fresh plan, a rename with the ETag from project status. If it ends the same way, report both operation IDs through feedback.",
  ],
  database_write_rejected: [
    "The database rejected this write; it was not committed.",
    "The statement failed on PostgreSQL, ran or waited for a lock longer than 5 seconds, affected more than 1,000 rows, or was not one INSERT, UPDATE or DELETE. Check table, column and parameter types with database query, split a large change into batches of at most 1,000 rows, then submit with a new key. Nothing was committed; do not reset the database.",
  ],
  database_write_unavailable: [
    "The database write could not start.",
    "Read project status and database compute. This operation did not write data; after fixing availability, submit a new confirmed request.",
  ],
  database_write_outcome_unknown: [
    "The database write outcome could not be confirmed.",
    "Do not repeat the write with a new key. Inspect the target data with a read query and retain this operation ID. The same key only reads this receipt.",
  ],
  database_compute_failed: [
    "The database provider refused the size change or had no room for it. The database keeps its previous size and keeps running, and no credits are charged for the failed change.",
    "Read the current size with 'ohmyhost database compute get --project PROJECT_ULID --environment dev|prod --json' or MCP database_compute_get, then repeat the change with a new idempotency key; the old key only returns this failure. If it fails again after a few minutes, start a new deployment of the project, repeat the change and report this operation ID through feedback. Never reset the database to change its size.",
  ],
  database_compute_plan_changed: [
    "Paid access ended before the database size change started, so it was not sent to the database provider. The database keeps its previous size and keeps running, and no credits are charged for the change.",
    "Read the organization's plan with 'ohmyhost credits account --organization ORGANIZATION_ULID --json' or MCP organization_account_get. Sizes above 256 MiB need active Paid: ask the organization Owner to activate Paid through billing checkout, then read the current size with database compute get and repeat the change with a new idempotency key.",
  ],
  database_compute_rejected: [
    "The database size change could not be started.",
    "Read current compute and report this operation ID through feedback. Preserve existing data. After the provider problem is resolved, submit a new confirmed size change.",
  ],

  database_migrate_failed: [
    "The database migration files were not applied; none of the files of this request took effect.",
    "Read error.migration.file and error.migration.reason. Preserve the database and keep applied files unchanged. Fix the pending migration using the function and trigger replacement rules at https://docs.ohmyho.st/migrations. Save the corrected source with source_changes and run database_migrate again with its commit_sha and a new idempotency key.",
  ],
  database_migrate_unavailable: [
    "The database could not be created or migrated in time; nothing from this request was left half applied.",
    "Call database_migrate again with the same commit_sha and a new idempotency key: files that were applied are skipped. If it fails again, report this operation ID through feedback.",
  ],
  recovery_dispatch_failed: [
    "The export executor could not confirm completion after bounded delivery attempts.",
    "Report the export operation ID through feedback. Check the original status before requesting another export after next_request_at.",
  ],
  recovery_job_failed: [
    "The SQL export could not be completed.",
    "Inspect the export status and report its operation ID through feedback. A new export is available after next_request_at.",
  ],
  recovery_input_expired: [
    "The export did not start before its temporary password input expired.",
    "The password input was discarded. Request a new export after next_request_at and report the delayed operation ID.",
  ],
  recovery_database_unavailable: [
    "A read-only database snapshot could not be obtained.",
    "Check database readiness through project status. Preserve existing data and report the export operation ID.",
  ],
  recovery_checksum_mismatch: [
    "The stored export did not match its verified ciphertext receipt.",
    "Do not use this archive. Report the export operation ID; request a new export after next_request_at.",
  ],
  recovery_scope_unavailable: [
    "The project was frozen, transferred or deleted before the export completed.",
    "Check the current project and organization access before requesting another export.",
  ],
  recovery_archive_too_large: [
    "The SQL export exceeds the current 256 MiB plaintext limit.",
    "Report the required export size through feedback. No incomplete archive is offered for download.",
  ],
  operation_failed: [
    "The operation failed.",
    "Read project status and, if this operation names a deployment_id, its diagnostics with 'ohmyhost deployment logs --project PROJECT_ULID --deployment DEPLOYMENT_ULID --json' (next page: --cursor <next_cursor>). Without one (a source link or project creation), check project status or project list, then repeat that command once with a new idempotency key. If it fails again, report the operation ID through feedback.",
  ],
  build_not_started: [
    "The deployment ended without starting a build.",
    "Create a fresh deployment plan and submit it once with a new idempotency key. Replaying this terminal operation cannot start a build. Report the operation ID if this happens again.",
  ],
  build_failed: [
    "The build did not produce a verified deployable artifact.",
    "Read the BUILD_FAILED item of its deployment_id with 'ohmyhost deployment logs --project PROJECT_ULID --deployment DEPLOYMENT_ULID --json' or MCP deployment_logs. Its excerpt shows install and build output: fix that error, save or push the corrected version and plan its commit. Without an excerpt the build printed nothing, passed the 8-minute limit or failed inside ohmyho.st: plan the same commit once more, and report the operation ID through feedback if it fails again.",
  ],
  insufficient_organization_credits: [
    "The organization does not have sufficient available credits for this operation.",
    "Ask the organization owner to top up credits, then create a new deployment plan. Preserve existing data; do not buy a second subscription or repeatedly reconcile this terminal operation.",
  ],
  project_budget_exceeded: [
    "The project's Stop budget prevents this deployment.",
    "This project's Stop budget for the current UTC month was reached; no build started. Read 'ohmyhost budget get --project ULID --json'. Ask the organization Owner to change the limit or mode only if they want to allow more spending; otherwise wait for the next UTC month. Then plan and deploy again or send a new push. Replaying this terminal operation cannot start a build.",
  ],
  paid_plan_required: [
    "Transactional mail requires an active Paid plan for this organization.",
    "Ask the organization Owner to activate Paid through billing checkout; top-ups and signup credits do not activate it. Then plan the same deployment or promotion again. If the app should send no mail, instead set mail.enabled to false in ohmyhost.yaml, save or push the corrected version and plan its commit. Replaying this operation cannot enable mail. Do not reset the database.",
  ],
  database_migration_failed: [
    "The database migrations were not applied; none of this deployment's new migration files took effect.",
    "Read error.migration.file and error.migration.reason. Run 'ohmyhost deployment logs --project PROJECT_ULID --deployment DEPLOYMENT_ULID --json' for the diagnostic. Preserve the database and keep applied files unchanged. Fix the pending migration using https://docs.ohmyho.st/migrations. Run 'ohmyhost init --dry-run --json', then save or push the corrected source and plan its commit.",
  ],
  runtime_candidate_failed: [
    "The deployed candidate failed its runtime checks.",
    "Read the HEALTH_CHECK_FAILED item with 'ohmyhost deployment logs --project PROJECT_ULID --deployment DEPLOYMENT_ULID --json' or MCP deployment_logs. ohmyhost.yaml runtime.healthcheck (default /) must answer 2xx to a cookieless GET without redirect; status_code and, for owners, excerpt show the answer. After promotion or rollback, fix the environment's secrets and plan again; otherwise fix the app, save or push the corrected version and plan its commit. No item: plan once, then report.",
  ],
  runtime_candidate_rejected: [
    "The runtime refused to load the built Worker.",
    "The built Worker could not be loaded: top-level code throws or calls fetch, timers or random values outside a handler, an import cannot be resolved, a Worker module such as src/ohmyhost/companion.ts has no default export, or the bundle is too large. Fix that, save or push the corrected version and plan its commit; replaying this operation cannot pass. If none of this applies, report the operation ID through feedback.",
  ],
  native_auth_launch_unavailable: [
    "Native Auth rollout access is unavailable for this project.",
    "Ask ohmyho.st support to check Native Auth rollout access for this workspace and project. Once access is enabled, plan the saved commit again. Then check the project’s Paid access, verified sender and approved application origin.",
  ],
  storage_jurisdiction_conflict: [
    "storage.jurisdiction must match the project's recorded storage jurisdiction.",
    "Run 'ohmyhost project context --project ULID --json'. Set storage.jurisdiction in ohmyhost.yaml to its recorded value (us or eu). Existing buckets and reservations keep their jurisdiction after a project-region migration. New storage without a recorded bucket uses the project region. If the value is unavailable, report the request ID through feedback. Save or push the correction and plan its commit. For promotion, deploy it to Dev and promote again. Keep the existing project and files.",
  ],
  provider_state_absent: [
    "Reconciliation confirmed that the required deployment resources are absent.",
    "Create a fresh deployment plan. The original operation is terminal; do not repeatedly reconcile it.",
  ],
  auto_deploy_plan_rejected: [
    "The GitHub push could not be planned for deployment.",
    "Read error.detail: it names the file, the rule and the required change. Make that change, commit and push it; the next push is planned again. Without error.detail, plan the pushed commit explicitly with 'ohmyhost plan --project ULID --commit SHA --json' or MCP deployment_plan to read the reason. Replaying this failed operation cannot start a build.",
  ],
  auto_deploy_repository_renamed: [
    "The GitHub repository was renamed after this project linked it, so the pushed commit was not deployed.",
    "Re-link the repository under its current name: run 'ohmyhost link --project PROJECT_ULID --repository-owner OWNER --repository-name NAME --idempotency-key KEY1 --json', then enable auto-deploy again with 'ohmyhost source auto-deploy set --project PROJECT_ULID --branch BRANCH --enabled true --idempotency-key KEY2 --json' and push again. Use a new idempotency key for each. Replaying this failed operation cannot deploy the commit.",
  ],
  promotion_source_stale: [
    "The Dev deployment changed before promotion could start.",
    "Read the current Dev deployment with 'ohmyhost project status --project ULID --json', then run 'ohmyhost deployment promote plan' for that succeeded deployment and confirm the new plan. Replaying this terminal promotion cannot select another source.",
  ],
  promotion_target_stale: [
    "The Prod deployment changed before promotion could start.",
    "Read current Prod status, run 'ohmyhost deployment promote plan' again and confirm it with the new resource_etag and confirmation_token. Replaying this terminal operation cannot replace its stale target.",
  ],
  project_handle_taken: [
    "The requested project handle was taken before the rename could finish. The project keeps its current handle.",
    "Run 'ohmyhost project handle check --handle NAME --json' or MCP project_handle_check, choose a handle that is still free, then submit the rename again with the current ETag and a new idempotency key. Replaying this terminal operation cannot take the handle.",
  ],
  managed_source_dispatch_failed: [
    "The managed source change was uploaded and sealed, but processing it did not finish after repeated attempts (the processing time limit or a service error), so it was ended and nothing was committed.",
    "Read the current source to confirm it did not change, then submit the change again with a new idempotency key. If it fails again, report this operation id to support.",
  ],
} as const;

export interface PublicOperationFailure {
  readonly code: keyof typeof failures;
  readonly message: string;
  readonly retryable: false;
  readonly suggested_action: string;
  /** The catalog sentence naming the refused file and its fix, only for an auto-deploy rejection. */
  readonly detail?: string;
  readonly migration?: MigrationFailureDiagnostic;
}

export interface MigrationFailureDiagnostic {
  readonly reason: "catalog_changed" | "execution_failed" | "ledger_conflict" | "not_admitted";
  readonly file: string | null;
  readonly statement_index?: number;
  readonly sqlstate?: string;
}
export type OperationFailureDiagnostic = FrameworkConversionDiagnostic | MigrationFailureDiagnostic;

/** Each diagnostic variant validates its exact closed shape before crossing a read boundary. */
export function parseOperationFailureDiagnostic(value: unknown): OperationFailureDiagnostic | null {
  return parseFrameworkConversionDiagnostic(value) ?? parseMigrationFailureDiagnostic(value);
}

/** Closed metadata only: PostgreSQL messages, SQL and parameters are never public diagnostics. */
export function parseMigrationFailureDiagnostic(value: unknown): MigrationFailureDiagnostic | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (
    Object.keys(r).some(
      (key) => !["reason", "file", "statement_index", "sqlstate"].includes(key),
    ) ||
    !["catalog_changed", "execution_failed", "ledger_conflict", "not_admitted"].includes(
      String(r["reason"]),
    ) ||
    !(
      r["file"] === null ||
      (typeof r["file"] === "string" &&
        r["file"].length <= 512 &&
        /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*\d{14}_[a-z0-9][a-z0-9_-]*\.sql$/u.test(r["file"]))
    )
  )
    return null;
  const ordinal = r["statement_index"],
    state = r["sqlstate"];
  if (
    (Object.hasOwn(r, "statement_index") && ordinal === undefined) ||
    (Object.hasOwn(r, "sqlstate") && state === undefined)
  )
    return null;
  if (
    (ordinal === undefined) !== (state === undefined) ||
    (ordinal !== undefined &&
      (r["reason"] !== "execution_failed" ||
        r["file"] === null ||
        typeof ordinal !== "number" ||
        !Number.isSafeInteger(ordinal) ||
        ordinal < 1)) ||
    (state !== undefined &&
      (ordinal === undefined ||
        typeof state !== "string" ||
        !/^[0-9A-Z]{5}$/u.test(state) ||
        state.startsWith("08") ||
        /^57P0[123]$/u.test(state)))
  )
    return null;
  return Object.freeze({
    reason: r["reason"] as MigrationFailureDiagnostic["reason"],
    file: r["file"] as string | null,
    ...(ordinal === undefined ? {} : { statement_index: ordinal as number }),
    ...(state === undefined ? {} : { sqlstate: state as string }),
  });
}

export const operationReconciliationCauses = {
  PROVIDER_OBSERVATION_UNCERTAIN: {
    failing_step: "provider_verification",
    cause: "provider_observation_uncertain",
  },
  PHYSICAL_WORKFLOW_TERMINAL: { failing_step: "workflow_execution", cause: "workflow_ended" },
  DELIVERY_UNCONFIRMED: { failing_step: "dispatch", cause: "delivery_unconfirmed" },
} as const;

export interface OperationReconciliationObservation {
  readonly state: "required" | "pending";
  readonly attempt_id: string | null;
  readonly observed_at: string;
  readonly recovery?: {
    readonly failing_step:
      | "provider_verification"
      | "workflow_execution"
      | "dispatch"
      | "workflow_recovery";
    readonly cause:
      | "provider_observation_uncertain"
      | "workflow_ended"
      | "delivery_unconfirmed"
      | "unknown";
    readonly can_reconcile: boolean;
  };
}

export interface PublicOperationReconciliation
  extends Omit<OperationReconciliationObservation, "recovery"> {
  readonly suggested_action: string;
  readonly code?: "reconciliation_required";
  readonly failing_step?: NonNullable<
    OperationReconciliationObservation["recovery"]
  >["failing_step"];
  readonly cause?: NonNullable<OperationReconciliationObservation["recovery"]>["cause"];
  readonly can_reconcile?: boolean;
}

/** Reconciliation is an observation, not a terminal operation event or provider error. */
export function publicOperationReconciliation(
  observation: OperationReconciliationObservation,
): PublicOperationReconciliation {
  if (
    !["required", "pending"].includes(observation.state) ||
    !Number.isFinite(Date.parse(observation.observed_at)) ||
    new Date(observation.observed_at).toISOString() !== observation.observed_at ||
    (observation.state === "required"
      ? observation.attempt_id !== null
      : typeof observation.attempt_id !== "string" ||
        !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(observation.attempt_id))
  )
    throw new TypeError("Operation reconciliation observation is invalid");
  const recovery = observation.state === "required" ? observation.recovery : undefined;
  return Object.freeze({
    state: observation.state,
    attempt_id: observation.attempt_id,
    observed_at: observation.observed_at,
    ...(recovery === undefined ? {} : { code: "reconciliation_required" as const, ...recovery }),
    suggested_action:
      observation.state === "required"
        ? recovery?.can_reconcile === false
          ? "Submit feedback with this operation ID. Do not submit another deployment or data change."
          : "Confirm reconciliation of this same operation with POST /v1/operations/{operation_id}:reconcile; preserve its existing build, data and resources. Do not submit another deployment or data change."
        : "Reconciliation is running. Poll this same operation after 60 seconds; do not start another reconciliation or deployment.",
  });
}

export function parsePublicOperationReconciliation(value: unknown): PublicOperationReconciliation {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Invalid reconciliation guidance");
  const record = value as Record<string, unknown>;
  const {
    state,
    attempt_id,
    observed_at,
    suggested_action,
    code,
    failing_step,
    cause,
    can_reconcile,
  } = record;
  const hasRecovery = code !== undefined;
  if (
    Object.keys(record).sort().join(",") !==
      (hasRecovery
        ? "attempt_id,can_reconcile,cause,code,failing_step,observed_at,state,suggested_action"
        : "attempt_id,observed_at,state,suggested_action") ||
    (state !== "required" && state !== "pending") ||
    typeof observed_at !== "string" ||
    (attempt_id !== null && typeof attempt_id !== "string") ||
    (hasRecovery &&
      (state !== "required" ||
        code !== "reconciliation_required" ||
        typeof can_reconcile !== "boolean" ||
        ![
          ...Object.values(operationReconciliationCauses),
          { failing_step: "workflow_recovery", cause: "unknown" },
        ].some((known) => known.failing_step === failing_step && known.cause === cause)))
  )
    throw new TypeError("Invalid reconciliation guidance");
  const recovery = hasRecovery
    ? ({ failing_step, cause, can_reconcile } as OperationReconciliationObservation["recovery"])
    : undefined;
  const parsed = publicOperationReconciliation({
    state,
    attempt_id,
    observed_at,
    ...(recovery === undefined ? {} : { recovery }),
  });
  if (parsed.suggested_action !== suggested_action)
    throw new TypeError("Invalid reconciliation guidance");
  return parsed;
}

/**
 * Render only reviewed text; never return the internal/provider error message. A stored framework
 * conversion diagnostic of an auto-deploy rejection is re-rendered from the catalog as `detail`.
 */
export function publicOperationFailure(
  internalCode: string,
  diagnostic?: unknown,
): PublicOperationFailure {
  const normalized = internalCode.toLowerCase();
  const code = Object.hasOwn(failures, normalized)
    ? (normalized as keyof typeof failures)
    : "operation_failed";
  const [message, suggested_action] = failures[code];
  const detail =
    code === "auto_deploy_plan_rejected" ? frameworkConversionDetail(diagnostic) : null;
  const migration =
    code === "database_migration_failed" || code === "database_migrate_failed"
      ? parseMigrationFailureDiagnostic(diagnostic)
      : null;
  return Object.freeze({
    code,
    message,
    retryable: false,
    suggested_action,
    ...(detail === null ? {} : { detail }),
    ...(migration === null ? {} : { migration }),
  });
}
