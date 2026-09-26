<!-- Generated from the npm registry tarball of @amerged/ohmyhost-mcp@0.1.21; the next release replaces any edit. -->

# ohmyho.st MCP server

The local MCP server of [ohmyho.st](https://ohmyho.st), hosting that a coding agent operates. It runs over stdio next to Codex, Claude Code, Cursor, Hermes or OpenClaw and lets the agent deploy the user's GitHub apps and manage their databases, domains, mail, usage and budgets with the access the user grants. It is also how the agent reaches ohmyho.st support.

Version 0.1.21 · [npm](https://www.npmjs.com/package/@amerged/ohmyhost-mcp) · Node.js 22 or newer · [release.json](release.json)

This repository mirrors the source published in the npm package `@amerged/ohmyhost-mcp`. Every release replaces it from the registry tarball, so pull requests are not merged here; report a problem through your agent (see Support below).

## Install

```sh
npm install --global @amerged/ohmyhost-cli @amerged/ohmyhost-mcp
export OHMYHOST_ENVIRONMENT=production
ohmyhost login --json
```

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

Authenticate one of two ways: set `OHMYHOST_TOKEN` in the server's `env` block, or sign in once with `ohmyhost login --json` and let MCP reuse that local session. The token wins wherever it is set, and needs no browser. New user API tokens are optional, remain valid until revoked and are shown only once. Login and token lifetimes are separate.

Keep tokens out of shared or committed MCP configuration; the public configuration carries only `OHMYHOST_ENVIRONMENT=production`.

## Tools, Skills and support

- [MCP setup guide](https://docs.ohmyho.st/agents/mcp)
- [Tool catalog](https://ohmyho.st/mcp-tools.json): every tool with its description.
- [Get-started Skill](https://ohmyho.st/skills/ohmyhost-get-started/SKILL.md) and the [Skill index](https://ohmyho.st/.well-known/agent-skills/index.json); the server also serves every Skill as an MCP resource.
- [Support](https://docs.ohmyho.st/support): ask your agent; it reports through `feedback_submit` and follows up with `feedback_status`.
- [Current client release](https://ohmyho.st/client-release.json)

## What is here

`src/` holds the TypeScript source of the server and the client code it bundles: `apps/mcp`, the command-line client `apps/product-cli`, the generated REST client `packages/sdk-ts`, `packages/contracts`, `packages/workos-auth-contracts` and the Skills in `packages/agent-skills`. `package.json`, `LICENSE`, `NOTICE` and `THIRD_PARTY_NOTICES.md` are the package's own. The built `dist/` bundle and the package README are not copied; `release.json` lists their SHA-256 digests, so this repository plus those files is the published tarball. `npm view @amerged/ohmyhost-mcp@0.1.21 dist.integrity` equals `npm.integrity` in `release.json`.

## Licence

Apache-2.0 applies to the Amerged client code (`LICENSE`, `NOTICE`). Third-party code bundled in the npm package keeps its own licences (`THIRD_PARTY_NOTICES.md`). The hosted platform that runs projects is private and not included; using it is subject to the [terms](https://ohmyho.st/terms).
