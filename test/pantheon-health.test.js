import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { pantheonHealth } from "../src/pantheon-health.js";

const endpoint = "https://light-bookmark.example/mcp";
function rpc(name, args = {}, auth = true) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: "Bearer light-test-token" } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}
function environment(pantheon) {
  return { LIGHT_BOOKMARK_TOKEN: "light-test-token", BOOKMARKS: {}, PANTHEON: pantheon };
}

test("PANTHEON health remains inaccessible without LIGHT's own bearer", async () => {
  let used = false;
  const env = environment({ fetch: async () => { used = true; return Response.json({ ok: true, service: "pantheon-workhub" }); } });
  const response = await worker.fetch(rpc("pantheon_health", {}, false), env);
  assert.equal(response.status, 401);
  assert.equal(used, false);
});

test("health tool is read-only, scoped and called via service binding", async () => {
  const paths = [];
  const env = environment({
    fetch: async (request) => {
      paths.push({ method: request.method, path: new URL(request.url).pathname });
      return Response.json({ ok: true, service: "pantheon-workhub", factory: { token: "never-expose", jobs: ["private"] }, task: { id: "private-task" } });
    },
  });
  const response = await worker.fetch(rpc("pantheon_health"), env);
  assert.equal(response.status, 200);
  const result = JSON.parse((await response.json()).result.content[0].text);
  assert.deepEqual(paths, [{ method: "GET", path: "/health" }]);
  assert.deepEqual(result, {
    connected: true,
    status: "CONNECTED",
    upstream_service: "pantheon-workhub",
    transport: "cloudflare-service-binding",
    scope: "health-only",
  });
  assert.doesNotMatch(JSON.stringify(result), /private|token|jobs/);
});

test("missing binding and unavailable upstream fail closed", async () => {
  assert.deepEqual(await pantheonHealth(environment(null)), {
    connected: false, status: "NOT_CONFIGURED", scope: "health-only",
  });
  assert.equal((await pantheonHealth(environment({ fetch: async () => { throw Error("internal private"); } }))).status, "UPSTREAM_UNAVAILABLE");
  assert.equal((await pantheonHealth(environment({ fetch: async () => new Response("down", { status: 503 }) }))).status, "UPSTREAM_HTTP_ERROR");
});

test("unexpected body fails closed and doesn't leak upstream text", async () => {
  const env = environment({ fetch: async () => Response.json({ ok: false, service: "not-workhub", secret: "internal-token" }) });
  const result = await pantheonHealth(env);
  assert.deepEqual(result, { connected: false, status: "INVALID_UPSTREAM_RESPONSE", scope: "health-only" });
  assert.doesNotMatch(JSON.stringify(result), /internal-token/);
});

test("PANTHEON health rejects parameters and cannot route protected WorkHub APIs", async () => {
  let invoked = false;
  const env = environment({ fetch: async () => { invoked = true; return Response.json({ ok: true, service: "pantheon-workhub" }); } });
  const response = await worker.fetch(rpc("pantheon_health", { task_id: "sample" }), env);
  const value = (await response.json()).result;
  assert.equal(value.isError, true);
  assert.equal(invoked, false);
});
