// End to end: tools/headless-studio.mjs starts the real Studio in its own
// headless Chrome with a seeded project, `cclay live capture --out` writes a
// PNG of that scene through the live hub, and stopping the tool frees its
// ports. Needs Chrome (CHROME_PATH or a standard install), so it is a browser
// suite, not part of the default Node run.
//   HEADLESS_PORTS=5205,5305,9305 [HEADLESS_CAPTURE_OUT=frame.png] node test/verify-headless-studio-browser.mjs
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const [studioPort, livePort, cdpPort] = (process.env.HEADLESS_PORTS || "5205,5305,9305").split(",").map(Number);
const PROJECT = "test/fixtures/camera-coverage.cclayproject";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const outDir = mkdtempSync(join(tmpdir(), "cozyclay-headless-verify-"));
let failures = 0;
const check = (label, ok, detail = "") => {
	console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` — ${detail}`}`);
	if (!ok) failures += 1;
};
const listening = (port) => new Promise((resolve) => {
	const socket = createConnection({ host: "127.0.0.1", port });
	socket.once("connect", () => { socket.destroy(); resolve(true); });
	socket.once("error", () => resolve(false));
});

for (const port of [studioPort, livePort, cdpPort]) {
	if (await listening(port)) throw new Error(`port ${port} is already in use; set HEADLESS_PORTS to free ports`);
}

const tool = spawn(process.execPath, ["tools/headless-studio.mjs", "--project", PROJECT, "--port", String(studioPort), "--live-port", String(livePort), "--cdp-port", String(cdpPort)], {
	cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
});
let output = "";
tool.stdout.on("data", (chunk) => { output += chunk; });
tool.stderr.on("data", (chunk) => { output += chunk; });

// Stop the tool and everything it owns: SIGTERM runs its shutdown on POSIX; Windows has no catchable
// TERM for a child, so the whole process tree goes with taskkill.
async function stopTool() {
	if (tool.exitCode !== null) return;
	const exited = new Promise((resolve) => tool.once("exit", resolve));
	if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(tool.pid), "/T", "/F"], { stdio: "ignore" });
	else tool.kill("SIGTERM");
	await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 15000))]);
}

try {
	const ready = await new Promise((resolve) => {
		const deadline = setTimeout(() => resolve(null), 120000);
		const poll = setInterval(() => {
			const match = /\{\s*"ok": true[\s\S]*?\n\}/.exec(output);
			if (match || tool.exitCode !== null) { clearInterval(poll); clearTimeout(deadline); resolve(match ? JSON.parse(match[0]) : null); }
		}, 200);
	});
	check("the tool starts the Studio with the project", ready?.project === "Camera Coverage" && ready?.livePort === livePort, output.slice(-2000));
	if (ready) {
		const out = join(outDir, "capture.png");
		// Async on purpose: a blocking spawnSync stops this process draining the tool's output pipe, and the
		// Studio server stalls writing its log into it.
		const live = (...args) => new Promise((resolve) => {
			const child = spawn(process.execPath, ["bin/cozyclay.mjs", "live", ...args], { cwd: ROOT, env: { ...process.env, COZYCLAY_LIVE_PORT: String(livePort) } });
			let stdout = "", stderr = "";
			child.stdout.on("data", (chunk) => { stdout += chunk; });
			child.stderr.on("data", (chunk) => { stderr += chunk; });
			child.once("exit", (status) => resolve({ status, stdout, stderr }));
		});
		// "ok" means the canvas is up; the editor joins the live hub a moment later.
		const status = await live("status", "--wait");
		check("the Studio joins the live hub", status.status === 0 && /"project":"Camera Coverage"/.test(status.stdout), `exit ${status.status}\n${status.stdout}${status.stderr}`);
		// The shot camera and the figures' models come up after the editor connects ("No renderable shot
		// camera", then figures not yet renderable); capture until both figures render (bounded).
		let capture = null, receipt = null;
		for (let attempt = 0; attempt < 30; attempt += 1) {
			capture = await live("capture", "--out", out);
			receipt = capture.status === 0 ? JSON.parse(capture.stdout.trim().split("\n").pop()) : null;
			if (receipt?.assertions?.characters?.every((row) => row.renderable)) break;
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		check("cclay live capture exits 0", capture.status === 0, `exit ${capture.status}\n${capture.stdout}${capture.stderr}`);
		const bytes = receipt ? readFileSync(out) : Buffer.alloc(0);
		check("the capture is a PNG of real size", bytes.subarray(0, 8).equals(PNG) && bytes.length > 10000, `${bytes.length} bytes`);
		const cast = receipt?.assertions?.characters ?? [];
		check("the capture renders the seeded cast", receipt?.assertions?.blackFrame === false && cast.length === 2 && cast.every((row) => row.renderable && row.visiblePixelCount > 0),
			JSON.stringify(receipt?.assertions ?? null));
		if (process.env.HEADLESS_CAPTURE_OUT && bytes.length) copyFileSync(out, process.env.HEADLESS_CAPTURE_OUT);
	}
} finally {
	await stopTool();
	await new Promise((resolve) => setTimeout(resolve, 1000));
	const left = [];
	for (const port of [studioPort, livePort, cdpPort]) if (await listening(port)) left.push(port);
	check("stopping the tool frees its ports", left.length === 0, `still listening: ${left.join(", ")}`);
	rmSync(outDir, { recursive: true, force: true });
}

if (failures) process.exit(1);
console.log("headless-studio browser: all checks passed");
