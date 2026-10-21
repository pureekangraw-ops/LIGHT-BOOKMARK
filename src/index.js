import { NOTION_TOOLS, isNotionTool, runNotionTool } from "./notion-read.js";
import { pantheonHealth } from "./pantheon-health.js";
import { PROVIDER_TOOLS, isProviderTool, runProviderTool } from "./provider-read.js";
import { LIGHT_WORK_TOOLS, isLightWorkTool, runLightWorkTool } from "./light-work.js";
import { LIGHT_DRIVE_TOOLS, isLightDriveTool, runLightDriveTool } from "./drive-bridge.js";
// LIGHT Bookmark: a small MCP pointer index over Notion pages.
// Notion remains the source of truth; this Worker stores only retrieval cues.
const VERSION = "0.8.1"
const MCP_VERSION = "2025-11-25";
const SUPPORTED_MCP_VERSIONS = new Set(["2025-03-26", "2025-06-18", MCP_VERSION]);
const MAX_LIMIT = 30;
const MAX_QUERY_LENGTH = 100;
const MAX_CUE_LENGTH = 500;

const TOOLS = [
  ...NOTION_TOOLS,
  ...PROVIDER_TOOLS,
  ...LIGHT_WORK_TOOLS,
  ...LIGHT_DRIVE_TOOLS,
  {
    name: "pantheon_health",
    description: "Read-only health check of the existing PANTHEON WorkHub through an internal service binding. Does not read, create or execute tasks, and does not transfer Notion content.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "search_bookmarks",
    description:
      "Search saved LIGHT Bookmark pointers by topic/cue. Results are locators, not evidence or current truth. Open the returned Notion page with your authenticated Notion tools before relying on its contents.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Short topic or phrase to find." },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: "Maximum results (default 10)." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "get_bookmark",
    description:
      "Get one saved pointer by bookmark id or Notion page id. This does not load the Notion page; use the returned URL with your authenticated Notion tools.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Bookmark id or Notion page id." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "save_bookmark",
    description:
      "Save or update a short retrieval cue pointing to a Notion page. Do not copy full page content. Use only when the user asks to save/bookmark context or an agreed workflow calls for it. The cue is not authoritative; Notion remains the source of truth.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 160 },
        notion_url: { type: "string", minLength: 1, description: "HTTPS URL of the canonical Notion page." },
        notion_page_id: { type: "string", description: "Optional page id if it cannot be derived from the URL." },
        cue: { type: "string", maxLength: MAX_CUE_LENGTH, description: "Brief non-authoritative retrieval cue." },
        tags: {
          type: "array",
          maxItems: 10,
          items: { type: "string", minLength: 1, maxLength: 40 },
        },
      },
      required: ["title", "notion_url"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

function jsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers });
}

function isAuthorized(request, env) {
  const token = env.LIGHT_BOOKMARK_TOKEN;
  return Boolean(token && request.headers.get("Authorization") === `Bearer ${token}`);
}

function clampLimit(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(number))) : 10;
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function normalizePageId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().replaceAll("-", "");
  return /^[0-9a-f]{32}$/.test(normalized) ? normalized : null;
}

function parseNotionPointer(rawUrl, suppliedPageId) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("notion_url must be a valid HTTPS Notion page URL.");
  }
  const host = parsed.hostname.toLowerCase();
  const allowedHost =
    host === "notion.so" ||
    host === "www.notion.so" ||
    host === "app.notion.com" ||
    host.endsWith(".notion.site");
  if (parsed.protocol !== "https:" || !allowedHost || parsed.username || parsed.password) {
    throw new Error("Only HTTPS Notion page URLs are accepted.");
  }

  const ids = parsed.pathname.match(/[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi) || [];
  const urlPageId = ids.length ? normalizePageId(ids.at(-1)) : null;
  const explicitPageId = suppliedPageId === undefined ? null : normalizePageId(suppliedPageId);
  if (suppliedPageId !== undefined && !explicitPageId) {
    throw new Error("notion_page_id must be a 32-character Notion page id.");
  }
  if (urlPageId && explicitPageId && urlPageId !== explicitPageId) {
    throw new Error("notion_page_id does not match the Notion URL.");
  }
  const pageId = explicitPageId || urlPageId;
  if (!pageId) {
    throw new Error("Could not read a Notion page id from the URL; provide notion_page_id.");
  }
  parsed.hash = "";
  return { notion_url: parsed.toString(), notion_page_id: pageId };
}

