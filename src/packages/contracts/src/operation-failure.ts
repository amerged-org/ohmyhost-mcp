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
    "Repeating this operation cannot resume it. Read project status for what is live; if this operation names a deployment_id, read 'ohmyhost deployment logs --project PROJECT_ULID --deployment DEPLOYMENT_ULID --follow --json' or MCP deployment_logs. Then submit the request once more with a new idempotency key: a deployment, promotion, rollback or deletion from a fresh plan, a rename with the ETag from project status. If it ends the same way, report both operation IDs through feedback.",
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
    "The database size change failed at the provider.",
    "Read the current database compute and report this operation ID through feedback. Preserve data; do not reset or redeploy the database to repair its size.",
  ],
  database_compute_plan_changed: [
    "Paid access ended before the database size change started.",
    "Read the organization's plan and current database compute, then confirm a new standard-size request. This operation did not resize the database.",
  ],
  database_compute_rejected: [
    "The database size change could not be started.",
    "Read current compute and report this operation ID through feedback. Preserve existing data. After the provider problem is resolved, submit a new confirmed size change.",
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
    "Read project status and, if this operation names a deployment_id, its diagnostics with 'ohmyhost deployment logs --project PROJECT_ULID --deployment DEPLOYMENT_ULID --follow --json'. Without one (a source link or project creation), check project status or project list, then repeat that command once with a new idempotency key. If it fails again, report the operation ID through feedback.",
  ],
  build_not_started: [
    "The deployment ended without starting a build.",
    "Create a fresh deployment plan and submit it once with a new idempotency key. Replaying this terminal operation cannot start a build. Report the operation ID if this happens again.",
  ],
  build_failed: [
    "The build did not produce a verified deployable artifact.",
    "Read the BUILD_FAILED item of its deployment_id with 'ohmyhost deployment logs --project PROJECT_ULID --deployment DEPLOYMENT_ULID --follow --json' or MCP deployment_logs. Its excerpt shows install and build output: fix that error, save or push the corrected version and plan its commit. Without an excerpt the build printed nothing, passed the 8-minute limit or failed inside ohmyho.st: plan the same commit once more, and report the operation ID through feedback if it fails again.",
  ],
  insufficient_organization_credits: [
    "The organization does not have sufficient available credits for this operation.",
    "Ask the organization owner to top up credits, then create a new deployment plan. Preserve existing data; do not buy a second subscription or repeatedly reconcile this terminal operation.",
  ],
  paid_plan_required: [
    "Transactional mail requires an active Paid plan for this organization.",
    "Ask the organization Owner to activate Paid through billing checkout; top-ups and signup credits do not activate it. Then plan the same deployment or promotion again. If the app should send no mail, instead set mail.enabled to false in ohmyhost.yaml, save or push the corrected version and plan its commit. Replaying this operation cannot enable mail. Do not reset the database.",
  ],
  database_migration_failed: [
    "The database migrations were not applied; none of this deployment's new migration files took effect.",
    "Read the DATABASE_MIGRATION_FAILED item in 'ohmyhost deployment logs --project PROJECT_ULID --deployment DEPLOYMENT_ULID --follow --json' and fix what it names; run 'ohmyhost init --dry-run --json' for migration_sql_not_admitted. Keep applied files unchanged, give new files later timestamps, and add to existing tables only nullable columns without default and non-unique indexes. Save or push the corrected version and plan its commit; never reset the database.",
  ],
  runtime_candidate_failed: [
    "The deployed candidate failed its runtime checks.",
    "Read the HEALTH_CHECK_FAILED item with 'ohmyhost deployment logs --project PROJECT_ULID --deployment DEPLOYMENT_ULID --follow --json' or MCP deployment_logs. ohmyhost.yaml runtime.healthcheck (default /) must answer 2xx to a cookieless GET without redirect; status_code and, for owners, excerpt show the answer. After promotion or rollback, fix the environment's secrets and plan again; otherwise fix the app, save or push the corrected version and plan its commit. No item: plan once, then report.",
  ],
  runtime_candidate_rejected: [
    "The runtime refused to load the built Worker.",
    "The built Worker could not be loaded: top-level code throws or calls fetch, timers or random values outside a handler, an import cannot be resolved, a Worker module such as src/ohmyhost/companion.ts has no default export, or the bundle is too large. Fix that, save or push the corrected version and plan its commit; replaying this operation cannot pass. If none of this applies, report the operation ID through feedback.",
  ],
  storage_jurisdiction_conflict: [
    "storage.jurisdiction must equal the project's hosting region.",
    "Set storage.jurisdiction in ohmyhost.yaml to the project's region (us or eu) shown by 'ohmyhost project status', save or push the corrected version, then plan its commit (for a promotion, deploy it to Dev and promote again); the unchanged commit fails again. A project cannot move its files between regions; do not delete or recreate the project to change it.",
  ],
  provider_state_absent: [
    "Reconciliation confirmed that the required deployment resources are absent.",
    "Create a fresh deployment plan. The original operation is terminal; do not repeatedly reconcile it.",
  ],
  auto_deploy_plan_rejected: [
    "The GitHub push could not be planned for deployment.",
    "Read project status and the operation's error or deployment diagnostics. Correct the source or configuration named there, push the new commit and plan it before deploying. Replaying this failed operation cannot start a build.",
  ],
  promotion_source_stale: [
    "The Dev deployment changed before promotion could start.",
    "Read the current Dev deployment with 'ohmyhost project status --project ULID --json', then run 'ohmyhost deployment promote plan' for that succeeded deployment and confirm the new plan. Replaying this terminal promotion cannot select another source.",
  ],
  promotion_target_stale: [
    "The Prod deployment changed before promotion could start.",
    "Read current Prod status, run 'ohmyhost deployment promote plan' again and confirm it with the new resource_etag and confirmation_token. Replaying this terminal operation cannot replace its stale target.",
  ],
} as const;

export interface PublicOperationFailure {
  readonly code: keyof typeof failures;
  readonly message: string;
  readonly retryable: false;
  readonly suggested_action: string;
}

export interface OperationReconciliationObservation {
  readonly state: "required" | "pending";
  readonly attempt_id: string | null;
  readonly observed_at: string;
}

export interface PublicOperationReconciliation extends OperationReconciliationObservation {
  readonly suggested_action: string;
}

/** Reconciliation is an observation, not a terminal operation event or provider error. */
export function publicOperationReconciliation(
  observation: OperationReconciliationObservation,
): PublicOperationReconciliation {
  if (
    !["required", "pending"].includes(observation.state) ||
    !Number.isFinite(Date.parse(observation.observed_at)) ||
    (observation.state === "required"
      ? observation.attempt_id !== null
      : typeof observation.attempt_id !== "string" ||
        !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(observation.attempt_id))
  )
    throw new TypeError("Operation reconciliation observation is invalid");
  return Object.freeze({
    state: observation.state,
    attempt_id: observation.attempt_id,
    observed_at: observation.observed_at,
    suggested_action:
      observation.state === "required"
        ? "Confirm reconciliation of this same operation; preserve its existing build and resources. Do not submit another deployment."
        : "Reconciliation is running. Poll this same operation after 60 seconds; do not start another reconciliation or deployment.",
  });
}

/** Render only reviewed text; never return the internal/provider error message. */
export function publicOperationFailure(internalCode: string): PublicOperationFailure {
  const normalized = internalCode.toLowerCase();
  const code = Object.hasOwn(failures, normalized)
    ? (normalized as keyof typeof failures)
    : "operation_failed";
  const [message, suggested_action] = failures[code];
  return Object.freeze({ code, message, retryable: false, suggested_action });
}
