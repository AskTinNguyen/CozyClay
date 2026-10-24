#!/usr/bin/env node
/**
 * verify-camera-shot-checks.mjs — the check_shots MCP tool (depth-staging A6),
 * through the same registry and argument parsing server.mjs serves. In memory
 * it reads the shots cover_scene planned against the in-memory set: an empty
 * set checks clean and lists each over-the-shoulder's near shoulder; a pillar
 * placed between the first camera and Mara (near her, so the reverses graze it
 * too) is flagged occluded with frames and
 * a fix; the director's words resolve as the router resolves them. Then a bus
 * fixture stands in for a connected editor: the tool runs camera.checkShots,
 * and studio_run's camera.fixShot is reachable from the same receipt.
 */
import { createToolHandlers, state } from "./tool-handlers.mjs";
import { cameraDepthTools } from "./camera-depth-tools.mjs";
import { routeCameraRequest } from "../src/camera-coverage/route.js";
import { createShot } from "../src/cuts.js";
import { createCharacterEntry } from "../src/scenes.js";
import { shotsFixture, framing } from "../test/bus/shots-fixture.mjs";

const registry = new Map(createToolHandlers().map((tool) => [tool.name, tool]));
const call = async (name, args = {}) => {
	const tool = registry.get(name), parsed = Object.fromEntries(Object.entries(tool.inputSchema).map(([key, schema]) => [key, schema.parse(args[key])]));
	return (await tool.handler(parsed)).content[0].text;
};
let failures = 0, passes = 0;
const check = (label, ok, detail = "") => {
	if (ok) { passes += 1; console.log(`ok - ${label}`); } else { failures += 1; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};

check("check_shots is registered read-only", registry.get("check_shots")?.annotations?.readOnlyHint === true && registry.get("check_shots")?.annotations?.destructiveHint === false);
check("with nothing planned it says what to do", /^No shots to check in memory/.test(await call("check_shots")));

await call("add_character", { subject: "Joon, a man in a grey suit", x: 4, z: 0, facing: -90 });
await call("place_character", { character: "A", subject: "Mara", x: 0, z: 0, facing: 90 });
await call("cover_scene", { request: "cover this conversation" });
const clean = await call("check_shots", { request: "check my shots" });
check("an empty set: four shots, nothing flagged", /^4 shot\(s\) checked in the shot-reverse-shot plan \(rules occluded, inside, crop\): nothing blocks a face/.test(clean), clean);
check("each over-the-shoulder lists the near shoulder in its foreground", (clean.match(/^depth {5}SRS \d · OTS \w+: \w+'s shoulder soft in the foreground$/gm) ?? []).length === 4, clean);
check("the question states its resolution", /^resolved {2}camera\.checkShots · matched "check", "shots" · confidence high$/m.test(clean), clean);

const lens = state.coverage.shots[0].cameraKeys[0].framing.pos;
const placed = await call("place_object", { kind: "cylinder", x: lens.x / 5, z: lens.z / 5, name: "Pillar" });
const pillar = placed.match(/\b(obj-[\w-]+|cylinder[\w-]*)\b/)?.[1];
await call("update_object", { id: pillar, scale_x: 0.4, scale_y: 3, scale_z: 0.4 });
const blocked = await call("check_shots", { request: "is anything blocking her face?" });
check("a pillar between the first camera and Mara: her shots are flagged occluded with frames and a fix",
	/for occluded \(rules occluded\): \d issue\(s\) on \d shot\(s\)\./.test(blocked) && /^SRS 3 · OTS Mara {2}high occluded f180,/m.test(blocked) && /^SRS 1 · OTS Mara {2}high occluded f0,[\d,]+,89: Pillar hides Mara's eyes from the lens on \d+ of \d+ sampled frames .* Fix: (slide|raise|lower) [\w ]*\d/m.test(blocked), `${pillar}\n${blocked}`);
check("the question resolves to the occluded rule", /^resolved {2}camera\.checkShots · matched "blocking", "her" · confidence high$/m.test(blocked) && routeCameraRequest("is anything blocking her face?").args.rule === "occluded", blocked);
const cropOnly = await call("check_shots", { rule: "crop" });
check("rule keeps one rule", /for crop \(rules crop\): nothing blocks/.test(cropOnly), cropOnly);
const redirected = await call("apply_camera_technique", { request: "is the camera inside the wall?" });
check("apply_camera_technique points a shot check at check_shots", /asks for camera\.checkShots: use check_shots\./.test(redirected), redirected);

// With an editor: the tool over a bus fixture standing in for the connected editor (the schema builder is a chain stub).
const z = new Proxy(function chain() {}, { get: () => z, apply: () => z });
const characters = [createCharacterEntry({ id: "actor-a", model: "y-bot-tpose", x: 0, z: 0, rot: 90, subject: "Mara" }), createCharacterEntry({ id: "actor-b", model: "y-bot-tpose", x: 4, z: 0, rot: -90, subject: "Joon" })];
const f = shotsFixture({ characters }), calls = [];
try {
	f.shots.load({ shots: [{ ...createShot("Hero", 0, 95, [{ id: "key-a", frame: 0, framing }]), id: "shot-a" }], frameCount: 240, camera: f.actual.readStudioState().camera });
	f.run("camera.applyTechnique", { shotId: "shot-a", subjectId: "actor-a", stack: ["medium-shot"] }, "agent");
	const pos = f.live.current.shots[0].cameraKeys[0].framing.pos;
	f.run("object.add", { kind: "cylinder", placement: { x: pos.x / 2, z: pos.z / 2 }, name: "Pillar" }, "agent");
	const id = f.actual.readStudioState().objects.find((row) => row.name === "Pillar").id;
	f.run("object.set", { id, set: { scale: { x: 0.4, y: 3, z: 0.4 } } }, "agent");
	const live = cameraDepthTools({ tool: (name, config, handler) => ({ name, ...config, handler }), z, text: (body) => ({ content: [{ type: "text", text: body }] }),
		liveError: (error) => { throw error; }, state: {}, cast: () => [], scene: () => null, filmback: () => null, refreshLiveDescription: async () => {}, isLive: () => true,
		runStudioCommand: async ({ action, args }) => { calls.push(action); return { content: [{ type: "text", text: JSON.stringify(f.run(action, args, "agent")) }] }; } })[0];
	const receipt = JSON.parse((await live.handler({ request: "is anything blocking her face?" })).content[0].text), [issue] = receipt.output?.shots?.[0]?.issues ?? [];
	check("live: check_shots runs camera.checkShots and answers the issue with its fix", calls.join(",") === "camera.checkShots" && receipt.ok === true && receipt.output.rule === "occluded"
		&& issue?.by?.[0] === id && Boolean(issue.fix.delta) && receipt.warnings.some((row) => row.code === "SHOT_OCCLUDED"), JSON.stringify(receipt).slice(0, 400));
	const fixed = f.run("camera.fixShot", { shotId: "shot-a", rule: "occluded" }, "agent");
	check("live: the fix it names (studio_run camera.fixShot) clears the shot", fixed.ok === true && fixed.checks.issues === 0, JSON.stringify(fixed).slice(0, 300));
} finally { f.dispose(); }

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