function asBookmark(row) {
  if (!row) return null;
  let tags = [];
  try {
    const decoded = JSON.parse(row.tags || "[]");
    if (Array.isArray(decoded)) tags = decoded.filter((tag) => typeof tag === "string");
  } catch {
    // A malformed legacy tags field should not hide an otherwise valid pointer.
  }
  return {
    id: row.id,
    title: row.title,
    notion_page_id: row.notion_page_id,
    notion_url: row.notion_url,
    cue: row.cue || "",
    tags,
    updated_at: row.updated_at,
    source_of_truth: "Notion",
  };
}

function toolResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function toolError(message) {
  return { isError: true, content: [{ type: "text", text: message }] };
}

async function searchBookmarks(db, query, limit) {
  const search = typeof query === "string" ? query.trim().slice(0, MAX_QUERY_LENGTH) : "";
  const sql = search
    ? "SELECT id,title,notion_page_id,notion_url,cue,tags,updated_at FROM bookmarks WHERE title LIKE ? ESCAPE char(92) OR cue LIKE ? ESCAPE char(92) OR tags LIKE ? ESCAPE char(92) ORDER BY updated_at DESC LIMIT ?"
    : "SELECT id,title,notion_page_id,notion_url,cue,tags,updated_at FROM bookmarks ORDER BY updated_at DESC LIMIT ?";
  const statement = db.prepare(sql);
  const result = search
    ? await statement.bind(`%${escapeLike(search)}%`, `%${escapeLike(search)}%`, `%${escapeLike(search)}%`, limit).all()
    : await statement.bind(limit).all();
  return (result.results || []).map(asBookmark);
}

async function getBookmark(db, id) {
  const result = await db
    .prepare(
      "SELECT id,title,notion_page_id,notion_url,cue,tags,updated_at FROM bookmarks WHERE id = ? OR notion_page_id = ? LIMIT 1",
    )
    .bind(id, id)
    .first();
  return asBookmark(result);
}

async function saveBookmark(db, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid bookmark input.");
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (!title || title.length > 160) throw new Error("title must contain 1–160 characters.");
  const cue = args.cue === undefined ? "" : args.cue;
  if (typeof cue !== "string" || cue.length > MAX_CUE_LENGTH) {
    throw new Error(`cue must be text no longer than ${MAX_CUE_LENGTH} characters.`);
  }
  const pointer = parseNotionPointer(args.notion_url, args.notion_page_id);
  const tags = args.tags === undefined ? [] : args.tags;
  if (
    !Array.isArray(tags) ||
    tags.length > 10 ||
    tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 40)
  ) {
    throw new Error("tags must contain up to 10 non-empty strings of at most 40 characters.");
  }
  const cleanTags = [...new Set(tags.map((tag) => tag.trim()))];
  await db
    .prepare(
      "INSERT INTO bookmarks (id,title,notion_page_id,notion_url,cue,tags) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, notion_page_id=excluded.notion_page_id, notion_url=excluded.notion_url, cue=excluded.cue, tags=excluded.tags, updated_at=CURRENT_TIMESTAMP",
    )
    .bind(
      pointer.notion_page_id,
      title,
      pointer.notion_page_id,
      pointer.notion_url,
      cue.trim(),
      JSON.stringify(cleanTags),
    )
    .run();
  return getBookmark(db, pointer.notion_page_id);
}

