# Bitroad MCP server

Bitroad is a marketplace built for AI agents. Your agent searches a catalogue of
goods and services, places orders under spending caps you set, tracks delivery,
and handles returns and disputes, all through the Model Context Protocol.

**Endpoint:** `https://app.bitroad.ai/api/v1/mcp`

Transport is spec-compliant Streamable HTTP with JSON-RPC 2.0. Auth is OAuth 2.1
with dynamic client registration and PKCE, so most clients need nothing more than
the URL above.

- Website: https://bitroad.ai
- Documentation: https://bitroad.ai/docs
- Sign up: https://buy.bitroad.ai/sign-up

## How it works

1. Create a buyer account at [buy.bitroad.ai](https://buy.bitroad.ai/sign-up).
2. Add the endpoint to your MCP client and approve the consent screen.
3. Your agent can now browse and read orders immediately.
4. To let it spend, add a card and set delegation caps in your dashboard. Until
   you do, there is no purchase path at all.

Spending is bounded by three caps you control: per transaction, per day, and
total. A purchase above any cap is refused outright, with a reason of
`per_tx_cap_exceeded`, `daily_cap_exceeded` or `total_cap_exceeded`. Separately,
you can set a confirmation threshold: a purchase at or above it is allowed but
returns `confirmation_required` with a token, and needs your explicit sign-off
before it proceeds. Agents never see card details; a card can only be added by
you through Stripe hosted checkout.

## Connect your client

There are three shapes. Pick the one that matches your client.

### CLI clients

```bash
# Claude Code
claude mcp add --transport http bitroad https://app.bitroad.ai/api/v1/mcp

# Gemini CLI
gemini mcp add --transport http bitroad https://app.bitroad.ai/api/v1/mcp
```

Run the client and trigger the OAuth flow (`/mcp` in Claude Code, automatic in
Gemini CLI), then approve on the Bitroad consent screen.

### Config-file clients

Cursor, Claude Desktop, Cline, Windsurf, LibreChat and most other MCP clients
take a JSON block:

```json
{
  "mcpServers": {
    "bitroad": {
      "url": "https://app.bitroad.ai/api/v1/mcp"
    }
  }
}
```

The client discovers OAuth on first use.

### Connector-UI clients

Claude.ai (Settings, then Connectors), ChatGPT (developer mode custom
connectors), and Copilot take the endpoint as a pasted URL:

1. Open the client's connector settings.
2. Add a connector with URL `https://app.bitroad.ai/api/v1/mcp`.
3. Approve the Bitroad consent screen when prompted.

### Bearer key instead of OAuth

For headless clients and your own agent code, mint an agent key at
`/buyer/instances/new` and send it as a header:

```bash
curl https://app.bitroad.ai/api/v1/mcp \
  -H "Authorization: Bearer br_ik_..." \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Keys are shown once. Revoke them from the same page.

## Tool catalogue

Call `tools/list` for the live catalogue with full JSON Schema. `tools/list`
returns the whole catalogue to every caller; your account type is enforced when a
tool is called, not when it is listed. Buyer and seller are separate account
types and one email can only be one of them, so a buyer calling a `seller_*` tool
is refused.

**Buyer tools**

| Group | Tools |
|---|---|
| Catalogue | `catalog_search_products`, `catalog_get_product`, `catalog_list_categories`, `catalog_describe_category` |
| Buying | `purchase_create_intent`, `purchase_confirm_intent`, `purchase_cancel_intent` |
| Orders | `orders_list`, `orders_get` |
| Returns | `returns_initiate`, `returns_get`, `returns_list`, `returns_get_label` |
| Disputes | `disputes_file`, `disputes_list`, `disputes_get`, `disputes_add_evidence`, `disputes_withdraw`, `disputes_respond` |
| Reputation | `sellers_get`, `platforms_get` |
| Account | `addresses_list`, `addresses_create`, `payment_methods_list`, `payment_methods_create`, `auth_whoami`, `auth_revoke_self` |

**Seller tools**

Listings, stock, orders, shipping and tracking, returns, and review responses,
under the `seller_*` prefix.

**Services**

A quote-based marketplace for work rather than goods, under the `services_*`
prefix: request a quote, accept it, and funds are held in escrow until you accept
the deliverable.

The catalogue also carries `envelopes_list` and `envelopes_get`, a preview
surface that is switched off on the hosted service. They appear in `tools/list`
but return a not-found error when called.

Buying a product is a two-step flow. `purchase_create_intent` reserves stock and
snapshots price, VAT and shipping, then `purchase_confirm_intent` charges and
creates the order. Intents expire after 15 minutes. All monetary values are
integer pence.

## Idempotency

Write tools accept an optional `_meta.idempotencyKey`. Passing one gives you full
replay semantics on retries. If your client cannot set it, the server generates
one so the call still succeeds.

```json
{
  "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": {
    "name": "purchase_create_intent",
    "arguments": { "product_id": "...", "quantity": 1 },
    "_meta": { "idempotencyKey": "intent-abc-123" }
  }
}
```

## Registry

This repository holds the [`server.json`](server.json) record published to the
official MCP registry under the `ai.bitroad` namespace.

## Support

Open an issue here.
