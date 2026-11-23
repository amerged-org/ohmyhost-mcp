/** Canonical public status, retry policy and recovery text shared by the API and clients. */
export interface ProblemChatGuidance {
  readonly side: "yours" | "ours" | "not_set_up";
  readonly next_step: string;
  readonly not_helpful?: string;
  readonly say_to_user?: string;
}

export const PROBLEM_POLICY = {
  preview_version_conflict: {
    side: "yours",
    next_step:
      "Read preview_get for the current preview version before retrying the requested change.",
    status: 409,
    retryable: true,
    action:
      "Read the preview state, then repeat the original request with the same idempotency key.",
    title: "Preview changed",
  },
  source_generation_conflict: {
    side: "yours",
    next_step:
      "The source binding changed since you last read it. Read source_get with include_binding and repeat the save with the current generation and commit.",
    status: 409,
    retryable: false,
    action:
      "Read the project's current source and generation, reconcile any source switch, then prepare a new request.",
    title: "Source binding changed",
  },
  source_commit_conflict: {
    side: "yours",
    next_step:
      "Read source_get and source_diff to compare the current saved version with your changes, then save the merged files with source_changes against that exact version.",
    status: 409,
    retryable: false,
    action:
      "Read the current managed version and its changes, reconcile them with your working files, then publish against that exact commit.",
    title: "Source version changed",
  },
  source_upload_conflict: {
    side: "yours",
    next_step:
      "Read source_upload and operation_get for the original upload. If an earlier save is still finishing, check source_get and continue if it already contains your change, otherwise repeat the unchanged request with the same key.",
    not_helpful: "Changing the manifest or request body while reusing the same key will not help.",
    status: 409,
    retryable: false,
    action:
      "Read the existing upload and operation. Reuse a key only for its original request; complete its original manifest or start a new upload.",
    title: "Source upload conflicts",
  },
  source_upload_expired: {
    side: "yours",
    next_step:
      "Read source_get to verify the current binding. Start a fresh upload with source_upload_prepare on remote MCP, or use source_publish for a local snapshot.",
    status: 409,
    retryable: false,
    action: "Start a fresh source upload and transfer the verified snapshot again.",
    title: "Source upload expired",
  },
  source_scope_unavailable: {
    side: "yours",
    next_step:
      "Use identity_get and project_status to check whether this connection can see the project, then read source_get for that project.",
    status: 404,
    retryable: false,
    action: "Check the selected account, workspace, project and client permissions.",
    title: "Source is unavailable",
  },
  source_snapshot_invalid: {
    side: "yours",
    next_step:
      "Read source_get and verify the snapshot against the current binding. For a remote upload, use source_blob_put for missing files and source_upload_commit for the full receipt manifest. For a local snapshot, inspect it with source_inspect before retrying source_publish.",
    status: 409,
    retryable: false,
    action:
      "Verify the source file contents, hashes and complete manifest before preparing a new upload.",
    title: "Source snapshot is inconsistent",
  },
  source_snapshot_too_large: {
    side: "yours",
    next_step:
      "Remove build outputs and large media from the source tree. Retry with a smaller source_changes batch or a smaller full snapshot.",
    status: 413,
    retryable: false,
    action:
      "Use safe repository-relative paths and a bounded source snapshot. Keep generated outputs and large media outside the source tree.",
    title: "Source snapshot exceeds its limits",
  },
  cloudflare_zone_not_bound: {
    side: "not_set_up",
    next_step:
      "Check domain_paid_status or mail_binding_get and configure the domain for the project before calling domain_cloudflare_authorize.",
    status: 409,
    retryable: false,
    action:
      "Configure the project domain first with 'ohmyhost domain paid plan' then 'ohmyhost domain paid apply', or configure its sender domain with 'ohmyhost mail setup'. Then request Cloudflare authorization for that domain's zone.",
    title: "Cloudflare zone is not bound to this project",
  },
  github_connection_required: {
    side: "not_set_up",
    next_step:
      "Check the workspace with identity_get and call github_connect. Give the browser link to the user, then check github_status before repeating source_link.",
    say_to_user: "The workspace needs a GitHub connection before I can link this repository.",
    status: 409,
    retryable: false,
    action:
      "This workspace has no GitHub connection yet. Run 'ohmyhost github connect --organization ULID --idempotency-key KEY --json' for it, complete its browser link, then repeat the original source link. If the project belongs to another account, use that account's login instead; error.acting_as in the CLI and MCP names the login this ran as.",
    title: "GitHub connection required",
  },
  connection_revoked: {
    side: "not_set_up",
    next_step:
      "Ask the user to remove and add the ohmyho.st connector again, then call identity_get to confirm the connection.",
    say_to_user: "Please reconnect ohmyho.st to continue.",
    status: 403,
    retryable: false,
    action: "Remove the ohmyho.st connector from your agent and add it again to reconnect.",
    title: "Connection revoked",
  },
  github_connection_revoked: {
    side: "not_set_up",
    next_step:
      "Call github_connect for the same workspace and ask the user to approve the browser link. Check github_status before retrying the original request.",
    status: 409,
    retryable: false,
    action:
      "The workspace's GitHub App installation was removed or can no longer be used. Run 'ohmyhost github connect --organization ULID --idempotency-key NEW_KEY --json' with a new key (an earlier key only replays the old connection), send the customer its authorization_url, repeat that command with the same new key until status is connected, then repeat the original source link.",
    title: "GitHub connection revoked",
    restAction:
      "The workspace's GitHub App installation was removed or can no longer be used. Run 'ohmyhost github connect --organization ULID --idempotency-key NEW_KEY --json' with a new key (an earlier key only replays the old connection), send the customer its authorization_url, repeat that command with the same new key until status is connected, then repeat the original source link.",
  },
  repository_not_installed: {
    side: "yours",
    next_step:
      "Read github_status and ask the user to grant the existing installation access to the selected repository before retrying source_link.",
    status: 403,
    retryable: false,
    action:
      "Read 'ohmyhost github status --organization ULID --json', open connection.settings_url and add this repository to the installation. Then repeat the original source link and key.",
    title: "Repository access required",
  },
  database_write_pending: {
    side: "ours",
    next_step:
      "Use project_status and operation_get to check the current write. When it finishes, retry the requested deletion with fresh confirmation if the earlier confirmation expired.",
    status: 409,
    retryable: false,
    action:
      "A database write of this project is still running, so the project cannot be deleted yet. Read latest_operation from 'ohmyhost project status --project ULID --json' until it is no longer running; writes are short. Then repeat the deletion, planning it again if its confirmation expired.",
    title: "Database write in progress",
    restAction:
      "A database write of this project is still running, so the project cannot be deleted yet. Read latest_operation from 'ohmyhost project status --project ULID --json' until it is no longer running; writes are short. Then repeat the deletion, planning it again if its confirmation expired.",
  },
  cloudflare_authorization_closed: {
    side: "not_set_up",
    next_step:
      "Read domain_cloudflare_status. If it has no valid grant for the requested zone, request a fresh link with domain_cloudflare_authorize and a new key.",
    status: 409,
    retryable: false,
    action:
      "Read Cloudflare DNS status. Reuse a valid grant for the requested zone; otherwise request fresh authorization with a new idempotency key. Do not replay the callback.",
    title: "Cloudflare authorization closed",
  },
  billing_recharge_conflict: {
    side: "yours",
    next_step:
      "Read billing_recharge_get for the current setup or invoice before changing auto-recharge or starting another payment.",
    status: 409,
    retryable: false,
    action:
      "The auto-recharge settings changed since you read them, or this key was used with other settings. Run 'ohmyhost billing recharge get --organization ULID --json'. If it already shows the requested change, stop. Otherwise, only if the Owner still wants it, send the change again with the returned revision and a new idempotency key. Never re-enable charges without the Owner's approval.",
    title: "Auto-recharge settings conflict",
    restAction:
      "The auto-recharge settings changed since you read them, or this key was used with other settings. Run 'ohmyhost billing recharge get --organization ULID --json'. If it already shows the requested change, stop. Otherwise, only if the Owner still wants it, send the change again with the returned revision and a new idempotency key. Never re-enable charges without the Owner's approval.",
  },
  billing_purchase_conflict: {
    side: "yours",
    next_step:
      "Read billing_checkout_get for the original checkout and organization_account_get for current coverage. Manage an existing subscription through billing_portal_create.",
    status: 409,
    retryable: false,
    action:
      "This workspace already has Paid or an open Paid checkout, this key belongs to a checkout with a different offer or pack count, or, for 'billing portal', the workspace has never started a checkout. Read the original checkout with 'ohmyhost billing status --organization ULID --checkout CHECKOUT_ULID --json'; manage an existing Paid subscription with 'ohmyhost billing portal'. Never start a second purchase after an uncertain one.",
    title: "Billing purchase conflict",
    restAction:
      "This workspace already has Paid or an open Paid checkout, this key belongs to a checkout with a different offer or pack count, or, for 'billing portal', the workspace has never started a checkout. Read the original checkout with 'ohmyhost billing status --organization ULID --checkout CHECKOUT_ULID --json'; manage an existing Paid subscription with 'ohmyhost billing portal'. Never start a second purchase after an uncertain one.",
  },
  compute_performance_paid_required: {
    side: "not_set_up",
    next_step:
      "Check organization_account_get for coverage and show the user the requirement. Use billing_checkout_create only if they request Paid access.",
    status: 403,
    retryable: false,
    action:
      "Performance compute needs active Paid and usable credits or grace; repeating unchanged does not help. Read 'ohmyhost credits account --organization ULID --json'. On Free, the Owner may start Paid with 'ohmyhost billing checkout --offer paid'; without usable credits, they may add credits. Until then, keep standard compute.",
    title: "Performance requires Paid access",
    restAction:
      "Performance compute needs active Paid and usable credits or grace; repeating unchanged does not help. Read 'ohmyhost credits account --organization ULID --json'. On Free, the Owner may start Paid with 'ohmyhost billing checkout --offer paid'; without usable credits, they may add credits. Until then, keep standard compute.",
  },
  compute_paid_required: {
    side: "not_set_up",
    next_step:
      "Check organization_account_get for coverage and database_compute_get for the current size. Use billing_checkout_create only if the user requests Paid access.",
    status: 403,
    retryable: false,
    action:
      "Database sizes above 256 MiB require active Paid access. Read the account status; keep the existing database until the owner chooses an eligible size or Paid access.",
    title: "Database size requires Paid access",
  },
  compute_storage_shrink_requires_migration: {
    side: "yours",
    next_step:
      "Read database_compute_get for the current storage size and project_data_plan for supported data changes. Report the migration requirement to the user before any data move.",
    status: 409,
    retryable: false,
    action:
      "This size includes less storage than the current volume. Keep the current database and plan an explicit data migration to a fresh smaller volume; do not retry the resize or delete data automatically.",
    title: "Smaller storage requires a data migration",
  },
  compute_performance_unavailable: {
    side: "ours",
    next_step:
      "Try database_compute_get later to check pricing. Before retrying a write, check project_status for an existing operation.",
    status: 503,
    retryable: false,
    action:
      "Choose standard compute or report inactive performance pricing through feedback. Do not repeatedly resubmit.",
    title: "Performance pricing unavailable",
  },
  compute_change_pending: {
    side: "ours",
    next_step:
      "Read project_status and follow its current compute change with operation_get before requesting another.",
    status: 409,
    retryable: false,
    action:
      "A database size change of this project is still running. Every 60 seconds read latest_operation from 'ohmyhost project status --project ULID --json', or 'ohmyhost operation get OPERATION_ID --json' for the change you started, until it ends, then repeat this request. Do not submit another size change or a deletion meanwhile.",
    title: "Database size change running",
    restAction:
      "A database size change of this project is still running. Every 60 seconds read latest_operation from 'ohmyhost project status --project ULID --json', or 'ohmyhost operation get OPERATION_ID --json' for the change you started, until it ends, then repeat this request. Do not submit another size change or a deletion meanwhile.",
  },
  compute_change_conflict: {
    side: "yours",
    next_step:
      "Read database_compute_get and project_status, then submit the intended change with database_compute_set against the current state.",
    status: 409,
    retryable: false,
    action:
      "Read the original operation and current database compute. Preserve data and report unresolved conflicts through feedback with the operation ID.",
    title: "Database size change conflict",
  },
  database_access_limit: {
    side: "yours",
    next_step:
      "Use database_access_list to show the existing credentials. Revoke one with database_access_revoke only when the user identifies one to retire.",
    status: 409,
    retryable: false,
    action:
      "List the project's database credentials and revoke one you no longer need, then request access again.",
    title: "Database access limit reached",
  },
  database_webhook_limit: {
    side: "yours",
    next_step:
      "Use database_webhook_list to find the existing webhooks. Delete one with database_webhook_delete only when the user identifies one to remove, then retry creation.",
    status: 409,
    retryable: false,
    action:
      "List the project's database webhooks for this environment and delete one you no longer need, then create the webhook again.",
    title: "Database webhook limit reached",
  },
  database_schedule_limit: {
    side: "yours",
    next_step:
      "Use database_schedule_list to find the existing schedules. Delete one with database_schedule_delete only when the user identifies one to remove, then retry setup.",
    status: 409,
    retryable: false,
    action:
      "List the project's database schedules for this environment and delete one you no longer need, then set the schedule again.",
    title: "Database schedule limit reached",
  },
  database_schedule_not_runnable: {
    side: "yours",
    next_step:
      "Read database_schedule_list and database_schedule_run_list. Wait for a queued run to finish, or enable a disabled schedule with database_schedule_set if the user requests it.",
    status: 409,
    retryable: false,
    action:
      "Read the schedule and its runs. Enable a disabled schedule, or wait until the run already queued has finished, then request the run again.",
    title: "Database schedule cannot run now",
  },
  database_webhook_delivery_pending: {
    side: "ours",
    next_step:
      "Read database_webhook_delivery_list until the delivery finishes. Use database_webhook_delivery_replay only for a dead-lettered delivery or when the receiver needs the event again.",
    status: 409,
    retryable: false,
    action:
      "The platform is still retrying this webhook delivery. Read the delivery in the delivery list; replay it only if it ends dead_lettered or the receiver needs the event again.",
    title: "Webhook delivery still pending",
  },
  database_watch_limit: {
    side: "yours",
    next_step:
      "Use database_watch_list to find the existing watches. Delete one with database_watch_delete only when the user identifies one to remove, then retry creation.",
    status: 409,
    retryable: false,
    action:
      "List the project's database watches for this environment and delete one you no longer need, then create the watch again.",
    title: "Database watch limit reached",
  },
  database_watch_table_unavailable: {
    side: "yours",
    next_step:
      "Verify the table with database_query in the selected environment. Use database_watch_create after the table exists as an ordinary application-owned table.",
    status: 409,
    retryable: false,
    action:
      "The table must exist as an ordinary table owned by the application, created by a deployed migration; views, partitions, temporary tables and the schemas pgcf, ohmyhost, information_schema and pg_* cannot be watched. Fix the name or deploy the migration, then create the watch again.",
    title: "Table cannot be watched",
  },
  database_watch_column_unavailable: {
    side: "yours",
    next_step:
      "Read the table metadata with database_query and retry database_watch_create with the exact spelling and case of existing columns.",
    status: 409,
    retryable: false,
    action:
      "List only existing column names exactly as written, names are case-sensitive. Delete the watch before a migration drops a published column, because the write would fail.",
    title: "Watched column does not exist",
  },
  database_watch_events_unavailable: {
    side: "not_set_up",
    next_step:
      "Wake the database with a read-only database_query and then retry database_watch_create. If setup still fails, call feedback_submit with the request ID.",
    status: 409,
    retryable: false,
    action:
      "The platform event schema is installed when the database wakes: run any query against that environment, wait for the answer, then create the watch again. If it still fails, report the request_id through feedback.",
    title: "Database events not installed yet",
  },
  database_watch_conflict: {
    side: "yours",
    next_step:
      "Read database_watch_list and check the migration with source_files for an existing capture trigger. Keep the trigger or plan its removal through the normal migration process.",
    status: 409,
    retryable: false,
    action:
      "A migration already attaches a capture trigger to this table: keep it and skip the watch, or remove it from the migrations, deploy and create the watch again. A table carries one capture trigger.",
    title: "Table already has a capture trigger",
  },
  database_table_conflict: {
    side: "yours",
    next_step:
      "Read the existing table definition with database_query, then retry database_table_create with an identical definition or a different table name.",
    status: 409,
    retryable: false,
    action:
      "A table with this name already exists with another definition. Choose another table name, or create the table again with the same columns, types, nullability, identity, defaults and primary key it has.",
    title: "Table already exists with another definition",
  },
  database_table_limit: {
    side: "yours",
    next_step:
      "Use database_query to check for a suitable existing table. Ask before planning any migration to remove a table.",
    status: 409,
    retryable: false,
    action:
      "This database already holds the maximum number of tables in its public schema, so no table can be added. Use an existing table, or remove a table you no longer need through a deployed migration, then create the table again.",
    title: "Database table limit reached",
  },
  project_notes_conflict: {
    side: "yours",
    next_step:
      "Read project_context_get, merge the intended notes with the current notes, and call project_notes_set with the current version and a new key.",
    status: 409,
    retryable: false,
    action:
      "Read project context, merge the current notes and retry with its version and a new idempotency key.",
    title: "Project notes changed",
  },
  invalid_request: {
    side: "yours",
    next_step:
      "Correct the arguments named in issues and call the tool again. If api_reference is available, use it to check the input contract.",
    status: 400,
    retryable: false,
    action:
      "The server rejected this request; repeating it unchanged fails again. Check every argument against the command usage or the tool schema. For 'mail webhook verify' and mail receiving, the app's webhook route must answer the signed test with 2xx using the installed signing secret; receiving needs a verified webhook. For 'database query', send one read-only SELECT or WITH statement that runs on the current schema.",
    title: "Invalid request",
    restAction:
      "Read detail for the rejected field or condition, correct it and send the corrected request; repeating it unchanged fails again.",
  },
  unauthenticated: {
    side: "not_set_up",
    next_step:
      "Ask the user to reconnect or restore their saved login. If the local server uses an API key, check that it belongs to the selected environment and ask the user to replace it privately if revoked, then confirm access with identity_get.",
    say_to_user: "Please sign in to ohmyho.st again so I can continue.",
    status: 401,
    retryable: false,
    action:
      "The login or token was not accepted; repeating unchanged does not help. If OHMYHOST_TOKEN is set, it was revoked, mistyped or belongs to a different platform than OHMYHOST_ENVIRONMENT selects (a platform setting, not the project's dev or prod): ask the customer for a current token from the portal's API Tokens page, or unset it and run 'ohmyhost login --json'. Otherwise run 'ohmyhost login --json', then repeat the request.",
    title: "Authentication required",
    restAction:
      "The login or token was not accepted; repeating unchanged does not help. If OHMYHOST_TOKEN is set, it was revoked, mistyped or belongs to a different platform than OHMYHOST_ENVIRONMENT selects (a platform setting, not the project's dev or prod): ask the customer for a current token from the portal's API Tokens page, or unset it and run 'ohmyhost login --json'. Otherwise run 'ohmyhost login --json', then repeat the request.",
  },
  forbidden: {
    side: "yours",
    next_step:
      "Call identity_get and project_status to verify the account and project scope. Ask a workspace owner or admin for access if the selected account lacks permission.",
    status: 403,
    retryable: false,
    action:
      "This login may not do this; repeating unchanged does not help. error.acting_as names the login used: use a workspace this login belongs to ('ohmyhost whoami --json'), or the login of the account that owns it. For 'organization create', pass --source exactly as the Signup source on the portal Profile page, or omit it when that page shows Direct.",
    title: "Forbidden",
    restAction:
      "This identity may not do this; repeating unchanged does not help. Use a workspace this identity belongs to. A new workspace must preserve the signup source already recorded for this user; a scoped API token may create another workspace through the ordinary authorized flow.",
  },
  organization_required: {
    side: "not_set_up",
    next_step:
      "Use identity_get to read the available workspaces and ask which to use if there is a choice. If none exists, offer to help the user set up their first workspace.",
    status: 409,
    retryable: false,
    action:
      "Run 'ohmyhost organization list --json' and select one with 'ohmyhost organization use --organization ULID --json', or create the first workspace.",
    title: "Workspace selection required",
  },
  resource_not_found: {
    side: "yours",
    next_step:
      "Use the matching list tool if available, or verify the account and project with identity_get and project_status. If the resource was just created, read operation_get first.",
    status: 404,
    retryable: false,
    action:
      "Check the resource identifier and the account: a project is visible only to its own organization, and error.acting_as in the CLI and MCP names the login this ran as. Use the login of the account that owns it.",
    title: "Resource not found",
  },
  idempotency_key_reused: {
    side: "yours",
    next_step:
      "Use operation_get to inspect any existing operation when its identifier is known. Reuse the key only for the original request and use a new key for an intentionally different request.",
    status: 409,
    retryable: false,
    action:
      "This key was already used for a request with different arguments or from another login. To repeat that original request, send exactly its original arguments with this key from the same login; for a new request, use a new key. Never pair a new key with a request whose first attempt had an uncertain outcome: read its result first.",
    title: "Idempotency key reused",
    restAction:
      "This key was already used for a request with different arguments or from another login. To repeat that original request, send exactly its original arguments with this key from the same login; for a new request, use a new key. Never pair a new key with a request whose first attempt had an uncertain outcome: read its result first.",
  },
  project_handle_unavailable: {
    side: "ours",
    next_step:
      "Check the requested address with project_handle_check, then retry project_create with the original key if needed.",
    status: 503,
    retryable: true,
    action: "Retry project creation with the same idempotency key.",
    title: "Project handle unavailable",
  },
  project_handle_taken: {
    side: "yours",
    next_step:
      "Call project_handle_check and offer the user available addresses. Change the address with project_handle_set only to the one they choose.",
    status: 409,
    retryable: false,
    action:
      "Another project uses this address. Run 'ohmyhost project handle check --handle NAME --json' and offer the customer its alternatives; rename only to the one they choose.",
    title: "Project address is taken",
    restAction:
      "Another project uses this address. Run 'ohmyhost project handle check --handle NAME --json' and offer the customer its alternatives; rename only to the one they choose.",
  },
  project_handle_invalid: {
    side: "yours",
    next_step:
      "Provide one to five lowercase words containing letters or digits, between three and fifty-nine characters in total. Check the choice with project_handle_check.",
    status: 409,
    retryable: false,
    action:
      "Choose one to five lowercase words of letters and digits, three to fifty-nine characters, avoiding reserved words.",
    title: "Project address is invalid",
  },
  project_handle_unchanged: {
    side: "yours",
    next_step: "Use project_get to confirm the current address and report it to the user.",
    status: 409,
    retryable: false,
    action: "The project already answers on this address; no rename is needed.",
    title: "Project address is unchanged",
  },
  database_limit_reached: {
    side: "yours",
    next_step:
      "Read project_status to see whether this project already has a database, then tell the user the workspace has reached its database limit.",
    say_to_user: "This workspace has reached its database limit.",
    status: 409,
    retryable: false,
    action:
      "Delete a database you no longer need, or the project whose database it is, then deploy again. The limit counts the organization's live databases.",
    title: "Database limit reached",
  },
  project_rename_blocked: {
    side: "ours",
    next_step:
      "Read project_status and use operation_get to follow the pending change. Once it finishes, read project_get and retry with the current resource version.",
    status: 409,
    retryable: true,
    action:
      "Read project status and finish or retry any pending Native Auth deployment or other operation. Once preparation is complete, read the project again and rename with its current ETag.",
    title: "Project address change blocked",
  },
  project_identity_unavailable: {
    side: "ours",
    next_step:
      "Check the requested address with project_handle_check, then retry project_create with the original key if needed.",
    status: 503,
    retryable: true,
    action: "Retry project creation with the same idempotency key.",
    title: "Project identity unavailable",
  },
  deployment_plan_expired: {
    side: "yours",
    next_step:
      "Run deployment_plan again for the chosen saved commit, then use the new plan for deployment_create.",
    status: 409,
    retryable: false,
    action: "Run 'ohmyhost plan' again, then deploy the new plan.",
    title: "Deployment plan expired",
  },
  deployment_plan_incompatible: {
    side: "yours",
    next_step:
      "Read project_status and source_get for the current environment and saved commit, then call deployment_plan again for that scope.",
    status: 409,
    retryable: false,
    action: "Run 'ohmyhost plan' again with the current source revision.",
    title: "Deployment plan incompatible",
  },
  confirmation_expired: {
    side: "yours",
    next_step:
      "Create a fresh plan for the requested action, such as promotion_plan or rollback_plan, and use its confirmation before it expires.",
    status: 409,
    retryable: false,
    action: "Plan the destructive action again before confirming it.",
    title: "Confirmation expired",
  },
  confirmation_invalid: {
    side: "yours",
    next_step:
      "Check the current target with project_status and create a fresh plan for the requested action, such as promotion_plan.",
    status: 409,
    retryable: false,
    action:
      "The confirmation token does not match this action or the project's current state. Then create a new plan and confirm with its confirmation_token and resource_etag before the token expires.",
    title: "Confirmation invalid",
    restAction:
      "The confirmation token does not match this action or the project's current state. Then create a new plan and confirm with its confirmation_token and resource_etag before the token expires.",
  },
  etag_mismatch: {
    side: "yours",
    next_step:
      "Read the resource again, using project_get for a project. Check that the requested change still applies and retry using the returned version.",
    status: 409,
    retryable: false,
    action:
      "The project changed after you read its ETag. For a rename, read etag from 'ohmyhost project status --project ULID --json' and repeat 'ohmyhost project handle set' with it. For a rollback, promotion or deletion, create a new plan and confirm with its resource_etag and confirmation_token.",
    title: "Resource changed",
    restAction:
      "The project changed after you read its ETag. For a rename, read etag from 'ohmyhost project status --project ULID --json' and repeat 'ohmyhost project handle set' with it. For a rollback, promotion or deletion, create a new plan and confirm with its resource_etag and confirmation_token.",
  },
  promotion_source_stale: {
    side: "yours",
    next_step:
      "Read project_status for the current Dev deployment, then plan promotion again with promotion_plan.",
    status: 409,
    retryable: false,
    action: "Read the current dev deployment, then plan promotion again.",
    title: "Promotion source changed",
  },
  promotion_target_stale: {
    side: "yours",
    next_step:
      "Read project_status for the current Prod deployment, then call promotion_plan again.",
    status: 409,
    retryable: false,
    action: "Read the current prod status, then plan promotion again.",
    title: "Promotion target changed",
  },
  promotion_invalid_target: {
    side: "yours",
    next_step:
      "Use project_status and deployment_get to find a succeeded current Dev deployment before calling promotion_plan.",
    status: 409,
    retryable: false,
    action: "Select the current succeeded dev deployment and target prod.",
    title: "Promotion target invalid",
  },
  mail_capacity_unavailable: {
    side: "ours",
    next_step:
      "Read mail_binding_get before retrying mail setup. If capacity stays unavailable, use feedback_submit.",
    say_to_user: "Mail setup is temporarily unavailable.",
    status: 503,
    retryable: true,
    action:
      "Report this request ID through feedback. The stored mail setup continues automatically once ohmyho.st has capacity; follow mail status and keep the original idempotency key.",
    title: "Mail capacity unavailable",
  },
  mail_domain_conflict: {
    side: "yours",
    next_step:
      "Read mail_binding_get and workspace_mail_domains_list. Ask which existing sender the user wants to use before changing the binding.",
    status: 409,
    retryable: false,
    action:
      "Read the workspace sender resource and project binding. Reuse requires explicit domain-use authority, target-project editing and a current verified application identity with the same registrable main domain. Read the current revision before changing settings. Detach a shared project binding explicitly; legacy domain deletion cannot retire a resource used by another project.",
    title: "Mail domain conflict",
  },
  mail_domain_pending_limit: {
    side: "yours",
    next_step:
      "Use workspace_mail_domains_list to review pending sender domains. Ask which setup to finish or which unused sender to retire before trying again.",
    status: 409,
    retryable: false,
    action:
      "This organization already holds the maximum number of unverified workspace mail domains. Verify one of them, or retire an unused one, and then add this domain again.",
    title: "Mail domain pending limit",
  },
  mail_domain_required: {
    side: "not_set_up",
    next_step:
      "Use mail_binding_get and workspace_mail_domains_list to find the project's verified sender. Complete the sender setup and binding before returning to deployment_plan.",
    status: 409,
    retryable: false,
    action:
      "This app declares mail.enabled. Configure a sender with 'ohmyhost mail setup' or explicitly attach an authorized workspace sender using the project's Prod environment ID. Reuse first requires proof of the intended application hostname with the same registrable main domain; declare and verify that identity before mail-gated deployment. Then plan again.",
    title: "Mail domain required",
  },
  storage_jurisdiction_conflict: {
    side: "yours",
    next_step:
      "Read project_context_get for the recorded storage jurisdiction. Set storage.jurisdiction to that value with source_changes and run deployment_plan again.",
    not_helpful: "Deleting or recreating the project's storage is unnecessary.",
    status: 409,
    retryable: false,
    action:
      "Read 'Storage jurisdiction' in 'ohmyhost project context --project ULID --json' and set storage.jurisdiction in ohmyhost.yaml to that recorded value (us or eu). Existing R2 buckets and reservations keep their jurisdiction after a project-region migration; only new storage without a recorded bucket uses the project region. If context reports unavailable, report the request ID through feedback rather than guessing. Save or push the corrected version and plan its commit; for promotion, deploy it to Dev and promote again. Do not delete or recreate the project to move files.",
    title: "Storage jurisdiction conflict",
    restAction:
      "Read 'Storage jurisdiction' in 'ohmyhost project context --project ULID --json' and set storage.jurisdiction in ohmyhost.yaml to that recorded value (us or eu). Existing R2 buckets and reservations keep their jurisdiction after a project-region migration; only new storage without a recorded bucket uses the project region. If context reports unavailable, report the request ID through feedback rather than guessing. Save or push the corrected version and plan its commit; for promotion, deploy it to Dev and promote again. Do not delete or recreate the project to move files.",
  },
  shared_data_requires_promotion: {
    side: "yours",
    next_step:
      "Read project_status for the current Dev deployment and call promotion_plan. Publish with deployment_promote on remote MCP or promotion_execute on local MCP when the user asks to publish.",
    status: 409,
    retryable: false,
    action:
      "This is a legacy deployment restriction. Update the CLI and MCP to the current release, then plan with environment prod. The current platform permits direct Prod deployment with shared data; its migrations affect both environments when Dev exists. If the restriction persists, report the request ID.",
    title: "Shared data requires promotion",
  },
  development_environment_exists: {
    side: "yours",
    next_step: "Use project_status to find the project's existing Dev environment.",
    status: 409,
    retryable: false,
    action: "Read project status and use the existing Dev environment ID.",
    title: "Development environment already exists",
  },
  development_environment_missing: {
    side: "not_set_up",
    next_step:
      "Check organization_account_get and project_status. Use project_development_add when the user wants a Dev site and their workspace has Paid access.",
    status: 409,
    retryable: false,
    action: "Select environment prod, or add Dev with 'ohmyhost project dev add'.",
    title: "Development environment is missing",
  },
  production_deployment_required: {
    side: "not_set_up",
    next_step:
      "Check project_status for an active Prod deployment. If there is none and the user wants to publish, use deployment_plan and deployment_create before attaching the domain.",
    status: 409,
    retryable: false,
    action:
      "Deploy to Prod first: run 'ohmyhost plan --environment prod' and deploy that plan, or promote the current Dev deployment with 'ohmyhost deployment promote plan'. Then plan the domain again.",
    title: "Production deployment required",
  },
  framework_conversion_required: {
    side: "yours",
    next_step:
      "Read the named file with source_files and correct the reported requirement. Save the correction with source_changes and call deployment_plan again for the new version.",
    status: 409,
    retryable: false,
    action:
      "Read detail: a catalog sentence names the file, the rule and the required change. Apply it, save or push the corrected version and plan its commit. If detail names no file, run 'ohmyhost init --dry-run --json' at that commit and apply its blockers and the matching ohmyho.st framework Skill; init lists the install, build and server-only checks it cannot run locally under pending. Repeating the unchanged source cannot fix an admission error.",
    title: "Framework conversion required",
    restAction:
      "Read detail: a catalog sentence names the file, the rule and the required change. Apply it, save or push the corrected version and plan its commit. If detail names no file, run 'ohmyhost init --dry-run --json' at that commit and apply its blockers and the matching ohmyho.st framework Skill; init lists the install, build and server-only checks it cannot run locally under pending. Repeating the unchanged source cannot fix an admission error.",
  },
  source_syntax_error: {
    side: "yours",
    next_step:
      "Read the named file with source_files, fix the syntax at the reported line and column, save it with source_changes, and call deployment_plan again.",
    status: 409,
    retryable: false,
    action:
      "Fix the syntax at the reported line and column, save or push the corrected source and plan the new commit.",
    title: "Source syntax error",
  },
  repository_configuration_missing: {
    side: "yours",
    next_step:
      "Read package.json with source_files to identify the framework, then add a matching ohmyhost.yaml at the repository root with source_changes and run deployment_plan again.",
    status: 409,
    retryable: false,
    action:
      "The planned commit has no ohmyhost.yaml at the Git repository root. If the repository has none, run 'ohmyhost init --json' at the root (--root DIR when the app lives in a subdirectory, --region eu for an EU project). Otherwise move the existing file to the root and set applicationRoot to the app directory, for example website. Save or push the corrected version, then plan its commit.",
    title: "Repository configuration missing",
    restAction:
      "The planned commit has no ohmyhost.yaml at the Git repository root. If the repository has none, run 'ohmyhost init --json' at the root (--root DIR when the app lives in a subdirectory, --region eu for an EU project). Otherwise move the existing file to the root and set applicationRoot to the app directory, for example website. Save or push the corrected version, then plan its commit.",
  },
  migration_filename_noncanonical: {
    side: "yours",
    next_step:
      "Use source_files to check the folder named in database.migrations. Save new migrations with source_changes using YYYYMMDDHHMMSS_name.sql and the current UTC time.",
    not_helpful: "Editing a migration that has already run will not help.",
    status: 409,
    retryable: false,
    action:
      "Every file in the migrations directory (database.migrations in ohmyhost.yaml) must be named YYYYMMDDHHMMSS_name.sql: 14 digits, an underscore, then lowercase letters, digits, _ or -. Rename each file that does not match and move any other file, such as README.md or .gitkeep, out of that directory. Save or push the corrected version, then plan its commit. Never rename a migration a deployment already applied.",
    title: "Migration filename noncanonical",
    restAction:
      "Every file in the migrations directory (database.migrations in ohmyhost.yaml) must be named YYYYMMDDHHMMSS_name.sql: 14 digits, an underscore, then lowercase letters, digits, _ or -. Rename each file that does not match and move any other file, such as README.md or .gitkeep, out of that directory. Save or push the corrected version, then plan its commit. Never rename a migration a deployment already applied.",
  },
  environment_secret_mutation_blocked: {
    side: "yours",
    next_step:
      "Use secrets_list to inspect the environment's secret names. Use the applicable secret tool only for names the user can manage.",
    status: 409,
    retryable: true,
    action: "Wait for the active deployment or rollback to finish, then retry unchanged.",
    title: "Environment secret mutation blocked",
  },
  workers_runtime_incompatible: {
    side: "yours",
    next_step:
      "Find the unsupported import with source_files and replace it with a Workers-compatible implementation. Save the corrected files with source_changes, then call deployment_plan again.",
    status: 409,
    retryable: false,
    action:
      "A Next.js file under app/, pages/, middleware or proxy imports a native addon (.node) or a Node.js module that does not run on Workers: child_process, cluster, dgram, domain, http2, inspector, readline, repl, sqlite, trace_events, tty, v8, vm, wasi, worker_threads or _stream_wrap, with or without node:. Remove or replace that import, save or push the corrected version, then plan its commit.",
    title: "Workers runtime incompatible",
    restAction:
      "A Next.js file under app/, pages/, middleware or proxy imports a native addon (.node) or a Node.js module that does not run on Workers: child_process, cluster, dgram, domain, http2, inspector, readline, repl, sqlite, trace_events, tty, v8, vm, wasi, worker_threads or _stream_wrap, with or without node:. Remove or replace that import, save or push the corrected version, then plan its commit.",
  },
  payload_too_large: {
    side: "yours",
    next_step:
      "Reduce the payload and try again. For source trees, try smaller changes with source_changes.",
    status: 413,
    retryable: false,
    action: "Reduce the request size.",
    title: "Payload too large",
  },
  project_export_not_ready: {
    side: "not_set_up",
    next_step:
      "Read project_status to check whether the app has a deployed database. If a deployment is creating it, use operation_get and request the export after it succeeds.",
    status: 409,
    retryable: false,
    action:
      "No database of this project is ready, so no export was accepted. A database is created when a commit whose ohmyhost.yaml sets database.enabled: true is deployed; request the export again after that deployment succeeds ('ohmyhost operation get OPERATION_ID --json'). A project without a database has no SQL export.",
    title: "Project database not ready for export",
    restAction:
      "No database of this project is ready, so no export was accepted. A database is created when a commit whose ohmyhost.yaml sets database.enabled: true is deployed; request the export again after that deployment succeeds ('ohmyhost operation get OPERATION_ID --json'). A project without a database has no SQL export.",
  },
  powered_by_flag_required: {
    side: "not_set_up",
    next_step:
      "Check organization_account_get and explain the powered-by flag requirement. Once it is satisfied, run deployment_plan again.",
    status: 409,
    retryable: false,
    action:
      "Keep the flag on, remove the custom domain with 'ohmyhost domain paid delete', or buy Paid, then switch the flag off.",
    title: "Powered-by flag required",
  },
  build_capacity_reached: {
    side: "ours",
    next_step:
      "Read the in-flight deployment with operation_get when available. Wait for build capacity and retry only after confirming the intended work has not already started.",
    status: 429,
    retryable: false,
    action:
      "This organization already has its maximum number of open builds. Wait for an open deployment to finish, then start a new deployment with a new idempotency key.",
    title: "Build capacity reached",
  },
  rate_limited: {
    side: "ours",
    next_step:
      "Wait for retry_after_seconds when present before repeating a read such as operation_get. If a write's outcome is unclear, check its original operation before repeating the same request with the same key.",
    status: 429,
    retryable: true,
    action:
      "Too many requests. Wait retry_after_seconds, or 60 seconds when none is shown, then repeat the same request with the same idempotency key. SQL exports allow one request per project per rolling 24 hours: poll the export already requested with 'ohmyhost export get EXPORT_ID --project ULID --json' instead of creating another.",
    title: "Rate limited",
    restAction:
      "Wait the Retry-After interval (also retry_after_seconds), then repeat the same request with the same idempotency key.",
  },
  insufficient_organization_credits: {
    side: "not_set_up",
    next_step:
      "Use organization_credits_get to show the available credits. Start billing_checkout_create only if the user asks to buy credits.",
    say_to_user: "The workspace needs more credits to continue.",
    status: 402,
    retryable: false,
    action:
      "Add organization credits or wait for reservations to settle, then retry the same request.",
    title: "Insufficient organization credits",
  },
  project_budget_exceeded: {
    side: "not_set_up",
    next_step:
      "Read project_budget_get and explain the limit. Call project_budget_set only if the user asks to change it, or wait for the next budget period.",
    say_to_user: "This project has reached its monthly spending limit.",
    status: 402,
    retryable: false,
    action:
      "This project's Stop budget for the current UTC month is reached; nothing was started. Show the customer 'ohmyhost budget get --project ULID --json'. Only on their request raise the limit or switch the mode to continue with 'ohmyhost budget set', then retry the same request; otherwise wait for the next UTC month.",
    title: "Project budget exceeded",
    restAction:
      "This project's Stop budget for the current UTC month is reached; nothing was started. Show the customer 'ohmyhost budget get --project ULID --json'. Only on their request raise the limit or switch the mode to continue with 'ohmyhost budget set', then retry the same request; otherwise wait for the next UTC month.",
  },
  paid_plan_required: {
    side: "not_set_up",
    next_step:
      "Read organization_account_get and explain which action requires Paid access. Start billing_checkout_create only if the user asks to upgrade.",
    say_to_user: "This action requires a Paid workspace.",
    status: 402,
    retryable: false,
    action:
      "Ask the organization Owner to activate Paid through billing checkout, then retry. Top-ups and signup credits do not activate Paid. For a website domain alone, a Free workspace may instead show the powered-by flag on the project.",
    title: "Paid plan required",
  },
  interactive_login_required: {
    side: "not_set_up",
    next_step:
      "Ask the user to sign in with their own account, then verify it with identity_get. An automation key cannot perform this action.",
    status: 403,
    retryable: false,
    action:
      "Unset OHMYHOST_TOKEN and run ohmyhost login before managing tokens. Existing token files remain unchanged.",
    title: "Interactive login required",
  },
  api_key_creation_uncertain: {
    side: "ours",
    next_step:
      "Use identity_get to confirm the account and ask the user to check the original key request in the portal. Call feedback_submit if its result cannot be confirmed.",
    not_helpful: "Creating another key could leave an extra active key.",
    status: 503,
    retryable: true,
    action:
      "Repeat the original token name and Idempotency-Key to observe its result; do not blindly create another key.",
    title: "Token creation unconfirmed",
  },
  api_key_permissions_unavailable: {
    side: "ours",
    next_step:
      "Use identity_get to verify the account before trying again later. If token permissions are still unavailable, report the request with feedback_submit.",
    status: 503,
    retryable: false,
    action:
      "Report the platform user-key permission configuration through feedback with this request_id; it affects every token the same way, whatever the integration. Repeated login does not fix it. After the platform confirms the fix, repeat the same create with the same name and Idempotency-Key.",
    title: "Token permissions unavailable",
  },
  reconciliation_required: {
    side: "ours",
    next_step:
      "If can_reconcile is true, call operation_reconcile once with the original write’s idempotency key. If reconciliation_required comes back a second time, stop and call feedback_submit with the operation ID. Tell the user the work got stuck on ohmyho.st’s side.",
    say_to_user: "This got stuck on ohmyho.st’s side.",
    status: 409,
    retryable: false,
    action:
      "Read the original operation’s recovery facts before making one reconciliation attempt.",
    title: "Recovery required",
  },
  reconciliation_exhausted: {
    side: "ours",
    next_step: "Stop recovery attempts and call feedback_submit with the original operation ID.",
    not_helpful: "Starting a new operation will not recover the original one.",
    say_to_user: "This operation got stuck on our side.",
    status: 409,
    retryable: false,
    action:
      "Stop retries and submit feedback with this operation ID. A platform recovery review is required.",
    title: "Recovery attempts exhausted",
  },
  reconciliation_not_pending: {
    side: "ours",
    next_step:
      "Read operation_get for the current outcome. If the operation is still stuck with no recovery pending, call feedback_submit with its ID.",
    status: 409,
    retryable: false,
    action:
      "Do not repeat this reconciliation: no uncertain delivery or provider mutation is pending for this operation. If the operation still does not finish, submit feedback with this operation ID.",
    title: "No recovery pending",
  },
  service_unavailable: {
    side: "ours",
    next_step:
      "Retry a read after retry_after_seconds if provided, reading files one at a time if needed. For a write, read operation_get when the operation ID is known or inspect the affected resource before taking further action.",
    not_helpful: "Repeating a write before checking its outcome can duplicate work.",
    status: 503,
    retryable: true,
    action:
      "The service could not complete or confirm this request; it may already have taken effect. Wait, then repeat exactly the same request with the same idempotency key, waiting longer each time; never switch to a new key. If 'ohmyhost plan' keeps failing, check that the commit is saved in the project's selected source and that 'ohmyhost init --dry-run --json' at that commit reports no blockers. If it still fails, report the request_id through feedback.",
    title: "Service unavailable",
    restAction:
      "The service could not complete or confirm this request; it may already have taken effect. Wait, then repeat exactly the same request with the same idempotency key, waiting longer each time; never switch to a new key. If 'ohmyhost plan' keeps failing, check that the commit is saved in the project's selected source and that 'ohmyhost init --dry-run --json' at that commit reports no blockers. If it still fails, report the request_id through feedback.",
  },
  source_commit_not_found: {
    side: "yours",
    next_step:
      "Read source_get and source_versions for an available commit, or save the intended source with source_changes before calling deployment_plan again.",
    status: 409,
    retryable: false,
    action:
      "The requested commit is not in the linked repository. Save or push that exact version using the source named by project status, or select a version already there, then run 'ohmyhost plan' with its full SHA. Repeating the unchanged unavailable commit cannot work.",
    restAction:
      "The requested commit is not in the linked repository. Save or push that exact version using the source named by project status, or select a version already there, then run 'ohmyhost plan' with its full SHA. Repeating the unchanged unavailable commit cannot work.",
    title: "Source commit not found",
  },
  domain_hostname_taken: {
    side: "yours",
    next_step:
      "Use domain_paid_status to check the current connection and ask the user which address to use before starting another plan.",
    status: 409,
    retryable: false,
    action:
      "A live connection holds it; its holder removes it with ohmyhost domain paid delete --project ULID --hostname HOST --idempotency-key KEY --yes --json. To connect it here, add the _omh-project.HOST TXT record that ohmyhost domain paid status --project ULID --json shows for it, then apply again with ohmyhost domain paid apply --project ULID --hostname HOST --idempotency-key KEY --yes --json.",
    restAction:
      "A live connection holds it; its holder removes it with ohmyhost domain paid delete --project ULID --hostname HOST --idempotency-key KEY --yes --json. To connect it here, add the _omh-project.HOST TXT record that ohmyhost domain paid status --project ULID --json shows for it, then apply again with ohmyhost domain paid apply --project ULID --hostname HOST --idempotency-key KEY --yes --json.",
    title: "Domain hostname is already connected",
  },
  domain_ownership_required: {
    side: "not_set_up",
    next_step:
      "Use domain_paid_plan to read the ownership proof and ask the user to add the required DNS record. Retry domain_paid_apply after DNS verification.",
    status: 409,
    retryable: false,
    action:
      "This hostname is not verified for this project yet. Add the _omh-project.HOST TXT record that ohmyhost domain paid status --project ULID --json shows for it, then apply again with ohmyhost domain paid apply --project ULID --hostname HOST --idempotency-key KEY --yes --json. Repeating before the record is published cannot work.",
    restAction:
      "This hostname is not verified for this project yet. Add the _omh-project.HOST TXT record that ohmyhost domain paid status --project ULID --json shows for it, then apply again with ohmyhost domain paid apply --project ULID --hostname HOST --idempotency-key KEY --yes --json. Repeating before the record is published cannot work.",
    title: "Verify the domain before connecting it",
  },
  domain_dns_conflict: {
    side: "yours",
    next_step:
      "Read domain_paid_plan for the conflicting records. Ask the domain owner to resolve them before retrying domain_paid_apply.",
    status: 409,
    retryable: false,
    action:
      "Review DNS for the requested hostname and resolve the conflicting delegation or another project's managed records. Preserve mailbox MX, TXT and CAA records. Then repeat the original domain paid apply or delete with the same hostname and idempotency key; do not create another deployment or repeatedly resubmit unchanged conflicts.",
    title: "Domain DNS records conflict",
  },
  domain_already_configured: {
    side: "yours",
    next_step:
      "Use domain_paid_status to check the existing connection. Confirm the intended hostname with the user before replacing it.",
    status: 409,
    retryable: false,
    action:
      "This project already has one Paid domain connection, for another hostname or one a different member configured. Read it with 'ohmyhost domain paid status --project ULID --json'. Delete it with 'ohmyhost domain paid delete --project ULID --hostname CURRENT_HOST --idempotency-key KEY --yes --json' only to replace it, then repeat this request with a new idempotency key. Repeating it unchanged cannot work.",
    title: "Project already has a domain connection",
  },
  domain_deleting: {
    side: "ours",
    next_step:
      "Read domain_paid_status and wait for deletion to finish before calling domain_paid_plan again.",
    status: 409,
    retryable: false,
    action:
      "The Paid domain connection of this project is still being deleted. Wait until 'ohmyhost domain paid status --project ULID --json' shows it deleted, then repeat this request with a new idempotency key. Repeating it before the deletion finishes cannot work.",
    title: "Domain connection is being deleted",
  },
  data_change_blocked: {
    side: "yours",
    next_step:
      "Read project_status and project_data_plan to find the prerequisite for this data change before trying again.",
    status: 409,
    retryable: true,
    action:
      "An operation of this project is still running. Wait until 'ohmyhost operation get OPERATION_ULID --json' shows it finished, plan the data change again and confirm it with the new ETag and token.",
    restAction:
      "An operation of this project is still running. Wait until 'ohmyhost operation get OPERATION_ULID --json' shows it finished, plan the data change again and confirm it with the new ETag and token.",
    title: "Data change blocked",
  },
  data_change_in_progress: {
    side: "ours",
    next_step:
      "Read project_status and follow the current data change with operation_get before starting another.",
    status: 409,
    retryable: true,
    action:
      "A data change of this project is running. Wait until its operation has finished ('ohmyhost project status --project ULID --json'), then repeat the request unchanged.",
    restAction:
      "A data change of this project is running. Wait until its operation has finished ('ohmyhost project status --project ULID --json'), then repeat the request unchanged.",
    title: "Data change in progress",
  },
  data_change_not_applicable: {
    side: "yours",
    next_step:
      "Read project_status and project_data_plan to check which data change is available for the current project state.",
    status: 409,
    retryable: false,
    action:
      "Read 'ohmyhost project status --project ULID --json'. Isolation applies to shared projects; returning to shared needs a deployed Prod database, and reset_dev applies to isolated projects. If detail names an old database or storage binding, deploy the affected environment again before planning the change. Repeating unchanged does not help.",
    restAction:
      "Read 'ohmyhost project status --project ULID --json'. Isolation applies to shared projects; returning to shared needs a deployed Prod database, and reset_dev applies to isolated projects. If detail names an old database or storage binding, deploy the affected environment again before planning the change. Repeating unchanged does not help.",
    title: "Data change is not applicable",
  },
  rollback_target_data_changed: {
    side: "yours",
    next_step:
      "Read deployment_get for the current target, then call rollback_plan again to assess rollback against the current data.",
    status: 409,
    retryable: false,
    action:
      "This deployment used a data area its environment no longer has. Deploy that commit again with a fresh plan instead of rolling back to its old bindings; repeating this rollback cannot work.",
    restAction:
      "This deployment used a data area its environment no longer has. Deploy that commit again with a fresh plan instead of rolling back to its old bindings; repeating this rollback cannot work.",
    title: "Rollback data area changed",
  },
  project_domain_delete_required: {
    side: "yours",
    next_step:
      "Read domain_paid_status and ask the user to confirm removal of the attached domain. After domain_paid_delete completes, make a fresh deletion plan.",
    status: 409,
    retryable: false,
    title: "Remove the project domain first",
    action:
      "This project still has a live or pending custom-domain connection. Read 'ohmyhost domain paid status --project ULID --json', remove that connection with 'ohmyhost domain paid delete --project ULID --hostname HOST --idempotency-key KEY --yes --json', then create a fresh project deletion plan. Repeating while it remains connected cannot work.",
  },
  native_domain_sync_pending: {
    side: "ours",
    next_step:
      "Read domain_paid_status and project_status to check the pending domain change. Retry only after the domain and sign-in configuration are synchronized.",
    status: 409,
    retryable: false,
    title: "Complete the pending domain change",
    action:
      "Read project status and Paid domain status to identify the pending change. If a Paid domain removal is pending, retry it as a current owner with a new idempotency key. If a project address change is pending, submit a fresh address change as a current owner. After it finishes, create a new project deletion plan.",
  },
  native_auth_launch_unavailable: {
    side: "not_set_up",
    next_step:
      "Built-in sign-in is not enabled for this project. After the user chooses, save a different sign-in setup with source_changes or request access with feedback_submit.",
    not_helpful: "Retrying the same configuration will not enable built-in sign-in.",
    say_to_user: "Built-in sign-in is not available for this project yet.",
    status: 409,
    retryable: false,
    title: "Native Auth cannot launch yet",
    action:
      "Ask ohmyho.st support to check Native Auth rollout access for this workspace and project. Once access is enabled, read the Native Auth configuration for the target environment to check Paid access, the verified sender, the approved application origin and storage. Retry after the missing requirement is satisfied.",
  },
  native_auth_provider_unavailable: {
    side: "not_set_up",
    next_step:
      "Read native_auth_provider_get and native_auth_config_get, then complete the missing setup before enabling the provider.",
    status: 409,
    retryable: false,
    title: "Native Auth provider unavailable",
    action:
      "This sign-in provider cannot be enabled for this project's current Native Auth state. Read the provider with 'ohmyhost auth provider get --project ULID --environment ULID --provider google|github --json' and complete the Native Auth configuration it reports. Repeating unchanged does not help.",
  },
  native_auth_epoch_exhausted: {
    side: "ours",
    next_step: "Stop retrying the policy change and call feedback_submit with the request ID.",
    status: 409,
    retryable: false,
    title: "Native Auth policy changes exhausted",
    action:
      "This project's Native Auth policy has reached its revision limit, so no further policy change is accepted. Do not retry. Contact support with the request_id of this response.",
  },
  native_auth_revision_conflict: {
    side: "yours",
    next_step:
      "Read native_auth_config_get or native_auth_provider_get for the current revision, then retry the intended change with that revision and a new key.",
    status: 409,
    retryable: false,
    title: "Native Auth state changed",
    action:
      "The configuration or provider changed after your configurationRevision. Read it with 'ohmyhost auth config get --project ULID --environment ULID --json' or 'ohmyhost auth provider get --project ULID --environment ULID --provider google|github --json', then repeat the change with its current revision and a new idempotency key.",
  },
  cutover_pending: {
    side: "ours",
    next_step:
      "Read project_status and wait for the database move to finish before requesting the change with a new key.",
    status: 409,
    retryable: true,
    title: "Database provider cutover is pending",
    action:
      "A database provider cutover of this project has not finished. Read the project with 'ohmyhost project status --project ULID --json', wait until it reports no pending cutover, then repeat the request with a new idempotency key.",
  },
  project_operation_in_progress: {
    side: "ours",
    next_step:
      "Read project_status and follow the latest operation with operation_get, or use project_export_get for an export in progress. Wait for it to finish before submitting the intended change.",
    status: 409,
    retryable: true,
    title: "Project change is still running",
    action:
      "Another change to this project, such as a database write, a compute change or a data change, has not finished. Read the project with 'ohmyhost project status --project ULID --json', wait until it completes, then repeat the request with a new idempotency key. A deletion is also refused while a SQL export of the project is being captured, for up to about ten minutes ('ohmyhost export get').",
  },
  auto_deploy_source_unavailable: {
    side: "not_set_up",
    next_step:
      "Read source_get and github_status. If the user wants automatic deployment from GitHub, connect with github_connect and link the repository with source_link before enabling it.",
    status: 409,
    retryable: false,
    title: "No ready GitHub source for auto-deploy",
    action:
      "Auto-deploy follows a linked GitHub repository. If this workspace has no GitHub connection, run 'ohmyhost github connect --organization ULID --idempotency-key KEY --json' and complete its browser link; then link the repository with 'ohmyhost link --project ULID --repository-owner OWNER --repository-name REPOSITORY --idempotency-key KEY --json'. Then enable auto-deploy again with a new idempotency key. A platform-hosted source has no GitHub push to follow.",
  },
  native_auth_provider_incomplete: {
    side: "not_set_up",
    next_step:
      "Use native_auth_provider_secret_input_request to give the user a secure input link. Verify setup with native_auth_provider_get before enabling the provider via native_auth_provider_set with the current revision.",
    status: 409,
    retryable: false,
    title: "Native Auth provider is incomplete",
    action:
      "A sign-in provider can be enabled only with its client ID and client secret. Store them with 'ohmyhost auth provider set --project ULID --environment ULID --provider google|github --client-id ID --stdin --idempotency-key KEY --json' (the secret on stdin), then enable it with the current revision and a new idempotency key. Repeating unchanged does not help.",
  },
  project_domains_conflict: {
    side: "yours",
    next_step:
      "Read project_get and domain_paid_status to verify the current handle and domains. Use a new key for the intended configuration after verifying the domain requirements.",
    status: 409,
    retryable: false,
    title: "Project domains belong to another handle",
    action:
      "The domains of this project were configured under another project handle. Read the project with 'ohmyhost project status --project ULID --json' to see its current handle, then repeat the domain configuration with a new idempotency key. Do not replay the earlier request.",
  },
  native_user_conflict: {
    side: "yours",
    next_step:
      "Read native_auth_user_get and choose the action that matches the user's current status.",
    status: 409,
    retryable: false,
    title: "Native Auth user conflicts with current state",
    action:
      "The user already exists, or the user is not in the state this action needs (for example a pending user cannot be suspended, and only a pending invitation can be resent). Read the user with 'ohmyhost auth user get --project ULID --environment ULID --user UUID --json' and choose the action that matches its status.",
  },
} as const satisfies Readonly<
  Record<
    string,
    ProblemChatGuidance & {
      readonly status: number;
      readonly retryable: boolean;
      readonly title: string;
      readonly action: string;
      readonly restAction?: string;
    }
  >
>;

export type ProblemCode = keyof typeof PROBLEM_POLICY;
