# Read-only Notion survey

Uses the existing production `NOTION_API` secret only inside the Worker.
No Notion mutation endpoints, page bodies in results/logs, or D1 writes.
Authentication remains the existing LIGHT MCP bearer.

1. Call `light_notion_search`, repeat with `cursor: next_cursor` until null.
   Aggregate manifest IDs. Search only exposes indexed objects shared with this
   integration; it is never proof of a complete workspace inventory.
2. For each data source call `light_notion_data_source` and follow its cursor.
   For known database containers use `light_notion_database` to find sources.
3. For each page/row call `light_notion_page`. Combine manifest deltas and pass
   the returned continuation with the same page ID until null. It traverses
   nested block children and their pagination, including child pages. Child
   databases and linked references are explicit locators for the next calls.
4. Supply expected page and data source IDs separately to verify coverage.
   An unseen ID is unknown; HTTP 401/403/404 is `inaccessible`, never absent.
   This module cannot verify or grant integration capabilities or sharing from
   search results alone. Test each expected root/source directly.
5. On rate limits wait at least `retry_after_seconds` before retrying. Search
   and row queries retry the same cursor; page scans use continuation (including
   metadata failures). No automatic busy retry loops.

A page scan uses at most 20 requests per call (8-second timeout per request),
1,000 pending block-list jobs, and 10,000 visited cursors. Hard limits and
unsupported blocks remain explicit coverage gaps; they never imply completion.
Continuation state contains only IDs/cursors/counts and remains client-side;
combine deltas to obtain the full manifest. It is client-controlled, so final
coverage is a navigation aid, not an independently signed audit receipt.

The pinned Notion API version is 2025-09-03. Read-only POSTs are only `/search`
and `/data_sources/{id}/query`; all other adapter requests are fixed-origin GETs.

## Diagnostics (Worker v0.8.1)

Failures return a `diagnostic` with correlation `request_id`, adapter version,
operation class, phase, category, actual HTTP status (null if none), duration,
and an allowlisted exception type. The same fields are emitted as a structured
warning to Cloudflare Logs. Request IDs are locally generated correlation IDs,
not Notion response IDs. No raw error messages/stacks, credentials, headers,
response bodies, page IDs, cursor values, or page content are logged.

Phases distinguish `runtime_setup`, `request_setup`, `fetch`, `http_response`,
and `response_parse`. Categories distinguish timeout from an unclassified
transport exception. HTTP 401 means authentication rejected, 403 permission
rejected, 404 unavailable or not shared (not proof of absence), and 429 rate
limited. Existing status/manifest/continuation fields remain compatible.
Cloudflare invocation logs and traces remain disabled; only application logs
are persisted. A failed scan with an empty manifest is not an empty workspace.

## Workers runtime redirect fix (v0.8.2)

Workers supports Request redirect modes `manual` and `follow`, but rejects
`error` during construction. The adapter now uses `manual` and explicitly
rejects every 3xx response as `redirect_rejected`; it never follows Location
or sends credentials to a redirect destination. Node-only tests missed this
runtime difference, so `notion-runtime.test.js` constructs the real adapter
request in Miniflare/workerd with a synthetic credential and no Notion network
call. The pinned test runtime supports compatibility date 2026-08-06; production
keeps its existing 2026-10-10 date. A runtime regression was reproduced before
this fix and passed afterward. This does not by itself verify real token access.
