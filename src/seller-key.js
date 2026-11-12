// Sell or buy with no account (BITROAD_SELL=1 or BITROAD_BUY=1). The bridge
// holds an Ed25519 key, registers it with Bitroad in that role, and signs
// every request with it.
// The scheme is Bitroad's own, not RFC 9421:
//
//   Authorization: Signature keyid=<fingerprint>,ts=<unix seconds>,nonce=<uuid>,sig=<base64>
//
// where sig covers METHOD, path and query, ts, nonce and the SHA-256 hex of
// the body (empty for no body), joined by "\n".

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** One key file per role: a key is one identity in one role. */
export const defaultKeyFile = (role) => join(homedir(), ".bitroad", `${role}-key.pem`);

/**
 * Load the key at `file`, creating it (owner-only) on first run. The file is
 * the agent's whole identity until a human claims it: lose it and its store,
 * held earnings or waiting purchases are unreachable.
 *
 * @param {string} file
 */
export function loadOrCreateKey(file) {
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
    writeFileSync(file, pem, { mode: 0o600, flag: "wx" });
  }
  const privateKey = createPrivateKey(readFileSync(file));
  const rawPublicKey = Buffer.from(createPublicKey(privateKey).export({ format: "jwk" }).x, "base64url");
  return {
    privateKey,
    publicKeyHex: rawPublicKey.toString("hex"),
    fingerprint: createHash("sha256").update(rawPublicKey).digest("hex"),
  };
}

/**
 * The Authorization header for one request.
 *
 * @param {ReturnType<typeof loadOrCreateKey>} key
 * @param {string} method
 * @param {string} url absolute URL of the request
 * @param {string} body exactly as sent
 */
export function signatureHeader(key, method, url, body) {
  const { pathname, search } = new URL(url);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const bodyHash = body ? createHash("sha256").update(body).digest("hex") : "";
  const message = [method.toUpperCase(), pathname + search, ts, nonce, bodyHash].join("\n");
  const sig = sign(null, Buffer.from(message, "utf8"), key.privateKey).toString("base64");
  return `Signature keyid=${key.fingerprint},ts=${ts},nonce=${nonce},sig=${sig}`;
}

/**
 * Register the key in `role`. Safe to repeat: Bitroad answers 200 with the
 * same identity for a key it already knows.
 *
 * @param {ReturnType<typeof loadOrCreateKey>} key
 * @param {string} endpoint the MCP endpoint; the key route is on the same origin
 * @param {typeof fetch} fetchImpl
 * @param {"seller" | "buyer"} role
 */
export async function registerKey(key, endpoint, fetchImpl, role) {
  const url = new URL("/api/v1/keys", endpoint).href;
  const body = JSON.stringify({ public_key: key.publicKeyHex, role });
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: signatureHeader(key, "POST", url, body) },
    body,
  });
  if (!response.ok) {
    throw new Error(`Bitroad refused the key (HTTP ${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
}
