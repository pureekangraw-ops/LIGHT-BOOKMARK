# LIGHT Bookmark 🔖

LIGHT Bookmark is a small, authenticated MCP index that helps LIGHT find saved Notion context quickly. It stores short retrieval cues and pointers—not a second copy of knowledge.

## Current boundary

- **Notion remains canonical.** Search results and cues are locators, not evidence or current truth.
- The Worker returns a Notion URL; the calling agent must use its authenticated Notion tools to open and read the source page.
- Save only when the user asks to bookmark context or an agreed workflow requires it. Do not copy full Notion content into D1.
- The Worker does not create a Notion API credential, OAuth flow, identity, permission gate, or authority layer.
- Runtime secret configuration and deployment are owned by GO. The Worker fails closed until `LIGHT_BOOKMARK_TOKEN` is configured.

## MCP endpoint

Configure the personal MCP connection URL as `https://<worker-host>/mcp` and provide the existing bearer token through the connection's supported authorization setting. Do not commit the token.

Tools:

- `search_bookmarks`: search by title, cue, or tags.
- `get_bookmark`: retrieve one pointer using its bookmark/page id.
- `save_bookmark`: add or update a title, Notion URL, concise cue, and tags.
- `pantheon_health`: safely query PANTHEON production `/health` using a Cloudflare Worker Service Binding. Returns an allowlisted, read-only status; no WorkHub task access or Notion data transfer.

The authenticated, read-only `GET /bookmarks?q=...` route is retained for compatibility. `GET /health` reports only basic service/version status.

## Validation

Run `npm test` for local protocol/auth/pointer checks. A passing local test does not prove Cloudflare deployment, D1 binding, secret configuration, live MCP connectivity, or cross-room retrieval.

See [design](docs/design.md) for the role boundary and evidence status.
## Shared PANTHEON access boundary

GO enters through the existing ChatGPT GO-Together plugin and its own authorized Bridge route. LIGHT enters through this existing LIGHT-BOOKMARK MCP endpoint. Both target the same PANTHEON production service, but preserve their own caller authentication and never share or duplicate the production `WORKHUB_TOKEN`.

The binding named `PANTHEON` is a server-to-server Service Binding for the `phatheon-workhub` Worker, not an OAuth app, extra actor, or new PANTHEON instance. It exposes `pantheon_health` only. This does **not** grant either assistant the ability to read protected tasks, approve work, or dispatch Factory jobs. Those require a separate owner-approved, scoped, server-enforced API with caller-origin audit.

Do not copy Notion documents into LIGHT Bookmark D1. Keep existing `BOOKMARKS` and `LIGHT_BOOKMARK_TOKEN` bindings; inspect and preserve both on deploy.

## LIGHT Tool Access — read-only provider connections (proposed)

LIGHT keeps the same `/mcp` endpoint and `LIGHT_BOOKMARK_TOKEN` authentication.
These tools do **not** make LIGHT an owner of GO Brain or PANTHEON:

| MCP tool | Upstream access |
|---|---|
| `light_connections_status` | Report configured provider status, no secrets |
| `light_github_repo`, `light_github_file` | GitHub REST, allowlisted repositories, read-only |
| `light_gitlab_project`, `light_gitlab_file` | GitLab REST, allowlisted projects, read-only |
| `light_cloudflare_worker` | Cloudflare Workers deployment metadata, allowlisted scripts, read-only |
| `pantheon_health` | Existing health-only service binding |

`wrangler.toml` defines the **public allowlists**:
- `LIGHT_GITHUB_REPOS` (comma-separated `owner/repo`)
- `LIGHT_GITLAB_PROJECTS` (comma-separated `group/project`)
- `LIGHT_CF_WORKERS` (comma-separated Worker script names)

Optional secrets to read **private** repositories: `LIGHT_GITHUB_READ_TOKEN` and
`LIGHT_GITLAB_READ_TOKEN`. Each must be a separate, narrowly scoped read-only
credential owned by LIGHT. Without tokens, only public GitHub/GitLab resources
work. Set `LIGHT_CF_ACCOUNT_ID` and **secret** `LIGHT_CF_READ_TOKEN` with
Cloudflare Workers Scripts read permission to enable Worker deployment inspection.
Never copy GO Brain, WorkHub, or Factory tokens into LIGHT.

