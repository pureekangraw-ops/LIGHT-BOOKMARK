import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const token = "test-token";

class MemoryD1 {
  rows = [];

  prepare(sql) {
    return {
      bind: (...values) => ({
        all: async () => {
          let rows = [...this.rows];
          if (sql.includes("WHERE title LIKE")) {
            const pattern = values[0].slice(1, -1).replaceAll("\\%", "%").replaceAll("\\_", "_").toLowerCase();
            rows = rows.filter((row) =>
              [row.title, row.cue, row.tags].some((value) => value.toLowerCase().includes(pattern)),
            );
            rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
            rows = rows.slice(0, values[3]);
          } else {
            rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
            rows = rows.slice(0, values[0]);
          }
          return { results: rows };
        },
        first: async () => this.rows.find((row) => row.id === values[0] || row.notion_page_id === values[1]) || null,
        run: async () => {
          const [id, title, notion_page_id, notion_url, cue, tags] = values;
          const existing = this.rows.find((row) => row.id === id);
          const row = {
            id,
            title,
            notion_page_id,
            notion_url,
            cue,
            tags,
            updated_at: new Date().toISOString(),
          };
          if (existing) Object.assign(existing, row);
          else this.rows.push(row);
          return { success: true };
        },
      }),
    };
  }
}

const env = { BOOKMARKS: new MemoryD1(), LIGHT_BOOKMARK_TOKEN: token };

function request(body, auth = `Bearer ${token}`) {
  return new Request("https://light-bookmark.example/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("health is public; MCP requires the existing bearer secret", async () => {
  const health = await worker.fetch(new Request("https://light-bookmark.example/health"), env);
  assert.equal(health.status, 200);
  const denied = await worker.fetch(request({ jsonrpc: "2.0", id: 1, method: "tools/list" }, null), env);
  assert.equal(denied.status, 401);
});

test("MCP advertises tools and saves/searches/returns a Notion pointer", async () => {
  const initialize = await worker.fetch(
    request({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }),
    env,
  );
  assert.equal(initialize.status, 200);
  assert.equal(initialize.headers.get("MCP-Protocol-Version"), "2025-11-25");

  const listed = await worker.fetch(request({ jsonrpc: "2.0", id: 2, method: "tools/list" }), env);
  const tools = (await listed.json()).result.tools.map((item) => item.name);
  for (const name of ["pantheon_health", "search_bookmarks", "get_bookmark", "save_bookmark", "light_connections_status", "light_github_repo", "light_github_file", "light_gitlab_project", "light_gitlab_file", "light_cloudflare_worker"]) assert.ok(tools.includes(name), name);

  const pageId = "0123456789abcdef0123456789abcdef";
  const saved = await worker.fetch(
    request({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "save_bookmark",
        arguments: {
          title: "LIGHT retrieval design",
          notion_url: `https://www.notion.so/LIGHT-retrieval-${pageId}`,
          cue: "Pointers only; read the canonical page.",
          tags: ["light", "design"],
        },
      },
    }),
    env,
  );
  const savedText = (await saved.json()).result.content[0].text;
  assert.match(savedText, /"notion_page_id": "0123456789abcdef0123456789abcdef"/);
  assert.equal(env.BOOKMARKS.rows.length, 1);

  const searched = await worker.fetch(
    request({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "search_bookmarks", arguments: { query: "retrieval" } },
    }),
    env,
  );
  assert.match((await searched.json()).result.content[0].text, /LIGHT retrieval design/);

  const fetched = await worker.fetch(
    request({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "get_bookmark", arguments: { id: pageId } },
    }),
    env,
  );
  assert.match((await fetched.json()).result.content[0].text, /"source_of_truth": "Notion"/);
});

test("save rejects non-Notion URLs and mismatched page ids", async () => {
  const badUrl = await worker.fetch(
    request({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "save_bookmark",
        arguments: { title: "Bad", notion_url: "https://example.com/page" },
      },
    }),
    env,
  );
  assert.equal((await badUrl.json()).result.isError, true);

  const mismatch = await worker.fetch(
    request({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "save_bookmark",
        arguments: {
          title: "Mismatch",
          notion_url: "https://www.notion.so/page-0123456789abcdef0123456789abcdef",
          notion_page_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
    }),
    env,
  );
  assert.match((await mismatch.json()).result.content[0].text, /does not match/);
});
test('Notion tools are advertised and missing secret fails without D1 access',async()=>{
 const isolated={LIGHT_BOOKMARK_TOKEN:token,BOOKMARKS:{prepare(){assert.fail('Notion must not access D1');}}};
 const response=await worker.fetch(request({jsonrpc:'2.0',id:1,method:'tools/list'}),isolated);
 const names=(await response.json()).result.tools.map(t=>t.name);
 for(const name of ['light_notion_search','light_notion_data_source','light_notion_database','light_notion_page'])assert.ok(names.includes(name));
 const called=await worker.fetch(request({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'light_notion_search',arguments:{}}}),isolated);
 const result=(await called.json()).result;assert.equal(result.isError,true);assert.equal(result.content[0].text,'NOTION_NOT_CONFIGURED');
});

test('MCP initialization describes direct Drive and unimplemented operations without changing identity',async()=>{
 const response=await worker.fetch(request({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}}),env);
 const {result}=await response.json();
 assert.equal(result.serverInfo.name,'light-bookmark');
 assert.match(result.instructions,/directly.*LIGHT-owned OAuth/);
 assert.match(result.instructions,/text creation, content updates, move, share, and permission updates are not implemented/);
 assert.doesNotMatch(result.instructions,/credentials stay in PANTHEON|Drive is available through PANTHEON/);
});

test('document comparison is advertised and authenticated without provider or D1 access',async()=>{
 const isolated={LIGHT_BOOKMARK_TOKEN:token,BOOKMARKS:{prepare(){throw Error('unexpected D1 access')}}};
 const list=await worker.fetch(request({jsonrpc:'2.0',id:1,method:'tools/list'}),isolated);
 const tool=(await list.json()).result.tools.find(t=>t.name==='light_document_compare');assert.equal(tool.annotations.readOnlyHint,true);
 const call={jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'light_document_compare',arguments:{before:{},after:{}}}};
 assert.equal((await worker.fetch(request(call,null),isolated)).status,401);
 const r=await worker.fetch(request(call),isolated);const result=(await r.json()).result;
 assert.equal(JSON.parse(result.content[0].text).status,'incomparable');
});
