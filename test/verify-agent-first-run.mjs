#!/usr/bin/env node
// First-run model registration (#first-run): what a fresh install meets when it adds its own models.
// 1. a pasted key is checked with its provider (provider-verify.mjs): refused -> not saved, offline -> saved
//    with a warning, accepted -> verified; the key never appears in a message;
// 2. CLIProxyAPI's server address is saved on this machine (provider-keys.mjs endpoints), the environment
//    still wins, and the registry is rebuilt with it (providers.mjs cliproxy base);
// 3. a live model list that failed once is asked again (it was cached as failed until a restart);
// 4. a provider's 401 in a turn becomes "fix the key", not the raw JSON and a plain retry.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rootDir = mkdtempSync(join(tmpdir(), "cozyclay-first-run-"));
process.env.COZYCLAY_CONFIG_DIR = join(rootDir, "config");
process.env.COZYCLAY_CODEX_AUTH_FILE = join(rootDir, "config", "codex-auth.json");
process.env.COZYCLAY_AGENT_SESSIONS_DIR = join(rootDir, "sessions");
for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "CLIPROXY_API_KEY", "CLIPROXY_BASE_URL"]) delete process.env[name];

const [{ createAgentHandler }, keys, providers, { verifyProviderKey }, { keyRefusedMessage }] = await Promise.all([
	import("../bin/agent/agent-routes.mjs"),
	import("../bin/agent/provider-keys.mjs"),
	import("../bin/agent/providers.mjs"),
	import("../bin/agent/provider-verify.mjs"),
	import("../src/workflow/agent-client.js"),
]);

let failures = 0;
const check = async (name, fn) => {
	try { await fn(); console.log(`PASS ${name}`); } catch (error) { failures += 1; console.log(`FAIL ${name} — ${error.message}`); }
};
const answer = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const SECRET = "sk-test-0123456789abcdef";

// 1. key checks
await check("a key its provider accepts is verified", async () => {
	assert.deepEqual(await verifyProviderKey("anthropic", SECRET, { fetchImpl: answer(200, { data: [] }) }), { ok: true });
});
await check("a 401 is a rejection naming the provider's reason, never the key", async () => {
	const result = await verifyProviderKey("anthropic", SECRET, { fetchImpl: answer(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }) });
	assert.equal(result.rejected, true);
	assert.match(result.message, /Anthropic rejected this key \(401: invalid x-api-key\)/);
	assert.ok(!result.message.includes(SECRET));
});
await check("Google's invalid-key 400 is a rejection", async () => {
	const result = await verifyProviderKey("google", SECRET, { fetchImpl: answer(400, { error: { message: "API key not valid. Please pass a valid API key." } }) });
	assert.equal(result.rejected, true);
});
await check("an unreachable provider or a 5xx leaves the key unverified, with a warning", async () => {
	const offline = await verifyProviderKey("openai", SECRET, { fetchImpl: async () => { throw new TypeError("fetch failed"); } });
	assert.equal(offline.unverified, true);
	assert.match(offline.message, /Could not reach OpenAI/);
	assert.equal((await verifyProviderKey("openrouter", SECRET, { fetchImpl: answer(503, "busy") })).unverified, true);
});
await check("CLIProxyAPI is checked at its own server with a bearer key", async () => {
	let seen;
	await verifyProviderKey("cliproxy", SECRET, { baseUrl: "http://proxy.example:8317", fetchImpl: async (url, init) => { seen = { url, auth: init.headers.authorization }; return answer(200, { data: [] })(); } });
	assert.equal(seen.url, "http://proxy.example:8317/v1/models");
	assert.equal(seen.auth, `Bearer ${SECRET}`);
});

