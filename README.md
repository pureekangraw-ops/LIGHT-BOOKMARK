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
