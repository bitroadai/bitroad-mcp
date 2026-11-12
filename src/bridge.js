// Stdio bridge to the hosted Bitroad MCP server.
//
// Each line on stdin is one JSON-RPC message (or batch). It is POSTed
// unchanged to the Streamable HTTP endpoint and the reply is written to
// stdout as one line. This lets stdio-only clients and directory
// crawlers (Glama, registry inspectors) talk to the remote server.
//
//   BITROAD_API_KEY  optional agent key from buy.bitroad.ai/buyer/instances/new.
//                    Without it the handshake and tools/list work; tools/call
//                    returns an authentication error.
//   BITROAD_MCP_URL  endpoint override (defaults to production).
//   BITROAD_SELL     set to 1 to sell with no account: the bridge creates a
//                    key (BITROAD_KEY_FILE, default ~/.bitroad/seller-key.pem),
//                    registers it as a seller and signs every request with it.
//                    Ignored when BITROAD_API_KEY is set.
//   BITROAD_BUY      set to 1 to buy with no account, the same way (default key
//                    file ~/.bitroad/buyer-key.pem). The agent prepares a
//                    purchase; you finish setup from the link it gives you.

import { defaultKeyFile, loadOrCreateKey, registerKey, signatureHeader } from "./seller-key.js";

// One registration per process and endpoint; a failed one is retried on the next message.
const registered = new Map();

async function keyFor(role, endpoint, fetchImpl, keyFile) {
  const key = loadOrCreateKey(keyFile ?? process.env.BITROAD_KEY_FILE ?? defaultKeyFile(role));
  const id = `${endpoint} ${key.fingerprint}`;
  if (!registered.has(id)) {
    registered.set(id, registerKey(key, endpoint, fetchImpl, role));
  }
  try {
    await registered.get(id);
  } catch (error) {
    registered.delete(id);
    throw error;
  }
  return key;
}

const DEFAULT_ENDPOINT = "https://app.bitroad.ai/api/v1/mcp";
const AUTH_HINT =
  "Set BITROAD_API_KEY to an agent key from https://buy.bitroad.ai/buyer/instances/new, " +
  "or start with no account by setting BITROAD_SELL=1 (to sell) or BITROAD_BUY=1 (to buy)";
const UPSTREAM_ERROR = -32000;
const PARSE_ERROR = -32700;

/**
 * Forward one stdin line. Returns the stdout line to write, or null when
 * there is nothing to reply (notifications).
 *
 * @param {string} line
 * @param {{ endpoint?: string, apiKey?: string, fetch?: typeof fetch, sell?: boolean, buy?: boolean, keyFile?: string }} [options]
 * @returns {Promise<string | null>}
 */
export async function forward(line, options = {}) {
  const endpoint = options.endpoint ?? process.env.BITROAD_MCP_URL ?? DEFAULT_ENDPOINT;
  const apiKey = options.apiKey ?? process.env.BITROAD_API_KEY;
  const fetchImpl = options.fetch ?? fetch;

  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return JSON.stringify(rpcError(null, PARSE_ERROR, "Parse error"));
  }

  const headers = { "content-type": "application/json", accept: "application/json" };
  const sell = options.sell ?? process.env.BITROAD_SELL === "1";
  const buy = options.buy ?? process.env.BITROAD_BUY === "1";
  const role = sell ? "seller" : buy ? "buyer" : null;

  let response;
  try {
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    } else if (role) {
      const key = await keyFor(role, endpoint, fetchImpl, options.keyFile);
      headers.authorization = signatureHeader(key, "POST", endpoint, line);
    }
    response = await fetchImpl(endpoint, { method: "POST", headers, body: line });
  } catch (error) {
    return replyWithError(message, `Upstream unreachable: ${error.message}`);
  }
  if (response.status === 202) return null;
  const text = await response.text();
  if (response.ok) return text.trim();
  const reason =
    response.status === 401
      ? `Authentication required. ${AUTH_HINT}`
      : `Upstream HTTP ${response.status}`;
  return replyWithError(message, reason, text.slice(0, 500));
}

function replyWithError(message, reason, data) {
  const requests = (Array.isArray(message) ? message : [message]).filter(
    (m) => m && typeof m === "object" && m.id !== undefined,
  );
  if (requests.length === 0) return null;
  const errors = requests.map((m) => rpcError(m.id, UPSTREAM_ERROR, reason, data));
  return JSON.stringify(Array.isArray(message) ? errors : errors[0]);
}

function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
}