async function callTool(db, name, args, env) {
  try {
    if (isNotionTool(name)) return toolResult(await runNotionTool(name, args, env));
    if (isProviderTool(name)) return toolResult(await runProviderTool(name, args, env));
    if (isLightWorkTool(name)) return toolResult(await runLightWorkTool(name, args, env));
    if (isLightDriveTool(name)) return toolResult(await runLightDriveTool(name, args, env));
    if (name === "pantheon_health") {
      if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length) {
        return toolError("pantheon_health accepts no arguments.");
      }
      return toolResult(await pantheonHealth(env));
    }
    if (name === "search_bookmarks") {
      const limit = clampLimit(args?.limit);
      return toolResult({
        bookmarks: await searchBookmarks(db, args?.query, limit),
        source_of_truth: "Notion",
        note: "Pointers and cues are navigation aids, not source evidence. Open the Notion page before relying on its content.",
      });
    }
    if (name === "get_bookmark") {
      if (!args || typeof args.id !== "string" || !args.id.trim()) {
        throw new Error("id is required.");
      }
      const bookmark = await getBookmark(db, args.id.trim());
      return bookmark ? toolResult(bookmark) : toolError("Bookmark not found.");
    }
    if (name === "save_bookmark") {
      return toolResult(await saveBookmark(db, args));
    }
    return toolError(`Unknown tool: ${name}`);
  } catch (error) {
    return toolError(error instanceof Error ? error.message : "Bookmark operation failed.");
  }
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handleMcp(request, env) {
  let message;
  try {
    message = await request.json();
  } catch {
    return jsonResponse({ error: "Expected a JSON-RPC request." }, 400);
  }
  if (!message || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return jsonResponse(rpcError(message?.id, -32600, "Invalid Request"));
  }
  if (!Object.hasOwn(message, "id")) return new Response(null, { status: 202 });

  const responseHeaders = {};
  const requestedVersion = request.headers.get("MCP-Protocol-Version");
  if (requestedVersion && SUPPORTED_MCP_VERSIONS.has(requestedVersion)) {
    responseHeaders["MCP-Protocol-Version"] = requestedVersion;
  }

  if (message.method === "initialize") {
    const requested = message.params?.protocolVersion;
    const selected = SUPPORTED_MCP_VERSIONS.has(requested) ? requested : MCP_VERSION;
    responseHeaders["MCP-Protocol-Version"] = selected;
    return jsonResponse(
      {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: selected,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "light-bookmark", version: VERSION },
          instructions:
            "LIGHT Bookmark stores Notion pointers, exposes allowlisted read-only GitHub/GitLab/Cloudflare tools, and prepares PANTHEON tasks through the LIGHT-only Bridge. Factory execution and external writes require owner authorization. Google Drive is available through PANTHEON capabilities pantheon.drive.read and pantheon.drive.write; OAuth credentials stay in PANTHEON. LIGHT exposes read, create, edit, move, copy, share, and permission-update tools, but no delete operation. Only make Drive changes when the user requests them.",
        },
      },
      200,
      responseHeaders,
    );
  }
  if (message.method === "ping") {
    return jsonResponse({ jsonrpc: "2.0", id: message.id, result: {} }, 200, responseHeaders);
  }
  if (message.method === "tools/list") {
    return jsonResponse({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } }, 200, responseHeaders);
  }
  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    const result = await callTool(env.BOOKMARKS, name, args, env);
    return jsonResponse({ jsonrpc: "2.0", id: message.id, result }, 200, responseHeaders);
  }
  return jsonResponse(rpcError(message.id, -32601, "Method not found"), 200, responseHeaders);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ ok: true, service: "light-bookmark", version: VERSION });
    }
    if (url.pathname === "/mcp") {
      if (request.method !== "POST") {
        return new Response("Use POST with Streamable HTTP JSON-RPC.", {
          status: 405,
          headers: { Allow: "POST" },
        });
      }
      if (!env.LIGHT_BOOKMARK_TOKEN) {
        return jsonResponse({ error: "Worker authentication secret is not configured." }, 503);
      }
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      if (!env.BOOKMARKS) return jsonResponse({ error: "D1 binding BOOKMARKS missing." }, 503);
      return handleMcp(request, env);
    }
    // Retain the existing authenticated read-only REST endpoint for compatibility.
    if (url.pathname === "/bookmarks" && request.method === "GET") {
      if (!env.LIGHT_BOOKMARK_TOKEN) {
        return jsonResponse({ error: "Worker authentication secret is not configured." }, 503);
      }
      if (!isAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      if (!env.BOOKMARKS) return jsonResponse({ error: "D1 binding BOOKMARKS missing." }, 503);
      try {
        const query = (url.searchParams.get("q") || "").trim().slice(0, MAX_QUERY_LENGTH);
        const bookmarks = await searchBookmarks(env.BOOKMARKS, query, clampLimit(url.searchParams.get("limit")));
        return jsonResponse({ bookmarks, source_of_truth: "Notion", read_only: true });
      } catch {
        return jsonResponse({ error: "Bookmark search failed." }, 500);
      }
    }
    return new Response("Not found", { status: 404 });
  },
};