import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeSecureJson } from "./secure-file.mjs";

function configDir() {
	return process.env.COZYCLAY_CONFIG_DIR
		|| join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "cozyclay");
}

function filePath() {
	return join(configDir(), "providers.json");
}

export function readKeys() {
	const path = filePath();
	let raw;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return {};
		throw error;
	}
	let value;
	try {
		value = JSON.parse(raw);
	} catch {
		console.warn(`[agent] providers.json is not valid JSON; ignoring it: ${path}`);
		return {};
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		console.warn(`[agent] providers.json is not valid JSON; ignoring it: ${path}`);
		return {};
	}
	for (const [key, entry] of Object.entries(value)) {
		if (key.length === 0 || typeof entry !== "string" || entry.length === 0) {
			console.warn(`[agent] providers.json has an invalid entry; ignoring it: ${path}`);
			return {};
		}
	}
	return value;
}

export function setKey(id, key) {
	const next = { ...readKeys(), [id]: key };
	writeSecureJson(filePath(), next);
	return next;
}

export function removeKey(id) {
	const next = readKeys();
	delete next[id];
	writeSecureJson(filePath(), next);
	return next;
}

// Endpoints (#first-run): a provider a user runs themselves (CLIProxyAPI) needs its server URL, and an app
// launched from the Dock has no shell to export CLIPROXY_BASE_URL in. The URL is kept beside the keys, in
// endpoints.json; the environment still wins when it is set, then the saved URL, then the default.
const ENDPOINT_ENV = { cliproxy: "CLIPROXY_BASE_URL" };
const ENDPOINT_DEFAULT = { cliproxy: "http://127.0.0.1:8317" };

function endpointsPath() {
	return join(configDir(), "endpoints.json");
}

function readEndpoints() {
	try {
		const value = JSON.parse(readFileSync(endpointsPath(), "utf8"));
		return value && typeof value === "object" && !Array.isArray(value) ? value : {};
	} catch {
		return {};
	}
}

/** A server URL as typed, cleaned: http or https, no trailing slash, no trailing /v1 (the models add it). */
function normalizeEndpoint(url) {
	let parsed;
	try {
		parsed = new URL(String(url ?? "").trim());
	} catch {
		throw new Error("Enter the full server address, such as http://127.0.0.1:8317.");
	}
	if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("The server address must start with http:// or https://.");
	return parsed.href.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** { url, source: "env" | "file" | "default", env } for a provider with a server of its own, else null. */
export function endpointOf(id, env = process.env) {
	const name = ENDPOINT_ENV[id];
	if (!name) return null;
	const fromEnv = typeof env?.[name] === "string" ? env[name].trim() : "";
	if (fromEnv) return { url: fromEnv.replace(/\/+$/, ""), source: "env", env: name };
	const saved = readEndpoints()[id];
	return typeof saved === "string" && saved ? { url: saved, source: "file", env: name } : { url: ENDPOINT_DEFAULT[id], source: "default", env: name };
}

export function setEndpoint(id, url) {
	if (!ENDPOINT_ENV[id]) throw new Error("This provider has no server address to set.");
	const next = { ...readEndpoints(), [id]: normalizeEndpoint(url) };
	writeSecureJson(endpointsPath(), next);
	return next[id];
}

export function removeEndpoint(id) {
	const next = readEndpoints();
	delete next[id];
	writeSecureJson(endpointsPath(), next);
}
