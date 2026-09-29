<!-- Generated from the npm registry tarball of @amerged/ohmyhost-mcp@0.1.27; the next release replaces any edit. -->

# ohmyho.st MCP server

The local MCP server of [ohmyho.st](https://ohmyho.st), hosting that a coding agent operates. It runs over stdio next to Codex, Claude Code, Cursor, Hermes or OpenClaw and lets the agent deploy the user's GitHub apps and manage their databases, domains, mail, usage and budgets with the access the user grants. It is also how the agent reaches ohmyho.st support.

Version 0.1.27 · [npm](https://www.npmjs.com/package/@amerged/ohmyhost-mcp) · Node.js 22 or newer · [release.json](release.json)

This repository mirrors the source published in the npm package `@amerged/ohmyhost-mcp`. Every release replaces it from the registry tarball, so pull requests are not merged here; report a problem through your agent (see Support below).

## Install

```sh
npm install --global @amerged/ohmyhost-cli @amerged/ohmyhost-mcp
export OHMYHOST_ENVIRONMENT=production
ohmyhost login --json
```

Installed the clients from the ohmyho.st release archives before? Remove them first with `npm uninstall --global @ohmyhost/product-cli @ohmyhost/mcp`: both installs provide the `ohmyhost` and `ohmyhost-mcp` commands, and npm stops the second one with EEXIST.

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

- `billing_checkout_create`: Owner-only: create or resume a hosted Checkout.
- `billing_checkout_get`: Owner-only: observe the original checkout and reconcile confirmed credits/refunds, without another purchase.
- `billing_portal_create`: Owner-only: return a short-lived Stripe portal URL to the human for invoices, payment methods or cancellation at period end.
- `billing_recharge_configure`: Owner-only: enable or disable automatic off-session payments.
- `billing_recharge_get`: Owner-only: read auto-recharge consent, spending limit and payment handoff.
- `database_access_create`: Issue a time-bound PostgreSQL credential for this project's own Dev or Prod database.
- `database_access_list`: List this project's issued database credentials with their state (active, expired or revoked).
- `database_access_revoke`: Revoke one issued database credential immediately: open sessions end and its PostgreSQL role is removed.
- `database_compute_get`: Read current managed database size, memory, region and compute state without running SQL or waking the database.
- `database_compute_set`: Select standard or performance compute for an existing database: Free 0.25 CU/1 GB/60-second idle suspension, Paid 0.5 CU/2 GB/60-second idle suspension.
- `database_query`: Read one owner-authorized Dev or Prod database query (at most 100 rows, five-second timeout).
- `database_write`: Execute one explicitly authorized INSERT, UPDATE or DELETE/upsert in the chosen Dev or Prod database.
- `delete_execute`: Execute a reviewed project deletion
- `delete_plan`: Plan complete project deletion
- `deployment_create`: Start a reviewed deployment plan
- `deployment_get`: Get one deployment
- `deployment_logs`: List the newest normalized diagnostics of one deployment (build, control, runtime and function failures with catalog codes).
- `deployment_plan`: Plan an immutable deployment.
- `deployments_list`: List project deployments
- `domain_cloudflare_authorize`: Check domain_cloudflare_status first and reuse a valid matching grant.
- `domain_cloudflare_status`: Read the project's customer DNS authorization state, zone, scopes and expiry without credentials.
- `domain_paid_apply`: Declare or activate the explicitly requested customer hostname.
- `domain_paid_delete`: Delete only the explicitly named project's stored customer hostname/route and owned DNS records.
- `domain_paid_plan`: Plan a customer-owned production hostname before or after the first Prod deployment.
- `domain_paid_status`: Read DNS/TLS and effective Paid-domain access.
- `feedback_status`: Read the status of a feedback receipt you submitted and ohmyho.st's customer-visible replies: received, in_review, planned, in_progress, resolved (the fix is live in the named release) or closed (with an explanation).
- `feedback_submit`: Report a bug, suspected issue or feature request to ohmyho.st.
- `function_runs_list`: List the newest scheduled function runs (functions.crons) of an environment: one run per due UTC minute with state, attempt, the status the scheduled handler returned and timing.
- `github_connect`: Owner or Admin: connect GitHub once for this workspace.
- `github_status`: Read this workspace's GitHub connection.
- `identity_get`: Get the ohmyho.st customer/agent identity this call acts as: user, organization and, in context, the saved login or OHMYHOST_TOKEN that supplied it.
- `mail_domain_delete`: Retire the project's mail domain while the project stays active; use its Prod environment ID.
- `mail_domain_set`: Configure the project's one production mail domain using its Prod environment ID.
- `mail_domain_status`: Read separate sending and receiving readiness and exact DNS records for the project’s production mail domain.
- `mail_message_get`: Read only this project's Prod-received message before the hard 72-hour expiry.
- `mail_message_retry`: Retry the Prod customer webhook within its shared budget: initial attempt plus at most three retries, all before 72 hours from receipt.
- `mail_messages_list`: List the Prod environment's owned handoff metadata younger than 72 hours.
- `mail_setup`: Configure the customer's one production mail domain using the project Prod environment ID, only when the customer wants mail or the app declares mail.enabled; hosting needs no mail domain and none is registered automatically.
- `mail_status`: Read sending and receiving readiness and exact DNS records for the project’s one production mail domain.
- `mail_webhook_disable`: Disable receiving on the project's Prod mail domain and remove its webhook; existing message content becomes inaccessible.
- `mail_webhook_set`: Set the required HTTPS endpoint on the project's Prod application using its Prod environment ID.
- `mail_webhook_verify`: Send a signed test to the Prod application endpoint and enable receiving after it accepts the event.
- `operation_get`: Get durable operation status and current deployment progress/reconciliation guidance.
- `operation_logs`: Read available operation events for at most ten seconds, stopping earlier at max_events or a terminal event.
- `operation_reconcile`: Start an explicitly confirmed provider reconciliation attempt
- `organization_account_get`: Owner-only: read the effective Free/Paid plan, its Stripe or granted source, available monthly credits that expire at period end and top-up credits that carry over while Paid but expire on downgrade to Free, reservations and next expiry.
- `organization_create`: Create an organization owned by the signed-in user.
- `organization_credits_get`: Read the owner's shared organization credit pool, seven-day grace_started_at/grace_expires_at and published rate_cards.
- `organization_list`: List the workspaces the chosen login's user belongs to and which one that login is scoped to.
- `organization_usage_get`: Read posted UTC-month usage by project, environment and published meter/rate.
- `organization_use`: Bind a saved login that has no organization yet to one workspace, so later calls act inside it.
- `powered_by_flag_get`: Read whether the production site shows the opt-in "Powered by ohmyho.st" flag.
- `powered_by_flag_set`: Owner only, ask the human first: show or hide a small "Powered by ohmyho.st" flag on the right edge of the production site.
- `profile_list`: List the saved ohmyho.st logins on this computer: each has a name, a user and an organization, never a token.
- `project_budget_get`: Read the owner's project UTC-month budget, measured usage and open reservations.
- `project_budget_set`: Set an owner's optional monthly project budget in microcredits (1000000 = one credit).
- `project_context_get`: Read fresh project status, DNS/mail next actions, authorized usage and bounded shared notes.
- `project_create`: Create an ohmyho.st project.
- `project_data_change`: Owner only: execute the exact reviewed project_data_plan after explicit customer confirmation.
- `project_data_plan`: Owner only: plan a Dev/Prod data assignment change and review the data, files, deployments and database logins it keeps or removes.
- `project_dev_access_create`: Create an owner-only one-hour single-use access link for the protected Dev app.
- `project_dev_access_mode_set`: Owner only: choose public Dev (no platform token) or protected Dev (share link required).
- `project_dev_share_link_get`: Owner only: get or create the persistent protected Dev link.
- `project_dev_share_link_revoke`: Owner only: revoke the persistent Dev link and active sessions immediately without changing the Dev access mode.
- `project_dev_share_link_rotate`: Owner only: replace the persistent Dev link and immediately revoke old links and sessions.
- `project_export_create`: Owner-only: request an asynchronous password-encrypted SQL ZIP, including at zero credits.
- `project_export_get`: Owner-only: read the original SQL ZIP export's progress/error and verified download URL.
- `project_get`: Get one project
- `project_handle_check`: Check whether a project address is free before offering it to the customer.
- `project_handle_set`: Move a project to an address the customer chose, after project_handle_check said it is free.
- `project_notes_set`: Save shared project to-dos, at most 250 lines / 16384 UTF-8 bytes.
- `project_status`: Get source, both Dev/Prod environment IDs, deployment URLs, Dev access mode, latest operation and cleanup status.
- `projects_list`: List projects visible to the current identity
- `promotion_execute`: Execute an explicitly confirmed Dev-to-Prod promotion using the unchanged plan guards.
- `promotion_plan`: Plan promotion of the current Dev artifact to Prod without a rebuild.
- `referral_link_get`: Read the workspace's referral link to share.
- `rollback_execute`: Execute a reviewed rollback
- `rollback_plan`: Plan a rollback
- `secret_delete`: Delete an environment secret
- `secret_set_command`: Return the stdin-only CLI command for setting a secret; the value never enters MCP.
- `secrets_list`: List secret metadata without values
- `source_get`: Get linked source status
- `source_link`: Link a repository covered by the workspace GitHub connection.
- `token_create`: Create your own non-expiring API token after interactive login and save it to the selected private env file.
- `token_revoke`: Revoke one of your own API tokens after explicit confirmation and interactive login.
- `tokens_list`: List your token metadata after interactive login.

The full descriptions and input schemas are in the [tool catalog](https://ohmyho.st/mcp-tools.json).

## Skills and support

- [MCP setup guide](https://docs.ohmyho.st/agents/mcp)
- [Get-started Skill](https://ohmyho.st/skills/ohmyhost-get-started/SKILL.md) and the [Skill index](https://ohmyho.st/.well-known/agent-skills/index.json); the server also serves every Skill as an MCP resource.
- [Support](https://docs.ohmyho.st/support): ask your agent; it reports through `feedback_submit` and follows up with `feedback_status`.
- [Current client release](https://ohmyho.st/client-release.json)

## What is here

`src/` holds the TypeScript and JavaScript source of the server and the client code it bundles: `apps/mcp`, the command-line client `apps/product-cli`, the generated REST client `packages/sdk-ts`, `packages/contracts`, `packages/workos-auth-contracts` and the Skills in `packages/agent-skills`. `package.json`, `LICENSE`, `NOTICE` and `THIRD_PARTY_NOTICES.md` are the package's own. The built `dist/` bundle and the package README are not copied; `release.json` lists their SHA-256 digests, so this repository plus those files is the published tarball. `npm view @amerged/ohmyhost-mcp@0.1.27 dist.integrity` equals `npm.integrity` in `release.json`.

## Licence

Apache-2.0 applies to the Amerged client code (`LICENSE`, `NOTICE`). Third-party code bundled in the npm package keeps its own licences (`THIRD_PARTY_NOTICES.md`). The hosted platform that runs projects is private and not included; using it is subject to the [terms](https://ohmyho.st/terms).
