import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { forward } from "../src/bridge.js";

// Fake Bitroad endpoint: tools/list succeeds, tools/call demands auth,
// notifications get an empty 202.
function fakeEndpoint() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const message = JSON.parse(body);
      if (message.id === undefined) return res.writeHead(202).end();
      if (message.method === "tools/call" && !req.headers.authorization) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { code: "no_credentials" } }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { echo: message.method } }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ endpoint: `http://127.0.0.1:${port}/api/v1/mcp`, close: () => server.close() });
    });
  });
}

test("bridge forwards requests, drops notifications, and maps 401 to a JSON-RPC error", async () => {
  const { endpoint, close } = await fakeEndpoint();
  try {
    const listed = await forward('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', { endpoint, apiKey: "" });
    assert.deepEqual(JSON.parse(listed), { jsonrpc: "2.0", id: 1, result: { echo: "tools/list" } });

    const notified = await forward('{"jsonrpc":"2.0","method":"notifications/initialized"}', { endpoint, apiKey: "" });
    assert.equal(notified, null);

    const denied = JSON.parse(
      await forward('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"orders_list"}}', { endpoint, apiKey: "" }),
    );
    assert.equal(denied.id, 2);
    assert.equal(denied.error.code, -32000);
    assert.match(denied.error.message, /BITROAD_API_KEY/);

    const garbage = JSON.parse(await forward("not json", { endpoint }));
    assert.equal(garbage.error.code, -32700);
  } finally {
    close();
  }
});
