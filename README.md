<!-- Generated from the npm registry tarball of @amerged/ohmyhost-mcp@0.1.85; the next release replaces any edit. -->

# ohmyho.st MCP server

The local MCP server of [ohmyho.st](https://ohmyho.st), hosting that a coding agent operates. It runs over stdio next to Codex, Claude Code, Cursor, Hermes or OpenClaw and lets the agent deploy the user's GitHub apps and manage their databases, domains, mail, usage and budgets with the access the user grants. It is also how the agent reaches ohmyho.st support.

Version 0.1.85 · [npm](https://www.npmjs.com/package/@amerged/ohmyhost-mcp) · Node.js 22 or newer · [release.json](release.json)

This repository mirrors the source published in the npm package `@amerged/ohmyhost-mcp`. Every release replaces it from the registry tarball, so pull requests are not merged here; report a problem through your agent (see Support below).

## Install

```sh
npm install --global @amerged/ohmyhost-cli @amerged/ohmyhost-mcp
export OHMYHOST_ENVIRONMENT=production
ohmyhost login --json
```

Installed the clients from the ohmyho.st release archives before? Remove them first with `npm uninstall --global @amerged/ohmyhost-cli @amerged/ohmyhost-mcp`: both installs provide the `ohmyhost` and `ohmyhost-mcp` commands, and npm stops the second one with EEXIST.

## Register it with your agent

| Harness     | Register the local server                                                                                                               | Confirm in the running harness                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Codex       | `codex mcp add ohmyho --env OHMYHOST_ENVIRONMENT=production -- ohmyhost-mcp`                                                            | Reload if requested; call `identity_get` and read the Skill resources.                                      |
| Claude Code | `claude mcp add --transport stdio --scope user --env OHMYHOST_ENVIRONMENT=production ohmyho -- ohmyhost-mcp`                            | Open `/mcp`, confirm connection and call `identity_get`.                                                    |
| Cursor      | Merge the token-free https://ohmyho.st/mcp.json server into the existing global or project MCP config.                                  | Confirm in settings; current CLI supports `agent mcp list-tools ohmyho`. Resolve installed executable/help. |
| Hermes      | `hermes mcp add ohmyho --command ohmyhost-mcp --env OHMYHOST_ENVIRONMENT=production`                                                    | `hermes mcp test ohmyho`, then reload the agent session.                                                    |
| OpenClaw    | `openclaw mcp add ohmyho --command ohmyhost-mcp --env OHMYHOST_ENVIRONMENT=production` where the installed native registry supports it. | `openclaw mcp probe ohmyho --json`, then verify runtime-visible tools.                                      |

Confirm the connection and call `identity_get`; a saved configuration alone is not a working connection.

## Authenticate

Authenticate one of two ways: load `OHMYHOST_TOKEN` from a private credential source into the server environment, or sign in with `ohmyhost login --json` and let MCP use the saved logins. With several saved logins, pass `profile_name` on each call (`profile_list` shows the names), or bind the server to one login with `OHMYHOST_PROFILE=NAME` next to `OHMYHOST_ENVIRONMENT`; a bound server refuses calls for another login (`profile_context_mismatch`). A server registered for the user serves every session on this computer, so bind it only when the customer asks, and reload it afterwards. The token wins wherever it is set and needs no browser. New user API tokens are optional and remain valid until revoked; the portal shows a new value once, while CLI/MCP token creation saves it directly to the chosen private env file. Login and token lifetimes are separate.

Keep tokens out of shared or committed MCP configuration; the public configuration carries only `OHMYHOST_ENVIRONMENT=production`.

## Tools

- `application_domain_identity_authorization_revoke`: Revoke the current application identity DNS grant with `confirmed: true`.
- `application_domain_identity_authorization_status`: Read the selected project application-domain identity DNS authorization status.
- `application_domain_identity_authorize`: Create a private Cloudflare consent URL for writing this project's hostname ownership challenge at its current revision.
- `application_domain_identity_declare`: Record the intended customer application hostname and return a project-bound TXT challenge.
- `application_domain_identity_get`: Read the project intended application hostname, current revision and ownership proof.
- `application_domain_identity_revoke`: Revoke only the selected current application-domain proof with `confirmed: true`.
- `application_domain_identity_verify`: Verify the exact current project and hostname TXT challenge independently of deployment.
- `billing_checkout_create`: Owner-only.
- `billing_checkout_get`: Owner-only.
- `billing_portal_create`: Owner-only: return a short-lived Stripe portal URL to the human for invoices, payment methods or cancellation at period end.
- `billing_recharge_configure`: Owner-only: enable or disable automatic off-session payments.
- `billing_recharge_get`: Owner-only.
- `container_job_cancel`: Request cancellation of exactly one run.
- `container_job_get`: Read the job state, confirmed cost and ordered output file IDs.
- `container_job_input_upload`: Create a short-lived PUT grant for one bounded private input or parameters file.
- `container_job_output_download`: Get a short-lived GET grant for one committed output of a successful run.
- `container_job_quote`: Return the expiring maximum run charge in microcredits for a ready version, ordered private file IDs and optional parameters file.
- `container_job_start`: Accept a previously quoted job, reserve up to the specified microcredits and queue its isolated container.
- `container_job_version_get`: Read this project's job version and build status.
- `container_job_version_publish`: Publish one project job from its immutable saved source revision.
- `database_access_create`: Issue a time-bound PostgreSQL credential for this project's own Dev or Prod database.
- `database_access_list`: List this project's issued database credentials with their state (active, expired or revoked).
- `database_access_revoke`: Revoke one issued database credential immediately: open sessions end and its PostgreSQL role is removed.
- `database_compute_get`: Read current managed database memory, total storage, region and observed state without running SQL or waking the database.
- `database_compute_set`: Choose fixed database RAM: 256, 512, 1024, 2048 or 4096 MiB.
- `database_execution_usage_get`: Read metered database execution usage: schedule runs and webhook attempts per UTC hour or day window.
- `database_migrate`: Apply the migration files at commit_sha to the project's selected Dev or Prod database, provisioning it if needed.
- `database_query`: Read one owner-authorized Dev or Prod database query (at most 100 rows, five-second timeout).
- `database_schedule_delete`: Remove one database schedule so it never runs again.
- `database_schedule_list`: List this project's database schedules of one Dev or Prod environment (dev when omitted), with their cadence, statements, timeout and next run.
- `database_schedule_run_list`: List the newest runs of one database schedule, newest first, with each run's outcome (succeeded, failed, timed_out, outcome_unknown, rejected or a skipped reason) and SQLSTATE when one applies.
- `database_schedule_run_now`: Queue one immediate run of a database schedule.
- `database_schedule_set`: Create or replace a named database schedule in the selected Dev or Prod environment.
- `database_table_create`: Create one ordinary table in the public schema of a Dev or Prod database, as the migration role with the same access as migration tables, so a row-change watch can attach later.
- `database_watch_create`: Publish row changes of one table of a Dev or Prod database as data events: only the listed columns (at most 32) of each insert, update or delete are published, with the event type data.<topic> returned by this call.
- `database_watch_delete`: Remove the capture trigger of one database watch: its table publishes no more data events.
- `database_watch_list`: List this project's database watches of one Dev or Prod environment (dev when omitted).
- `database_webhook_create`: Subscribe one HTTPS receiver to database lifecycle events (database.created, ready, woke, slept, suspended, resized, deleted) of one Dev or Prod database, or to data events: data.<topic> for the rows of one watched table (use the topic from the table watch) or data.* for every watched table; `*` and `database.*` are refused; only data.<topic> or data.* subscribe to data events.
- `database_webhook_delete`: Stop all deliveries to one database webhook.
- `database_webhook_delivery_list`: List recent database webhook deliveries, newest first, optionally for one webhook.
- `database_webhook_delivery_replay`: Queue one more attempt for a database webhook delivery that is no longer being retried.
- `database_webhook_list`: List this project's database webhooks of one Dev or Prod environment (dev when omitted), without signing secrets.
- `database_webhook_subscription_activate`: Activate the specified subscription ULID and generation.
- `database_webhook_subscription_deactivate`: Deactivate one generation.
- `database_webhook_subscription_status`: Read a webhook subscription generation and state, without its signing secret.
- `database_webhook_test`: Send one signed test request to a database webhook and report the outcome synchronously.
- `database_write`: Execute one INSERT, UPDATE or DELETE/upsert in the chosen Dev or Prod database.
- `delete_execute`: Execute a planned deletion for one selected project using its if_match revision and ten-minute confirmation_token, removing its Dev and Prod deployments, databases, files, schedules, SQL exports, managed code history and project-owned routes, mail and DNS.
- `delete_plan`: Persist a ten-minute deletion plan for the selected project_id.
- `deployment_create`: Start a reviewed deployment plan.
- `deployment_get`: Get one deployment
- `deployment_logs`: List the newest normalized diagnostics of one deployment (build, control, runtime and function failures with catalog codes).
- `deployment_plan`: Plan an immutable deployment.
- `deployments_list`: List project deployments
- `domain_cloudflare_authorize`: Check the current DNS authorization status and reuse a valid matching grant.
- `domain_cloudflare_status`: Read the project's Cloudflare DNS authorization state, zone, scopes and expiry without exposing credentials.
- `domain_paid_apply`: Declare or activate the explicitly requested customer hostname.
- `domain_paid_delete`: Delete only the explicitly named project's stored customer hostname/route and owned DNS records.
- `domain_paid_plan`: Read a plan for connecting a customer-owned production hostname before or after the first Prod deployment, without changing DNS.
- `domain_paid_status`: Read DNS, TLS and effective access for the Paid domain, including the reason for any suspension.
- `feedback_status`: Read the status of a feedback receipt you submitted and ohmyho.st's customer-visible replies: received, in_review, planned, in_progress, resolved (the fix is live in the named release) or closed (with an explanation).
- `feedback_submit`: Submit a bug report, suspected issue or feature request to ohmyho.st with redacted expected and actual behavior and minimal reproduction steps.
- `function_runs_list`: List the newest scheduled function runs for one environment.
- `github_connect`: Owner or Admin.
- `github_disconnect`: Owner-only.
- `github_status`: Read this workspace's GitHub connection state.
- `identity_get`: Get the ohmyho.st customer/agent identity this call acts as: user and account email, scoped organization IDs and names, plan and remaining credits when authorized and available, and, in context, the saved login or OHMYHOST_TOKEN that supplied it.
- `integration_connection_begin`: Create a protected Make consent link for the selected workspace and signed-in user.
- `integration_connection_disconnect`: Disconnect a connection grant and revoke its provider credential.
- `integration_connection_discover`: Read accessible Make organizations, teams and connection metadata.
- `integration_connection_import`: Import a selected Make connection into an explicit project and environment.
- `integration_connection_list`: List the caller's workspace connection grants.
- `integration_connection_status`: Read a consent request status.
- `integration_credential_request_create`: Create a native Make Credential Request for selected standard app modules or Endpoints.
- `integration_credential_request_status`: Read the current Make status of a Credential Request owned by the selected workspace grant.
- `mail_binding_detach`: Detach only this project send binding with current revision and `confirmed: true`.
- `mail_binding_get`: Read the Prod sender binding and per-project From addresses, default From and default Reply-To.
- `mail_binding_set`: Attach a verified workspace sender or update its project settings.
- `mail_domain_delete`: Retire the project's mail domain while the project stays active; use its Prod environment ID.
- `mail_domain_set`: Configure the project's one production mail domain using its Prod environment ID.
- `mail_domain_status`: Read separate sending and receiving readiness, exact DNS records and the next-check interval for the project's production mail domain.
- `mail_message_get`: Read only this project's Prod-received message before the hard 72-hour expiry.
- `mail_message_retry`: Retry the Prod customer webhook within its shared budget: initial attempt plus at most three retries, all before 72 hours from receipt.
- `mail_messages_list`: List the Prod environment's owned handoff metadata younger than 72 hours.
- `mail_setup`: Configure the project's one production mail domain using its Prod environment ID.
- `mail_status`: Read sending and receiving readiness and exact DNS records for the project’s one production mail domain.
- `mail_webhook_disable`: Disable receiving on the project's Prod mail domain and remove its webhook; existing message content becomes inaccessible.
- `mail_webhook_rotate`: Owner-only.
- `mail_webhook_set`: Set the project's Prod mail webhook to the specified HTTPS endpoint and return its server-only signing secret.
- `mail_webhook_verify`: Send a signed test to the Prod application endpoint and enable receiving after it accepts the event.
- `native_auth_config_get`: Read Native Auth policy for one environment.
- `native_auth_config_set`: Update Owner Native Auth configuration at the current revision.
- `native_auth_provider_get`: Read provider setup without its secret.
- `native_auth_provider_secret_input_request`: Return an account-bound stdin-only command; never place a provider secret in MCP arguments.
- `native_auth_provider_set`: Update provider settings without submitting a secret.
- `native_auth_user_create`: Create and invite a Native Auth user without choosing a password.
- `native_auth_user_delete`: Delete an Owner-authorized Native Auth user.
- `native_auth_user_get`: Read a Native Auth user.
- `native_auth_user_invite`: Resend an Owner-authorized Native Auth user's invitation.
- `native_auth_user_reactivate`: Reactivate an Owner-authorized Native Auth user.
- `native_auth_user_revoke_sessions`: Revoke an Owner-authorized Native Auth user's sessions.
- `native_auth_user_suspend`: Suspend an Owner-authorized Native Auth user.
- `native_auth_users_list`: List Native Auth users with bounded pagination.
- `operation_get`: Read an operation by ID, including the last recorded provider verification step when available.
- `operation_logs`: Read a bounded snapshot of available operation events for at most ten seconds, stopping at max_events or a terminal event.
- `operation_reconcile`: Recover an operation in reconciliation_required using the original write's idempotency key and confirmed: true.
- `organization_account_get`: Owner-only: read the effective Free/Paid plan, its Stripe or granted source, the monthly credits that expire at next_expiry, the top-up and bonus credits that never expire, the reservations that hold part of them, and available_micros (monthly plus one-time minus reservations).
- `organization_create`: Create an organization owned by the signed-in user.
- `organization_credits_get`: Read the Owner's shared organization credit balance and seven-day zero-credit grace period.
- `organization_list`: List the workspaces the selected login belongs to and the workspace to which it is scoped.
- `organization_mcp_connection_revoke`: Owner only: disconnect one MCP client from this workspace only; the member's other workspaces are unaffected.
- `organization_mcp_connections_list`: Owner only: list the MCP clients connected to this workspace and the member who connected each, one entry per member, client and consent.
- `organization_usage_get`: Read the billed usage of the last up to 14 UTC days (today included) grouped by day, project and meter, and what each project has used so far this UTC month.
- `organization_use`: Bind an unscoped saved login to one workspace by its ohmyho.st organization ULID.
- `powered_by_flag_get`: Read whether the production site shows the opt-in "Powered by ohmyho.st" flag.
- `powered_by_flag_set`: Owner-only.
- `preview_get`: Read the private live preview for the specified project and environment.
- `preview_open`: Open or create a private live preview for the specified project and environment.
- `preview_rotate`: Rotate the preview URL and close old connections; the preview keeps its 24-hour deadline.
- `preview_stop`: Stop the preview and remove backups while preserving its URL until its 24-hour deadline.
- `profile_list`: List the saved ohmyho.st logins on this computer.
- `project_budget_get`: Read the owner's project UTC-month budget, this month's use and open reservations.
- `project_budget_set`: Set an owner's optional monthly project budget in microcredits (1000000 = one credit).
- `project_context_get`: Read fresh project status, DNS and mail readiness, authorized usage and bounded shared notes.
- `project_create`: Create an ohmyho.st project and return project_id and the queued operation ID.
- `project_data_change`: Owner-only.
- `project_data_plan`: Owner-only.
- `project_dev_access_create`: Create an owner-only one-hour single-use access link for the protected Dev site (Paid only).
- `project_dev_access_mode_set`: Owner only: choose public Dev (no platform token) or protected Dev (share link required).
- `project_dev_share_link_get`: Owner only: get or create the persistent share link for the protected Dev site (Paid only).
- `project_dev_share_link_revoke`: Owner only: revoke the persistent Dev link and active sessions immediately without changing the Dev access mode.
- `project_dev_share_link_rotate`: Owner only: replace the persistent Dev link and immediately revoke old links and sessions.
- `project_development_add`: Add Dev to an existing project and return an asynchronous operation.
- `project_export_create`: Owner-only: request an asynchronous password-encrypted SQL ZIP, including at zero credits.
- `project_export_download_link_create`: Owner-only.
- `project_export_get`: Owner-only.
- `project_get`: Get one project
- `project_handle_check`: Check whether a project address is available.
- `project_handle_set`: Move a project to an address the customer chose, after confirming it is available.
- `project_notes_set`: Save shared project notes up to 250 lines or 16,384 UTF-8 bytes.
- `project_status`: Get the project's source, existing environment IDs, deployment URLs, custom production domains, Dev access mode, latest operation and cleanup status.
- `projects_list`: List projects visible to the current identity
- `promotion_execute`: Execute an explicitly confirmed Dev-to-Prod promotion using the unchanged plan guards.
- `promotion_plan`: Plan promotion of the current Dev artifact to Prod without a rebuild.
- `referral_link_get`: Read the workspace's referral link to share.
- `rollback_execute`: Execute a reviewed rollback
- `rollback_plan`: Plan a rollback
- `secret_delete`: Delete an environment secret
- `secret_form_request`: Create a protected form for one to ten secret names of one environment and return its link (request_id, url, expires_at).
- `secret_form_status`: Read the outcome of a protected secret form for this environment and request_id: pending, expired, saved or incomplete, and once the form was submitted or expired each requested name as saved, failed or unconfirmed.
- `secret_set_command`: Return the stdin-only CLI command for setting a secret; the value never enters MCP.
- `secrets_list`: List secret metadata without values
- `source_changes`: Save an atomic file batch against the expected generation and parent commit.
- `source_diff`: Compare two managed versions without changing files or deployments.
- `source_file`: Read one managed source file with its exact hash and mode.
- `source_files`: List the exact managed source tree at a specified commit.
- `source_get`: Get linked source status and preparation guidance when pending.
- `source_initialize`: Create managed version history for an unbound project using the selected starter.
- `source_inspect`: Read local working-directory, Git/worktree, monorepo and sanitized remote context without sign-in.
- `source_link`: Link a GitHub repository covered by the workspace installation to the specified project.
- `source_publish`: Local MCP only: capture current filtered files, including uncommitted/new files, and save one managed version without importing Git history.
- `source_publish_complete`: Complete a local pending source publication for a successfully completed operation.
- `source_restore`: Restore an earlier managed file tree as a new version against current generation and parent.
- `source_upload`: Read the status of the specified managed snapshot upload.
- `source_versions`: Read managed version history for this project; next_commit_sha continues the same history page.
- `token_create`: Create your own non-expiring API token after interactive login and save it to the selected private env file.
- `token_revoke`: Revoke one of your own API tokens with `confirmed: true` after interactive login.
- `tokens_list`: List your token metadata after interactive login.
- `workspace_mail_domain_create`: Create one workspace-owned transactional sender domain.
- `workspace_mail_domain_dns_authorize`: Create a private Cloudflare consent URL for the selected workspace sender, zone and revision.
- `workspace_mail_domain_dns_revoke`: Revoke the selected workspace sender DNS grant at its current revision with `confirmed: true`.
- `workspace_mail_domain_dns_status`: Read exact workspace sender DNS authorization status.
- `workspace_mail_domain_get`: Read sender verification, lifecycle, revision and DNS records for one authorized workspace resource.
- `workspace_mail_domain_retire`: Retire an explicitly selected workspace sender only after every send and inbound reference is detached and provider effects settle.
- `workspace_mail_domains_list`: List only workspace sender domains this account and connected client may read.

The full descriptions and input schemas are in the [tool catalog](https://ohmyho.st/mcp-tools.json).

## Skills and support

- [MCP setup guide](https://docs.ohmyho.st/agents/mcp)
- [Get-started Skill](https://ohmyho.st/skills/ohmyhost-get-started/SKILL.md) and the [Skill index](https://ohmyho.st/.well-known/agent-skills/index.json); the server also serves every Skill as an MCP resource.
- [Support](https://docs.ohmyho.st/support): ask your agent; it reports through `feedback_submit` and follows up with `feedback_status`.
- [Current client release](https://ohmyho.st/client-release.json)
- [PGCF](https://github.com/amerged-org/cloudflare-postgres): the open-source PostgreSQL platform behind the `database_*` tools and the `psql` bridge.

## What is here

`src/` holds the TypeScript and JavaScript source of the server and the client code it bundles: `apps/mcp`, the command-line client `apps/product-cli`, the generated REST client `packages/sdk-ts`, `packages/contracts`, `packages/workos-auth-contracts` and the Skills in `packages/agent-skills`, and the loopback PostgreSQL transport `packages/postgres-bridge` with its own `LICENSE` and `NOTICE`. `package.json`, `LICENSE`, `NOTICE` and `THIRD_PARTY_NOTICES.md` are the package's own. The built `dist/` bundle and the package README are not copied; `release.json` lists their SHA-256 digests, so this repository plus those files is the published tarball. `npm view @amerged/ohmyhost-mcp@0.1.85 dist.integrity` equals `npm.integrity` in `release.json`.

## Licence

Apache-2.0 applies to the Amerged client code (`LICENSE`, `NOTICE`). Third-party code bundled in the npm package keeps its own licences (`THIRD_PARTY_NOTICES.md`). The [ohmyho.st platform source](https://github.com/amerged-org/ohmyhost) is available under Elastic License 2.0. The [terms](https://ohmyho.st/terms) apply to the hosted service.
