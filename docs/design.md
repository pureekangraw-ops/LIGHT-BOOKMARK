# LIGHT Bookmark — Design and status

## Purpose

LIGHT Bookmark is a retrieval index for saved context—work, ideas, decisions, and lessons that should be fast to locate. It is not a second brain or knowledge store. A bookmark carries a pointer and concise orientation so LIGHT can open and read the canonical Notion source.

## Boundaries

- **Notion:** canonical saved content; LIGHT reads the source page before relying on its details.
- **LIGHT Bookmark Worker + D1:** index of Notion page ids/URLs, titles, short cues, and tags.
- **LIGHT:** decides when prior context matters, searches the index, then reads the page with its authenticated Notion tools.
- **GO:** runtime owner for Cloudflare secret configuration, deployment, and live testing.

The Worker does not call Notion's API or hold Notion credentials. It does not establish identity, permissions, lifecycle, or authority. Historical cues do not prove current state; consult the responsible Owner Source when current status matters. Unsaved conversation content cannot be reconstructed.

## Retrieval flow

1. Identify whether prior saved context materially helps answer the current request.
2. Search bookmark pointers using the topic or distinctive cue.
3. Treat matches as candidate locators only.
4. Open the selected Notion page and read the relevant context.
5. Verify current operational truth against its Owner Source when needed.
6. Preserve conflicts and uncertainty; report missing context as UNKNOWN.

## Interface

The Worker exposes Streamable HTTP JSON-RPC at `/mcp`, guarded by the existing `LIGHT_BOOKMARK_TOKEN` bearer secret:

- `search_bookmarks` — read-only lookup by title/cue/tags.
- `get_bookmark` — read-only retrieval of one pointer.
- `save_bookmark` — explicit, idempotent upsert of one Notion pointer and brief cue.

`GET /bookmarks` remains as an authenticated compatibility route. No Notion content is copied into D1.

## Evidence status

- **CONFIRMED (repo readback, 2026-10-10):** the initial Worker exposed authenticated read-only REST `/bookmarks`; D1 schema was present.
- **CONFIRMED (local test run, 2026-10-10):** 3 tests passed for auth, MCP discovery, save/search/get, and URL/id validation using an in-memory D1 mock.
- **UNKNOWN:** the new MCP implementation is not yet confirmed deployed or live-tested.
- **CONFLICT:** GO's status said deploy was pending, while Cloudflare deployment readback showed Wrangler deployments at 2026-10-10 15:12 UTC and 15:14 UTC. Cloudflare is the runtime truth owner; the latest readback does not prove the new MCP code is deployed.
- **UNKNOWN:** whether the secret is configured, the live D1 binding is active, or a personal MCP connection can reach `/mcp`.

Next proof belongs to GO: configure the agreed secret, verify the D1 binding, deploy the current repository commit, then test authenticated `initialize → tools/list → save → search → readback`. A separate fresh-room test must confirm LIGHT searches the MCP index and then opens the Notion source.