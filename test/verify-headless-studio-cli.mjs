// tools/headless-studio.mjs loads: every import resolves (--help runs after them),
// and a missing --project is a usage error, not a crash. The browser run is
// test/verify-headless-studio-browser.mjs.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const run = (...args) => spawnSync(process.execPath, ["tools/headless-studio.mjs", ...args], { cwd: ROOT, encoding: "utf8" });
let failures = 0;
const check = (label, ok, detail = "") => {
	console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` — ${detail}`}`);
	if (!ok) failures += 1;
};

const help = run("--help");
check("--help exits 0", help.status === 0, `exit ${help.status}\n${help.stderr}`);
check("--help prints the usage", /headless-studio - start the real Studio/.test(help.stdout) && /--cdp-port/.test(help.stdout), help.stdout);

const bare = run();
check("no --project is a usage error (exit 2)", bare.status === 2 && /--project <file>/.test(bare.stderr), `exit ${bare.status}\n${bare.stderr}`);

if (failures) process.exit(1);
console.log("headless-studio cli: all checks passed");
