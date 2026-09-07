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

const DEFAULT_ENDPOINT = "https://app.bitroad.ai/api/v1/mcp";
const AUTH_HINT =
  "Set BITROAD_API_KEY to an agent key from https://buy.bitroad.ai/buyer/instances/new";
const UPSTREAM_ERROR = -32000;
const PARSE_ERROR = -32700;

/**
 * Forward one stdin line. Returns the stdout line to write, or null when
 * there is nothing to reply (notifications).
 *
 * @param {string} line
 * @param {{ endpoint?: string, apiKey?: string, fetch?: typeof fetch }} [options]
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
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  let response;
  try {
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