**Google Drive:** LIGHT reads Drive only through PANTHEON capability
`pantheon.drive.read`. PANTHEON holds the OAuth credentials; LIGHT receives
bounded read results and never receives tokens. Account-wide access depends on
explicit Google OAuth consent. No Drive writes, sharing, or permission changes
are exposed.

### Connect Notion Agent

Notion Business/Enterprise users can add a custom MCP server on Notion web/desktop:
`Settings → Connections → Discover → Add Custom MCP`. Enter the existing deployed
LIGHT Bookmark MCP URL and authenticate with the LIGHT bookmark bearer token
through the supported header-auth UI. This user-side connection is not established
by a GitHub code change. Confirm `tools/list` from the Notion Agent and then test
one `light_github_repo` and `light_gitlab_project` query. No production deployment,
Notion-side connection, or private-provider authentication is implied by this proposal.

### Access boundaries

- Authenticated MCP and the existing bookmark database remain unchanged.
- Every provider tool is read-only. Project/resource allowlists are checked **before**
  any network request. Path traversal and common secret-file names are rejected.
- The service sends outbound requests only to fixed provider API hosts. It does not
  relay arbitrary user-provided URLs, upstream headers, or credentials.
- Cloudflare readback exposes only deployment/version IDs, dates, rollout percentages.
  No source code, bindings, API keys, or account-wide mutation endpoints.
- GO and LIGHT maintain separate knowledge, keys, approvals, and audit identities.

## Work actions (paired with PANTHEON LightBridge PR #13)

LIGHT can now prepare work through its own **restricted** PANTHEON service binding:
`PANTHEON_LIGHT` with Cloudflare `entrypoint = "LightBridge"`.

- `light_pantheon_tasks`: read queue or exact task.
- `light_pantheon_create_task`: create queued PANTHEON task (does not execute).
- `light_pantheon_queue_factory`: prepare LOGIC trainee job in queue (does not dispatch).
- `light_pantheon_factory`: read factory status or a specific job receipt.

The paired PANTHEON Worker must deploy its separate `LightBridge` class and
explicitly enable `LIGHT_BRIDGE_ENABLED=true` for task reads and
`LIGHT_BRIDGE_CREATE_ENABLED=true` for creating/queueing tasks.
Defaults are deny. Existing `PANTHEON` Service Binding stays health-only.

No tools exist for direct GitHub/GitLab source writes, Cloudflare deployments,
Factory dispatch or reconcile, production merges, rollback, or permissions.
Use PANTHEON requests to propose those actions; BIG approves the actual
execution with the authorized channel. Do not confuse queued with executed.

Dependency: https://github.com/pureekangraw-ops/Pantheon-WorkHub/pull/13

## Account-wide read-only Google Drive via PANTHEON (proposed)

LIGHT advertises `light_drive_roots`, `light_drive_list`, and `light_drive_file`.
These tools invoke the existing `PANTHEON_LIGHT` Service Binding and the explicit
PANTHEON capability `pantheon.drive.read`. Neither Google client ID, client
secret, refresh token nor access token is stored by, sent to, or returned to
LIGHT; Google OAuth exchange happens inside PANTHEON.

The capability reads files visible to the Google account authorized in
PANTHEON and does not use a folder allowlist. The account-wide read-only grant
must include `https://www.googleapis.com/auth/drive.readonly` (or the broader
`drive` scope); a per-file `drive.file` grant is insufficient. Google classifies
`drive.readonly` as a restricted scope, so consent, app verification, or a
security assessment may be required. PANTHEON fails closed if the OAuth scope
is missing or narrower than the required account-wide read scope.

Only read operations are exposed. LIGHT cannot create, update, move, delete,
share, or change permissions in Drive. Returned text and upstream bodies are
bounded, and large Drive listings use pagination. GitHub, GitLab and Cloudflare
remain under Factory District; this does not move those integrations or copy
Factory tokens.

This change requires both repositories' PRs to be merged and deployed, followed
by a staging test of a file outside the former HERMES Academy runs folder.
Existing refresh-token validity and Drive scope remain unverified until that
OAuth readback succeeds. Do not deploy to production before scope verification.