// 2. server addresses
await check("CLIProxyAPI's address: default, then saved (cleaned), the environment wins, reset goes back", async () => {
	assert.deepEqual(keys.endpointOf("cliproxy", {}), { url: "http://127.0.0.1:8317", source: "default", env: "CLIPROXY_BASE_URL" });
	assert.equal(keys.setEndpoint("cliproxy", "  https://proxy.example.org/v1/ "), "https://proxy.example.org");
	assert.equal(keys.endpointOf("cliproxy", {}).source, "file");
	assert.equal(keys.endpointOf("cliproxy", { CLIPROXY_BASE_URL: "http://env.example:1/" }).url, "http://env.example:1");
	assert.throws(() => keys.setEndpoint("cliproxy", "proxy.example.org"), /full server address/);
	assert.throws(() => keys.setEndpoint("cliproxy", "ftp://proxy.example.org"), /http:\/\/ or https:\/\//);
	assert.equal(keys.endpointOf("anthropic", {}), null);
	assert.equal((await providers.loadProvider("cliproxy", { env: {} })).getModels()[0].baseUrl.startsWith("https://proxy.example.org"), true);
	keys.removeEndpoint("cliproxy");
	assert.equal(keys.endpointOf("cliproxy", {}).source, "default");
});

// routes, with a stub check: "bad" is refused, "offline" cannot be checked, anything else is accepted
const auth = { readStored() {}, writeStored() {}, logout() {}, status() { return { signedIn: false }; }, getAccessToken: async () => null };
const verifyKey = async (id, key) => (key.includes("bad") ? { rejected: true, status: 401, message: "Anthropic rejected this key (401)." } : key.includes("offline") ? { unverified: true, message: "Could not reach Anthropic to check the key; it was saved anyway." } : { ok: true });
const makeServer = async (options) => {
	const handler = createAgentHandler({ auth, liveHub: {}, port: () => server.address().port, ...options });
	const server = createServer((req, res) => handler(req, res).catch((error) => { res.writeHead(500); res.end(error.message); }));
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const origin = `http://127.0.0.1:${server.address().port}`;
	const request = (path, init = {}) => fetch(`${origin}${path}`, { ...init, headers: { origin, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) } });
	return { server, request };
};
const { server, request } = await makeServer({ verifyKey, env: {} });
const providersFile = join(process.env.COZYCLAY_CONFIG_DIR, "providers.json");
await check("a key the provider refuses is answered 400 KEY_REJECTED and not saved", async () => {
	const response = await request("/agent/providers/anthropic", { method: "PUT", body: JSON.stringify({ key: "sk-bad-key" }) });
	assert.equal(response.status, 400);
	const body = await response.json();
	assert.equal(body.code, "KEY_REJECTED");
	assert.ok(!existsSync(providersFile) || !readFileSync(providersFile, "utf8").includes("sk-bad-key"));
});
await check("a key that cannot be checked is saved with a warning; a checked one is verified", async () => {
	const offline = await (await request("/agent/providers/anthropic", { method: "PUT", body: JSON.stringify({ key: "sk-offline-key" }) })).json();
	assert.equal(offline.ok, true);
	assert.equal(offline.verified, false);
	assert.match(offline.warning, /saved anyway/);
	const good = await (await request("/agent/providers/openai", { method: "PUT", body: JSON.stringify({ key: "sk-good-key" }) })).json();
	assert.deepEqual(good, { ok: true, verified: true });
	const listed = (await (await request("/agent/providers")).json()).providers;
	assert.equal(listed.find((entry) => entry.id === "anthropic").signedIn, true);
});
await check("the provider list carries CLIProxyAPI's address; PUT saves it, a bad one is refused, DELETE resets it", async () => {
	const before = (await (await request("/agent/providers")).json()).providers.find((entry) => entry.id === "cliproxy");
	assert.equal(before.endpoint.source, "default");
	assert.equal((await request("/agent/providers/cliproxy/endpoint", { method: "PUT", body: JSON.stringify({ url: "not a url" }) })).status, 400);
	const saved = await (await request("/agent/providers/cliproxy/endpoint", { method: "PUT", body: JSON.stringify({ url: "http://proxy.example:9000/v1" }) })).json();
	assert.equal(saved.endpoint.url, "http://proxy.example:9000");
	assert.equal(saved.endpoint.source, "file");
	assert.equal((await request("/agent/providers/anthropic/endpoint", { method: "PUT", body: JSON.stringify({ url: "http://x.example" }) })).status, 400);
	assert.equal((await (await request("/agent/providers/cliproxy/endpoint", { method: "DELETE" })).json()).endpoint.source, "default");
});
server.close();
await check("an address set in the environment cannot be overwritten from the panel (409)", async () => {
	const { server: envServer, request: envRequest } = await makeServer({ verifyKey, env: { CLIPROXY_BASE_URL: "http://env.example:1" } });
	try {
		assert.equal((await envRequest("/agent/providers/cliproxy/endpoint", { method: "PUT", body: JSON.stringify({ url: "http://other.example" }) })).status, 409);
	} finally { envServer.close(); }
});

// 3. a failed live model list is asked again
await check("CLIProxyAPI's live model list is fetched again after a failure", async () => {
	let calls = 0;
	const upstream = createServer((req, res) => {
		calls += 1;
		if (calls === 1) { res.writeHead(502); res.end("down"); return; }
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ data: [{ id: "claude-opus-4-1", owned_by: "anthropic" }] }));
	});
	upstream.listen(0, "127.0.0.1");
	await once(upstream, "listening");
	try {
		const env = { CLIPROXY_API_KEY: SECRET, CLIPROXY_BASE_URL: `http://127.0.0.1:${upstream.address().port}` };
		const models = await providers.createModels({ auth, env });
		const first = await providers.listAgentModels({ models, auth, env });
		const second = await providers.listAgentModels({ models, auth, env });
		const ids = (list) => list.providers.find((entry) => entry.id === "cliproxy").models.map((model) => model.id);
		assert.equal(calls, 2, `the proxy was asked ${calls} times`);
		assert.ok(ids(first).length > 1, "the failed list falls back to the catalogue");
		assert.deepEqual(ids(second), ["claude-opus-4-1"]);
	} finally { upstream.close(); }
});

// 4. a provider's 401 in a turn
await check("a provider's 401 reads as a key to fix, with the provider's reason and without the JSON", () => {
	const message = keyRefusedMessage('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}');
	assert.equal(message, "The model provider refused the credentials (401: invalid x-api-key). Check the key in Provider keys, or sign in again.");
	assert.equal(keyRefusedMessage(""), "The model provider refused the credentials. Check the key in Provider keys, or sign in again.");
});

rmSync(rootDir, { recursive: true, force: true });
if (failures) { console.error(`${failures} first-run check(s) failed`); process.exit(1); }
console.log("verify-agent-first-run: all checks passed");
