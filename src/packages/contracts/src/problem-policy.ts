/** Canonical public status, retry policy and recovery text shared by the API and clients. */
export const PROBLEM_POLICY = {
  cloudflare_zone_not_bound: {
    status: 409,
    retryable: false,
    action:
      "Configure the project domain first with 'ohmyhost domain paid plan' then 'ohmyhost domain paid apply', or configure its sender domain with 'ohmyhost mail setup'. Then request Cloudflare authorization for that domain's zone.",
    title: "Cloudflare zone is not bound to this project",
  },
  github_connection_required: {
    status: 409,
    retryable: false,
    action:
      "This workspace has no GitHub connection yet. Run 'ohmyhost github connect --organization ULID --idempotency-key KEY --json' for it, complete its browser link, then repeat the original source link. If the project belongs to another account, use that account's login instead; error.acting_as in the CLI and MCP names the login this ran as.",
    title: "GitHub connection required",
  },
  github_connection_revoked: {
    status: 409,
    retryable: false,
    action:
      "The workspace's GitHub App installation was removed or can no longer be used. Run 'ohmyhost github connect --organization ULID --idempotency-key NEW_KEY --json' with a new key (an earlier key only replays the old connection), send the customer its authorization_url, repeat that command with the same new key until status is connected, then repeat the original source link.",
    title: "GitHub connection revoked",
    restAction:
      "The workspace's GitHub App installation was removed or can no longer be used. Run 'ohmyhost github connect --organization ULID --idempotency-key NEW_KEY --json' with a new key (an earlier key only replays the old connection), send the customer its authorization_url, repeat that command with the same new key until status is connected, then repeat the original source link.",
  },
  repository_not_installed: {
    status: 403,
    retryable: false,
    action:
      "Read 'ohmyhost github status --organization ULID --json', open connection.settings_url and add this repository to the installation. Then repeat the original source link and key.",
    title: "Repository access required",
  },
  database_write_pending: {
    status: 409,
    retryable: false,
    action:
      "A database write of this project is still running, so the project cannot be deleted yet. Read latest_operation from 'ohmyhost project status --project ULID --json' until it is no longer running; writes are short. Then repeat the deletion, planning it again if its confirmation expired.",
    title: "Database write in progress",
    restAction:
      "A database write of this project is still running, so the project cannot be deleted yet. Read latest_operation from 'ohmyhost project status --project ULID --json' until it is no longer running; writes are short. Then repeat the deletion, planning it again if its confirmation expired.",
  },
  cloudflare_authorization_closed: {
    status: 409,
    retryable: false,
    action:
      "Read Cloudflare DNS status. Reuse a valid grant for the requested zone; otherwise request fresh authorization with a new idempotency key. Do not replay the callback.",
    title: "Cloudflare authorization closed",
  },
  billing_recharge_conflict: {
    status: 409,
    retryable: false,
    action:
      "The auto-recharge settings changed since you read them, or this key was used with other settings. Run 'ohmyhost billing recharge get --organization ULID --json'. If it already shows the requested change, stop. Otherwise, only if the Owner still wants it, send the change again with the returned revision and a new idempotency key. Never re-enable charges without the Owner's approval.",
    title: "Auto-recharge settings conflict",
    restAction:
      "The auto-recharge settings changed since you read them, or this key was used with other settings. Run 'ohmyhost billing recharge get --organization ULID --json'. If it already shows the requested change, stop. Otherwise, only if the Owner still wants it, send the change again with the returned revision and a new idempotency key. Never re-enable charges without the Owner's approval.",
  },
  billing_purchase_conflict: {
    status: 409,
    retryable: false,
    action:
      "This workspace already has Paid or an open Paid checkout, this key belongs to a checkout with a different offer or pack count, or, for 'billing portal', the workspace has never started a checkout. Read the original checkout with 'ohmyhost billing status --organization ULID --checkout CHECKOUT_ULID --json'; manage an existing Paid subscription with 'ohmyhost billing portal'. Never start a second purchase after an uncertain one.",
    title: "Billing purchase conflict",
    restAction:
      "This workspace already has Paid or an open Paid checkout, this key belongs to a checkout with a different offer or pack count, or, for 'billing portal', the workspace has never started a checkout. Read the original checkout with 'ohmyhost billing status --organization ULID --checkout CHECKOUT_ULID --json'; manage an existing Paid subscription with 'ohmyhost billing portal'. Never start a second purchase after an uncertain one.",
  },
  compute_performance_paid_required: {
    status: 403,
    retryable: false,
    action:
      "Performance compute needs active Paid and usable credits or grace; repeating unchanged does not help. Read 'ohmyhost credits account --organization ULID --json'. On Free, the Owner may start Paid with 'ohmyhost billing checkout --offer paid'; without usable credits, they may add credits. Until then, keep standard compute.",
    title: "Performance requires Paid access",
    restAction:
      "Performance compute needs active Paid and usable credits or grace; repeating unchanged does not help. Read 'ohmyhost credits account --organization ULID --json'. On Free, the Owner may start Paid with 'ohmyhost billing checkout --offer paid'; without usable credits, they may add credits. Until then, keep standard compute.",
  },
  compute_performance_unavailable: {
    status: 503,
    retryable: false,
    action:
      "Choose standard compute or report inactive performance pricing through feedback. Do not repeatedly resubmit.",
    title: "Performance pricing unavailable",
  },
  compute_change_pending: {
    status: 409,
    retryable: false,
    action:
      "A database size change of this project is still running. Every 60 seconds read latest_operation from 'ohmyhost project status --project ULID --json', or 'ohmyhost operation get OPERATION_ID --json' for the change you started, until it ends, then repeat this request. Do not submit another size change or a deletion meanwhile.",
    title: "Database size change running",
    restAction:
      "A database size change of this project is still running. Every 60 seconds read latest_operation from 'ohmyhost project status --project ULID --json', or 'ohmyhost operation get OPERATION_ID --json' for the change you started, until it ends, then repeat this request. Do not submit another size change or a deletion meanwhile.",
  },
  compute_change_conflict: {
    status: 409,
    retryable: false,
    action:
      "Read the original operation and current database compute. Preserve data and report unresolved conflicts through feedback with the operation ID.",
    title: "Database size change conflict",
  },
  database_access_limit: {
    status: 409,
    retryable: false,
    action:
      "List the project's database credentials and revoke one you no longer need, then request access again.",
    title: "Database access limit reached",
  },
  project_notes_conflict: {
    status: 409,
    retryable: false,
    action:
      "Read project context, merge the current notes and retry with its version and a new idempotency key.",
    title: "Project notes changed",
  },
  invalid_request: {
    status: 400,
    retryable: false,
    action:
      "The server rejected this request; repeating it unchanged fails again. Check every argument against the command usage or the tool schema. For 'mail webhook verify' and mail receiving, the app's webhook route must answer the signed test with 2xx using the installed signing secret; receiving needs a verified webhook. For 'database query', send one read-only SELECT or WITH statement that runs on the current schema.",
    title: "Invalid request",
    restAction:
      "Read detail for the rejected field or condition, correct it and send the corrected request; repeating it unchanged fails again.",
  },
  unauthenticated: {
    status: 401,
    retryable: false,
    action:
      "The login or token was not accepted; repeating unchanged does not help. If OHMYHOST_TOKEN is set, it was revoked, mistyped or belongs to a different platform than OHMYHOST_ENVIRONMENT selects (a platform setting, not the project's dev or prod): ask the customer for a current token from the portal's API Tokens page, or unset it and run 'ohmyhost login --json'. Otherwise run 'ohmyhost login --json', then repeat the request.",
    title: "Authentication required",
    restAction:
      "The login or token was not accepted; repeating unchanged does not help. If OHMYHOST_TOKEN is set, it was revoked, mistyped or belongs to a different platform than OHMYHOST_ENVIRONMENT selects (a platform setting, not the project's dev or prod): ask the customer for a current token from the portal's API Tokens page, or unset it and run 'ohmyhost login --json'. Otherwise run 'ohmyhost login --json', then repeat the request.",
  },
  forbidden: {
    status: 403,
    retryable: false,
    action:
      "This login may not do this; repeating unchanged does not help. error.acting_as names the login used: use a workspace this login belongs to ('ohmyhost whoami --json'), or the login of the account that owns it. For 'organization create', pass --source exactly as the Signup source on the portal Profile page, or omit it when that page shows Direct.",
    title: "Forbidden",
    restAction:
      "This identity may not do this; repeating unchanged does not help. Use a workspace this identity belongs to. A new workspace must preserve the signup source already recorded for this user; a scoped API token may create another workspace through the ordinary authorized flow.",
  },
  organization_required: {
    status: 409,
    retryable: false,
    action:
      "Run 'ohmyhost organization list --json' and select one with 'ohmyhost organization use --organization ULID --json', or create the first workspace.",
    title: "Workspace selection required",
  },
  resource_not_found: {
    status: 404,
    retryable: false,
    action:
      "Check the resource identifier and the account: a project is visible only to its own organization, and error.acting_as in the CLI and MCP names the login this ran as. Use the login of the account that owns it.",
    title: "Resource not found",
  },
  idempotency_key_reused: {
    status: 409,
    retryable: false,
    action:
      "This key was already used for a request with different arguments or from another login. To repeat that original request, send exactly its original arguments with this key from the same login; for a new request, use a new key. Never pair a new key with a request whose first attempt had an uncertain outcome: read its result first.",
    title: "Idempotency key reused",
    restAction:
      "This key was already used for a request with different arguments or from another login. To repeat that original request, send exactly its original arguments with this key from the same login; for a new request, use a new key. Never pair a new key with a request whose first attempt had an uncertain outcome: read its result first.",
  },
  project_handle_unavailable: {
    status: 503,
    retryable: true,
    action: "Retry project creation with the same idempotency key.",
    title: "Project handle unavailable",
  },
  project_handle_taken: {
    status: 409,
    retryable: false,
    action:
      "Another project uses this address. Run 'ohmyhost project handle check --handle NAME --json' and offer the customer its alternatives; rename only to the one they choose.",
    title: "Project address is taken",
    restAction:
      "Another project uses this address. Run 'ohmyhost project handle check --handle NAME --json' and offer the customer its alternatives; rename only to the one they choose.",
  },
  project_handle_invalid: {
    status: 409,
    retryable: false,
    action:
      "Choose one to five lowercase words of letters and digits, three to fifty-nine characters, avoiding reserved words.",
    title: "Project address is invalid",
  },
  project_handle_unchanged: {
    status: 409,
    retryable: false,
    action: "The project already answers on this address; no rename is needed.",
    title: "Project address is unchanged",
  },
  project_rename_blocked: {
    status: 409,
    retryable: true,
    action:
      "Wait for the running operation to finish, read the project again, then rename with the new ETag.",
    title: "Project address change blocked",
  },
  project_identity_unavailable: {
    status: 503,
    retryable: true,
    action: "Retry project creation with the same idempotency key.",
    title: "Project identity unavailable",
  },
  deployment_plan_expired: {
    status: 409,
    retryable: false,
    action: "Run 'ohmyhost plan' again, then deploy the new plan.",
    title: "Deployment plan expired",
  },
  deployment_plan_incompatible: {
    status: 409,
    retryable: false,
    action: "Run 'ohmyhost plan' again with the current source revision.",
    title: "Deployment plan incompatible",
  },
  confirmation_expired: {
    status: 409,
    retryable: false,
    action: "Plan the destructive action again before confirming it.",
    title: "Confirmation expired",
  },
  confirmation_invalid: {
    status: 409,
    retryable: false,
    action:
      "The confirmation token does not match this action or the project's current state. A deletion is also refused while a SQL export of the project is being captured, for up to about ten minutes ('ohmyhost export get'). Then create a new plan and confirm with its confirmation_token and resource_etag before the token expires.",
    title: "Confirmation invalid",
    restAction:
      "The confirmation token does not match this action or the project's current state. A deletion is also refused while a SQL export of the project is being captured, for up to about ten minutes ('ohmyhost export get'). Then create a new plan and confirm with its confirmation_token and resource_etag before the token expires.",
  },
  etag_mismatch: {
    status: 409,
    retryable: false,
    action:
      "The project changed after you read its ETag. For a rename, read etag from 'ohmyhost project status --project ULID --json' and repeat 'ohmyhost project handle set' with it. For a rollback, promotion or deletion, create a new plan and confirm with its resource_etag and confirmation_token.",
    title: "Resource changed",
    restAction:
      "The project changed after you read its ETag. For a rename, read etag from 'ohmyhost project status --project ULID --json' and repeat 'ohmyhost project handle set' with it. For a rollback, promotion or deletion, create a new plan and confirm with its resource_etag and confirmation_token.",
  },
  promotion_source_stale: {
    status: 409,
    retryable: false,
    action: "Read the current dev deployment, then plan promotion again.",
    title: "Promotion source changed",
  },
  promotion_target_stale: {
    status: 409,
    retryable: false,
    action: "Read the current prod status, then plan promotion again.",
    title: "Promotion target changed",
  },
  promotion_invalid_target: {
    status: 409,
    retryable: false,
    action: "Select the current succeeded dev deployment and target prod.",
    title: "Promotion target invalid",
  },
  mail_capacity_unavailable: {
    status: 503,
    retryable: true,
    action:
      "Report this request ID through feedback. The stored mail setup continues automatically once ohmyho.st has capacity; follow mail status and keep the original idempotency key.",
    title: "Mail capacity unavailable",
  },
  mail_domain_conflict: {
    status: 409,
    retryable: false,
    action:
      "Use the sender domain already configured for this project, or retire it with 'ohmyhost mail domain delete' (repeat while the removal is pending) and then set up the new domain; a domain registered to another project cannot be set up.",
    title: "Mail domain conflict",
  },
  mail_domain_required: {
    status: 409,
    retryable: false,
    action:
      "This app declares mail.enabled. Configure the project's own sender domain with 'ohmyhost mail setup' using its Prod environment ID, or set mail.enabled to false if the app sends no mail, then plan again.",
    title: "Mail domain required",
  },
  storage_jurisdiction_conflict: {
    status: 409,
    retryable: false,
    action:
      "Set storage.jurisdiction in ohmyhost.yaml to the project's region (us or eu) shown by 'ohmyhost project status', commit and push, then plan the new commit (for a promotion, deploy it to Dev and promote again); the unchanged commit fails again. A project cannot move its files between regions; do not delete or recreate the project to change it.",
    title: "Storage jurisdiction conflict",
    restAction:
      "Set storage.jurisdiction in ohmyhost.yaml to the project's region (us or eu) shown by 'ohmyhost project status', commit and push, then plan the new commit (for a promotion, deploy it to Dev and promote again); the unchanged commit fails again. A project cannot move its files between regions; do not delete or recreate the project to change it.",
  },
  shared_data_requires_promotion: {
    status: 409,
    retryable: false,
    action:
      "Plan and deploy this commit to Dev, then run 'ohmyhost deployment promote plan' to reach Prod.",
    title: "Shared data requires promotion",
  },
  production_deployment_required: {
    status: 409,
    retryable: false,
    action:
      "Deploy to Prod first: run 'ohmyhost plan --environment prod' and deploy that plan, or promote the current Dev deployment with 'ohmyhost deployment promote plan'. Then plan the domain again.",
    title: "Production deployment required",
  },
  framework_conversion_required: {
    status: 409,
    retryable: false,
    action:
      "Read detail for the file, reason and required change. Run ohmyhost init --dry-run --json at that commit, apply its blockers and the matching ohmyho.st framework Skill, then commit and push. Plan the new commit; repeating the unchanged source cannot fix an admission error.",
    title: "Framework conversion required",
    restAction:
      "Read detail for the file, reason and required change. Run ohmyhost init --dry-run --json at that commit, apply its blockers and the matching ohmyho.st framework Skill, then commit and push. Plan the new commit; repeating the unchanged source cannot fix an admission error.",
  },
  repository_configuration_missing: {
    status: 409,
    retryable: false,
    action:
      "The planned commit has no ohmyhost.yaml at the Git repository root. If the repository has none, run 'ohmyhost init --json' at the root (--root DIR when the app lives in a subdirectory, --region eu for an EU project). Otherwise move the existing file to the root and set applicationRoot to the app directory, for example website. Commit and push, then plan the new commit.",
    title: "Repository configuration missing",
    restAction:
      "The planned commit has no ohmyhost.yaml at the Git repository root. If the repository has none, run 'ohmyhost init --json' at the root (--root DIR when the app lives in a subdirectory, --region eu for an EU project). Otherwise move the existing file to the root and set applicationRoot to the app directory, for example website. Commit and push, then plan the new commit.",
  },
  migration_filename_noncanonical: {
    status: 409,
    retryable: false,
    action:
      "Every file in the migrations directory (database.migrations in ohmyhost.yaml) must be named YYYYMMDDHHMMSS_name.sql: 14 digits, an underscore, then lowercase letters, digits, _ or -. Rename each file that does not match and move any other file, such as README.md or .gitkeep, out of that directory. Commit and push, then plan the new commit. Never rename a migration a deployment already applied.",
    title: "Migration filename noncanonical",
    restAction:
      "Every file in the migrations directory (database.migrations in ohmyhost.yaml) must be named YYYYMMDDHHMMSS_name.sql: 14 digits, an underscore, then lowercase letters, digits, _ or -. Rename each file that does not match and move any other file, such as README.md or .gitkeep, out of that directory. Commit and push, then plan the new commit. Never rename a migration a deployment already applied.",
  },
  environment_secret_mutation_blocked: {
    status: 409,
    retryable: true,
    action: "Wait for the active deployment or rollback to finish, then retry unchanged.",
    title: "Environment secret mutation blocked",
  },
  workers_runtime_incompatible: {
    status: 409,
    retryable: false,
    action:
      "A Next.js file under app/, pages/, middleware or proxy imports a native addon (.node) or a Node.js module that does not run on Workers: child_process, cluster, dgram, domain, http2, inspector, readline, repl, sqlite, trace_events, tty, v8, vm, wasi, worker_threads or _stream_wrap, with or without node:. Remove or replace that import, commit and push, then plan the new commit.",
    title: "Workers runtime incompatible",
    restAction:
      "A Next.js file under app/, pages/, middleware or proxy imports a native addon (.node) or a Node.js module that does not run on Workers: child_process, cluster, dgram, domain, http2, inspector, readline, repl, sqlite, trace_events, tty, v8, vm, wasi, worker_threads or _stream_wrap, with or without node:. Remove or replace that import, commit and push, then plan the new commit.",
  },
  payload_too_large: {
    status: 413,
    retryable: false,
    action: "Reduce the request size.",
    title: "Payload too large",
  },
  project_export_not_ready: {
    status: 409,
    retryable: false,
    action:
      "No database of this project is ready, so no export was accepted. A database is created when a commit whose ohmyhost.yaml sets database.enabled: true is deployed; request the export again after that deployment succeeds ('ohmyhost operation get OPERATION_ID --json'). A project without a database has no SQL export.",
    title: "Project database not ready for export",
    restAction:
      "No database of this project is ready, so no export was accepted. A database is created when a commit whose ohmyhost.yaml sets database.enabled: true is deployed; request the export again after that deployment succeeds ('ohmyhost operation get OPERATION_ID --json'). A project without a database has no SQL export.",
  },
  powered_by_flag_required: {
    status: 409,
    retryable: false,
    action:
      "Keep the flag on, remove the custom domain with 'ohmyhost domain paid delete', or buy Paid, then switch the flag off.",
    title: "Powered-by flag required",
  },
  rate_limited: {
    status: 429,
    retryable: true,
    action:
      "Too many requests. Wait retry_after_seconds, or 60 seconds when none is shown, then repeat the same request with the same idempotency key. SQL exports allow one request per project per rolling 24 hours: poll the export already requested with 'ohmyhost export get EXPORT_ID --project ULID --json' instead of creating another.",
    title: "Rate limited",
    restAction:
      "Wait the Retry-After interval (also retry_after_seconds), then repeat the same request with the same idempotency key.",
  },
  insufficient_organization_credits: {
    status: 402,
    retryable: false,
    action:
      "Add organization credits or wait for reservations to settle, then retry the same request.",
    title: "Insufficient organization credits",
  },
  project_budget_exceeded: {
    status: 402,
    retryable: false,
    action:
      "This project's Stop budget for the current UTC month is reached; nothing was started. Show the customer 'ohmyhost budget get --project ULID --json'. Only on their request raise the limit or switch the mode to continue with 'ohmyhost budget set', then retry the same request; otherwise wait for the next UTC month.",
    title: "Project budget exceeded",
    restAction:
      "This project's Stop budget for the current UTC month is reached; nothing was started. Show the customer 'ohmyhost budget get --project ULID --json'. Only on their request raise the limit or switch the mode to continue with 'ohmyhost budget set', then retry the same request; otherwise wait for the next UTC month.",
  },
  paid_plan_required: {
    status: 402,
    retryable: false,
    action:
      "Ask the organization Owner to activate Paid through billing checkout, then retry. Top-ups and signup credits do not activate Paid. For a website domain alone, a Free workspace may instead show the powered-by flag on the project.",
    title: "Paid plan required",
  },
  interactive_login_required: {
    status: 403,
    retryable: false,
    action:
      "Unset OHMYHOST_TOKEN and run ohmyhost login before managing tokens. Existing token files remain unchanged.",
    title: "Interactive login required",
  },
  api_key_creation_uncertain: {
    status: 503,
    retryable: true,
    action:
      "Repeat the original token name and Idempotency-Key to observe its result; do not blindly create another key.",
    title: "Token creation unconfirmed",
  },
  api_key_permissions_unavailable: {
    status: 503,
    retryable: false,
    action:
      "Report the platform user-key permission configuration through feedback. Repeated login or creation will not fix it.",
    title: "Token permissions unavailable",
  },
  reconciliation_exhausted: {
    status: 409,
    retryable: false,
    action:
      "Stop retries and submit feedback with this operation ID. A platform recovery review is required.",
    title: "Recovery attempts exhausted",
  },
  service_unavailable: {
    status: 503,
    retryable: true,
    action:
      "The service could not complete or confirm this request; it may already have taken effect. Wait, then repeat exactly the same request with the same idempotency key, waiting longer each time; never switch to a new key. If 'ohmyhost plan' keeps failing, check that the commit is pushed to the linked repository and that 'ohmyhost init --dry-run --json' at that commit reports no blockers. If it still fails, report the request_id through feedback.",
    title: "Service unavailable",
    restAction:
      "The service could not complete or confirm this request; it may already have taken effect. Wait, then repeat exactly the same request with the same idempotency key, waiting longer each time; never switch to a new key. If 'ohmyhost plan' keeps failing, check that the commit is pushed to the linked repository and that 'ohmyhost init --dry-run --json' at that commit reports no blockers. If it still fails, report the request_id through feedback.",
  },
  source_commit_not_found: {
    status: 409,
    retryable: false,
    action:
      "The requested commit is not in the linked repository. Push that exact commit to the repository named by project status, or select a commit already there, then run 'ohmyhost plan' with its full SHA. Repeating the unchanged unavailable commit cannot work.",
    restAction:
      "The requested commit is not in the linked repository. Push that exact commit to the repository named by project status, or select a commit already there, then run 'ohmyhost plan' with its full SHA. Repeating the unchanged unavailable commit cannot work.",
    title: "Source commit not found",
  },
  domain_hostname_taken: {
    status: 409,
    retryable: false,
    action:
      "A live project connection already holds this hostname. Remove it from the project you manage with 'ohmyhost domain paid delete --project ULID --hostname HOST --yes --json', then apply it to the new project. Repeating while that connection remains cannot work; report the request_id if you cannot manage its owning project.",
    restAction:
      "A live project connection already holds this hostname. Remove it from the project you manage with 'ohmyhost domain paid delete --project ULID --hostname HOST --yes --json', then apply it to the new project. Repeating while that connection remains cannot work; report the request_id if you cannot manage its owning project.",
    title: "Domain hostname is already connected",
  },
  domain_dns_conflict: {
    status: 409,
    retryable: false,
    action:
      "Review DNS for the requested hostname and resolve the conflicting delegation or another project's managed records. Preserve mailbox MX, TXT and CAA records. Then repeat the original domain paid apply or delete with the same hostname and idempotency key; do not create another deployment or repeatedly resubmit unchanged conflicts.",
    title: "Domain DNS records conflict",
  },
  data_change_blocked: {
    status: 409,
    retryable: true,
    action:
      "An operation of this project is still running. Wait until 'ohmyhost operation get OPERATION_ULID --json' shows it finished, plan the data change again and confirm it with the new ETag and token.",
    restAction:
      "An operation of this project is still running. Wait until 'ohmyhost operation get OPERATION_ULID --json' shows it finished, plan the data change again and confirm it with the new ETag and token.",
    title: "Data change blocked",
  },
  data_change_in_progress: {
    status: 409,
    retryable: true,
    action:
      "A data change of this project is running. Wait until its operation has finished ('ohmyhost project status --project ULID --json'), then repeat the request unchanged.",
    restAction:
      "A data change of this project is running. Wait until its operation has finished ('ohmyhost project status --project ULID --json'), then repeat the request unchanged.",
    title: "Data change in progress",
  },
  data_change_not_applicable: {
    status: 409,
    retryable: false,
    action:
      "Read 'ohmyhost project status --project ULID --json'. Isolation applies to shared projects; returning to shared needs a deployed Prod database, and reset_dev applies to isolated projects. If detail names an old database or storage binding, deploy the affected environment again before planning the change. Repeating unchanged does not help.",
    restAction:
      "Read 'ohmyhost project status --project ULID --json'. Isolation applies to shared projects; returning to shared needs a deployed Prod database, and reset_dev applies to isolated projects. If detail names an old database or storage binding, deploy the affected environment again before planning the change. Repeating unchanged does not help.",
    title: "Data change is not applicable",
  },
  rollback_target_data_changed: {
    status: 409,
    retryable: false,
    action:
      "This deployment used a data area its environment no longer has. Deploy that commit again with a fresh plan instead of rolling back to its old bindings; repeating this rollback cannot work.",
    restAction:
      "This deployment used a data area its environment no longer has. Deploy that commit again with a fresh plan instead of rolling back to its old bindings; repeating this rollback cannot work.",
    title: "Rollback data area changed",
  },
  project_domain_delete_required: {
    status: 409,
    retryable: false,
    title: "Remove the project domain first",
    action:
      "This project still has a live or pending custom-domain connection. Read 'ohmyhost domain paid status --project ULID --json', remove that connection with 'ohmyhost domain paid delete --project ULID --hostname HOST --yes --json', then create a fresh project deletion plan. Repeating while it remains connected cannot work.",
  },
} as const;

export type ProblemCode = keyof typeof PROBLEM_POLICY;
