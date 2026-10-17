// /agent/providers routes (#first-run, moved out of agent-routes.mjs):
//   GET    /agent/providers                 each provider's sign-in state, and the server address of the ones
//                                           a user runs themselves (CLIProxyAPI): { url, source, env }
//   PUT    /agent/providers/:id             { key }: checked against the provider first (verifyKey, when the
//                                           sidecar is given one) and refused when the provider refuses it
//   DELETE /agent/providers/:id             forget the saved key
//   PUT    /agent/providers/:id/endpoint    { url }: the provider's server address, saved on this machine
//   DELETE /agent/providers/:id/endpoint    back to the environment or the default address
// Every write calls onChange, so the model registry is rebuilt with what was just saved.

const ENDPOINT_PATH = /^\/agent\/providers\/([^/]+)\/endpoint$/;
const KEY_PATH = /^\/agent\/providers\/([^/]+)$/;

/** true when the request was a provider route and has been answered. */
export async function handleProviderRoute(req, res, path, { auth, env = process.env, json, readBody, verifyKey, onChange }) {
	if (path === "/agent/providers" && req.method === "GET") {
		const [{ providerStatus }, keys] = await Promise.all([import("./providers.mjs"), import("./provider-keys.mjs")]);
		try {
			json(res, 200, { providers: providerStatus({ auth, env }).map((provider) => {
				const endpoint = keys.endpointOf(provider.id, env);
				return endpoint ? { ...provider, endpoint } : provider;
			}) });
		} catch { json(res, 500, { error: "provider credentials unavailable" }); }
		return true;
	}
	const endpointMatch = ENDPOINT_PATH.exec(path);
	const keyMatch = endpointMatch ? null : KEY_PATH.exec(path);
	if (!endpointMatch && !keyMatch) return false;
	if (!["PUT", "DELETE"].includes(req.method)) return false;
	const { PROVIDERS } = await import("./providers.mjs");
	const keys = await import("./provider-keys.mjs");
	const id = (endpointMatch ?? keyMatch)[1];
	if (!PROVIDERS.some((provider) => provider.id === id)) { json(res, 404, { error: "provider not found" }); return true; }
	if (endpointMatch) return endpointRoute(req, res, id, { keys, env, json, readBody, onChange });
	const { createCredentialStore } = await import("./credential-store.mjs");
	const credentials = createCredentialStore({ auth, keys });
	let key;
	let check = { ok: true };
	if (req.method === "PUT") {
		if (id === "openai-codex") { json(res, 400, { error: "Use ChatGPT sign-in for OpenAI Codex." }); return true; }
		try {
			const value = await readBody(req);
			if (typeof value?.key !== "string" || !value.key.trim()) throw new Error("Invalid key.");
			key = value.key.trim();
		} catch { json(res, 400, { error: "a non-empty API key is required" }); return true; }
		// verifyKey: a function (tests), true (the real sidecar: provider-verify.mjs), or absent (no check)
		const verify = typeof verifyKey === "function" ? verifyKey : verifyKey ? (await import("./provider-verify.mjs")).verifyProviderKey : null;
		if (verify) check = await verify(id, key, { baseUrl: keys.endpointOf(id, env)?.url });
		if (check.rejected) { json(res, 400, { error: check.message, code: "KEY_REJECTED", status: check.status }); return true; }
	}
	try {
		if (req.method === "PUT") await credentials.modify(id, async () => ({ type: "api_key", key }));
		else await credentials.delete(id);
	} catch { json(res, 500, { error: "provider credentials could not be saved" }); return true; }
	await onChange?.();
	json(res, 200, { ok: true, ...(req.method === "PUT" && verifyKey ? { verified: check.ok === true } : {}), ...(check.unverified ? { warning: check.message } : {}) });
	return true;
}

async function endpointRoute(req, res, id, { keys, env, json, readBody, onChange }) {
	const current = keys.endpointOf(id, env);
	if (!current) { json(res, 400, { error: "This provider has no server address to set." }); return true; }
	if (current.source === "env") { json(res, 409, { error: `The server address is set by ${current.env} in the environment.` }); return true; }
	try {
		if (req.method === "PUT") {
			const value = await readBody(req);
			keys.setEndpoint(id, value?.url);
		} else keys.removeEndpoint(id);
	} catch (error) { json(res, 400, { error: error?.message || "invalid server address" }); return true; }
	await onChange?.();
	json(res, 200, { ok: true, endpoint: keys.endpointOf(id, env) });
	return true;
}
