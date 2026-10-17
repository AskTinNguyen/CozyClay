// A pasted key is checked against its provider before it is kept (#first-run): one cheap authenticated read
// (the provider's model list, or OpenRouter's key endpoint) tells a wrong key from a right one, so a typo
// shows up under the input instead of as a 401 in the first turn. The answer is one of
//   { ok: true }                         the provider accepted the key
//   { rejected: true, status, message }  the provider refused it (401/403, or Google's invalid-key 400)
//   { unverified: true, message }        the provider could not be asked (offline, timeout, 404, 5xx)
// A rejected key is not saved; an unverified one is saved with a warning, since being offline is no reason
// to lose what was typed. The key travels only in the request to its own provider and is never in a message.

const LABELS = { anthropic: "Anthropic", openai: "OpenAI", google: "Google Gemini", openrouter: "OpenRouter", cliproxy: "CLIProxyAPI" };

/** The request that proves a key for each provider; baseUrl is CLIProxyAPI's server (provider-keys.mjs endpointOf). */
function probeFor(id, key, baseUrl) {
	switch (id) {
		case "anthropic": return { url: "https://api.anthropic.com/v1/models?limit=1", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } };
		case "openai": return { url: "https://api.openai.com/v1/models", headers: { authorization: `Bearer ${key}` } };
		case "google": return { url: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`, headers: {} };
		case "openrouter": return { url: "https://openrouter.ai/api/v1/key", headers: { authorization: `Bearer ${key}` } };
		case "cliproxy": return baseUrl ? { url: `${baseUrl.replace(/\/+$/, "")}/v1/models`, headers: { authorization: `Bearer ${key}` } } : null;
		default: return null;
	}
}

/** The provider's own short reason ("invalid x-api-key"), read from a JSON error body when it has one. */
function reasonOf(text) {
	try {
		const body = JSON.parse(text);
		const message = body?.error?.message ?? body?.message ?? (typeof body?.error === "string" ? body.error : null);
		return typeof message === "string" && message.trim() ? message.trim().slice(0, 160) : null;
	} catch {
		return null;
	}
}

/**
 * verifyProviderKey(id, key, { baseUrl?, fetchImpl?, timeoutMs? }) -> { ok } | { rejected, status, message } | { unverified, message }
 */
export async function verifyProviderKey(id, key, { baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
	const label = LABELS[id] ?? id;
	const probe = probeFor(id, key, baseUrl);
	if (!probe) return { unverified: true, message: `${label} keys cannot be checked here; the key was saved as typed.` };
	const where = id === "cliproxy" ? ` at ${baseUrl}` : "";
	let response;
	try {
		response = await fetchImpl(probe.url, { headers: probe.headers, signal: AbortSignal.timeout(timeoutMs) });
	} catch {
		return { unverified: true, message: `Could not reach ${label}${where} to check the key; it was saved anyway. Check the connection${id === "cliproxy" ? " and the server address" : ""}.` };
	}
	if (response.ok) return { ok: true };
	const text = await response.text().catch(() => "");
	const reason = reasonOf(text);
	const invalidGoogleKey = id === "google" && response.status === 400 && /api.?key/i.test(text);
	if (response.status === 401 || response.status === 403 || invalidGoogleKey) {
		return { rejected: true, status: response.status, message: `${label} rejected this key (${response.status}${reason ? `: ${reason}` : ""}). Check that the whole key was copied.` };
	}
	return { unverified: true, message: `${label}${where} answered ${response.status} when the key was checked; it was saved anyway.` };
}
