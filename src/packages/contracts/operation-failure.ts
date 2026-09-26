const failures = {
  operation_abandoned: [
    "The operation stopped renewing its execution lease and was ended.",
    "Inspect project status and, when this operation names a deployment_id, its diagnostics with 'ohmyhost deployment logs --project PROJECT_ULID --deployment DEPLOYMENT_ULID --follow --json' or MCP deployment_logs before creating a fresh plan. Keep this operation ID; the expired execution cannot resume.",
  ],
  database_write_rejected: [
    "The database rejected this write; it was not committed.",
    "Inspect the schema and parameter types with database query, then correct the statement and use a new key. Do not reset the database.",
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
    "Inspect the operation events and deployment diagnostics. Include the operation ID when reporting the issue.",
  ],
  build_not_started: [
    "The deployment ended without starting a build.",
    "Create a fresh deployment plan and submit it once with a new idempotency key. Replaying this terminal operation cannot start a build. Report the operation ID if this happens again.",
  ],
  build_failed: [
    "The build did not produce a verified deployable artifact.",
    "Read the BUILD_FAILED diagnostic of this operation's deployment_id with 'ohmyhost deployment logs --project PROJECT_ULID --deployment DEPLOYMENT_ULID --follow --json' or MCP deployment_logs; its excerpt is the tail of the install and build output. Correct that failure and verify the commands for the admitted commit before planning a new deployment.",
  ],
  insufficient_organization_credits: [
    "The organization does not have sufficient available credits for this operation.",
    "Ask the organization owner to top up credits, then create a new deployment plan. Preserve existing data; do not buy a second subscription or repeatedly reconcile this terminal operation.",
  ],
  paid_plan_required: [
    "Transactional mail requires an active Paid plan for this organization.",
    "Activate or renew Paid for the organization, then create a new deployment plan. Replaying this terminal operation cannot enable mail. Do not change application code or reset its database.",
  ],
  database_migration_failed: [
    "The database migrations could not be applied.",
    "Inspect the migration diagnostics and verify the canonical SQL migrations on PostgreSQL. Preserve production data; do not reset the database to retry a deployment.",
  ],
  runtime_candidate_failed: [
    "The deployed candidate failed its runtime checks.",
    "Read the HEALTH_CHECK_FAILED diagnostic of this operation's deployment_id with 'ohmyhost deployment logs --project PROJECT_ULID --deployment DEPLOYMENT_ULID --follow --json' or MCP deployment_logs. Its route must answer 2xx to a cookieless GET without a redirect; status_code and, for owners, excerpt show what it answered. Fix that, often a missing secret or a redirect, then plan a new deployment.",
  ],
  runtime_candidate_rejected: [
    "The runtime rejected the built Worker script.",
    "Check that src/ohmyhost/worker.ts exports its handlers as the default export and imports no framework-only modules, then plan the new commit. Replaying this terminal operation cannot stage the same script.",
  ],
  storage_jurisdiction_conflict: [
    "storage.jurisdiction must equal the project's hosting region.",
    "Set storage.jurisdiction in ohmyhost.yaml to the project's hosting region shown by project status and plan again. A project cannot move its files between regions; do not delete or recreate the project to change it.",
  ],
  provider_state_absent: [
    "Reconciliation confirmed that the required deployment resources are absent.",
    "Create a fresh deployment plan. The original operation is terminal; do not repeatedly reconcile it.",
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
