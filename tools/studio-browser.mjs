/**
 * Headless Chrome plumbing for tools/headless-studio.mjs: an owned Chrome
 * process, a minimal CDP client, and a Studio page seeded with a portable
 * project before the app loads. Restored from the removed ground-truth
 * renderer (tools/gt-render/browser.mjs) with only what headless-studio uses.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnOwned } from "./process-supervisor.mjs";

const CHROME_CANDIDATES = [
	process.env.CHROME_PATH,
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
	process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
].filter(Boolean);

/** Poll `probe` until it resolves truthy; bounded, fails loudly. */
export async function waitFor(label, probe, { timeoutMs = 60000, intervalMs = 100, child = null } = {}) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error(`${label}: process exited early`);
		try {
			const value = await probe();
			if (value) return value;
		} catch {
			// not ready yet; retried until the deadline
		}
		if (Date.now() >= deadline) throw new Error(`${label}: timed out after ${timeoutMs} ms`);
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
}

async function portAnswers(url) {
	try {
		await fetch(url);
		return true;
	} catch {
		return false;
	}
}

/** Launch an owned headless Chrome on CDP `port` with a throwaway profile; answers a CDP client on its page. */
export async function startChrome({ port, children, cleanups }) {
	const chromePath = CHROME_CANDIDATES.find(existsSync);
	if (!chromePath) throw new Error("Google Chrome/Chromium not found; set CHROME_PATH");
	const versionUrl = `http://127.0.0.1:${port}/json/version`;
	if (await portAnswers(versionUrl)) throw new Error(`CDP port ${port} is already in use`);
	const profileDir = mkdtempSync(join(tmpdir(), "cozyclay-headless-studio-"));
	cleanups.push(() => rmSync(profileDir, { recursive: true, force: true }));
	const chrome = spawnOwned(chromePath, [
		"--headless=new",
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${profileDir}`,
		"--window-size=1600,1000",
		"--no-first-run",
		"--no-default-browser-check",
		"about:blank",
	], { stdio: ["ignore", "ignore", "ignore"] });
	children.push(chrome);
	await waitFor("chrome CDP startup", async () => (await fetch(versionUrl)).ok, { child: chrome, timeoutMs: 30000 });
	const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
	const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
	if (!page) throw new Error("headless Chrome exposed no page target");
	return connect(page.webSocketDebuggerUrl);
}

/** Minimal CDP client over Node's global WebSocket. */
async function connect(wsUrl) {
	const ws = new WebSocket(wsUrl);
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = () => reject(new Error(`CDP connect failed: ${wsUrl}`));
	});
	let nextId = 1;
	const pending = new Map();
	const listeners = new Set();
	ws.onmessage = (event) => {
		const message = JSON.parse(event.data);
		if (message.id && pending.has(message.id)) {
			const { resolve, reject } = pending.get(message.id);
			pending.delete(message.id);
			if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
			else resolve(message.result);
			return;
		}
		for (const listener of listeners) listener(message);
	};
	ws.onclose = () => {
		for (const { reject } of pending.values()) reject(new Error("CDP connection closed"));
		pending.clear();
	};
	const send = (method, params = {}) => new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});
	const evaluate = async (expression) => {
		const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
		if (result.exceptionDetails) {
			throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "page evaluation failed");
		}
		return result.result?.value;
	};
	/** Resolve on the next event `method`; subscribe BEFORE triggering it. */
	const once = (method, timeoutMs = 60000) => {
		let listener;
		let timer;
		const promise = new Promise((resolve, reject) => {
			listener = (message) => {
				if (message.method === method) resolve(message.params);
			};
			listeners.add(listener);
			timer = setTimeout(() => reject(new Error(`${method}: no event within ${timeoutMs} ms`)), timeoutMs);
		});
		return promise.finally(() => {
			listeners.delete(listener);
			clearTimeout(timer);
		});
	};
	return { send, evaluate, once, close: () => ws.close() };
}

/** Load a portable project into the same Studio that a user opens. The project
 * document is seeded before the app bundle runs, so this path exercises the
 * real scene store and live-control connection instead of a test renderer. */
export async function openStudioProject(cdp, studioUrl, project) {
	const origin = new URL(studioUrl).origin;
	if (!project?.scenesDocument || typeof project.scenesDocument !== "object") throw new Error("headless Studio needs a parsed project with scenesDocument");
	await cdp.send("Page.enable");
	await cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
	const scenes = JSON.stringify(project.scenesDocument), name = String(project.name || "Headless Project");
	const values = [
		`localStorage.setItem('cozyclay.scenes.v5', ${JSON.stringify(scenes)})`,
		`localStorage.setItem('cozyclay.project-session.v1', ${JSON.stringify(JSON.stringify({ name, previsMode: project.previsMode || "animation", updatedAt: Date.now() }))})`,
		project.workflow ? `localStorage.setItem('cozyclay.workflow.v1', ${JSON.stringify(JSON.stringify(project.workflow))})` : null,
		project.workspaceLayout ? `localStorage.setItem('cozyclay.workspace-layout.v1', ${JSON.stringify(JSON.stringify(project.workspaceLayout))})` : null,
	].filter(Boolean);
	const source = `${values.join("; ")};`;
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source });
	const loaded = cdp.once("Page.loadEventFired");
	await cdp.send("Page.navigate", { url: studioUrl });
	await loaded;
	await waitFor("Studio canvas", async () => cdp.evaluate("Boolean(document.querySelector('canvas'))"), { timeoutMs: 60000 });
}
