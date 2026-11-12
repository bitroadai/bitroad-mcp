import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// Sell mode: the bridge makes a key, registers it once, and signs each call
// so that the documented canonical string verifies under the registered key.
test("key mode registers a new key in its role once and signs every request with it", async () => {
  const seen = [];
  let publicKey;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const fields = Object.fromEntries(
        req.headers.authorization.replace("Signature ", "").split(",").map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]),
      );
      if (req.url === "/api/v1/keys") {
        assert.equal(JSON.parse(body).role, "buyer");
        const raw = Buffer.from(JSON.parse(body).public_key, "hex");
        publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
        assert.equal(fields.keyid, createHash("sha256").update(raw).digest("hex"));
      }
      const bodyHash = createHash("sha256").update(body).digest("hex");
      const message = [req.method, req.url, fields.ts, fields.nonce, bodyHash].join("\n");
      seen.push({ url: req.url, valid: verify(null, Buffer.from(message), publicKey, Buffer.from(fields.sig, "base64")) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/v1/mcp`;
  const keyFile = join(mkdtempSync(join(tmpdir(), "bitroad-")), "nested", "seller-key.pem");
  try {
    const call = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"auth_whoami"}}';
    await forward(call, { endpoint, apiKey: "", buy: true, keyFile });
    await forward(call, { endpoint, apiKey: "", buy: true, keyFile });

    assert.deepEqual(seen, [
      { url: "/api/v1/keys", valid: true },
      { url: "/api/v1/mcp", valid: true },
      { url: "/api/v1/mcp", valid: true },
    ]);
    assert.equal(statSync(keyFile).mode & 0o777, 0o600);
  } finally {
    server.close();
  }
});
