#!/usr/bin/env node
/**
 * verify-intensity-curve.mjs — the check_structure MCP tool (intensity-curve
 * A5), through the same registry and argument parsing server.mjs serves. In
 * memory it reads the shots cover_scene planned against the beats story_beats
 * keeps: master and coverage climbs to its close-ups; shot-reverse-shot goes
 * flat; "build to the reveal" names the beat; strip: true returns the strip as
 * a PNG of 960 x 160. The director's words resolve as the router resolves them.
 * Then a bus fixture stands in for a connected editor: the tool runs
 * camera.checkStructure and draws the strip from its receipt.
 */
import { createToolHandlers } from "./tool-handlers.mjs";
import { intensityCurveTools } from "./intensity-curve-tools.mjs";
import { decodePng } from "./image-file.mjs";
import { routeCameraRequest } from "../src/camera-coverage/route.js";
import { coveredSequence } from "../test/bus/sequence-fixture.mjs";

const registry = new Map(createToolHandlers().map((tool) => [tool.name, tool]));
const answer = async (name, args = {}) => {
	const tool = registry.get(name), parsed = Object.fromEntries(Object.entries(tool.inputSchema).map(([key, schema]) => [key, schema.parse(args[key])]));
	return tool.handler(parsed);
};
const call = async (name, args) => (await answer(name, args)).content[0].text;
let failures = 0, passes = 0;
const check = (label, ok, detail = "") => {
	if (ok) { passes += 1; console.log(`ok - ${label}`); } else { failures += 1; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};

check("check_structure is registered read-only", registry.get("check_structure")?.annotations?.readOnlyHint === true && registry.get("check_structure")?.annotations?.destructiveHint === false);
check("with nothing planned it says what to do", /^No shots to read in memory/.test(await call("check_structure")));

await call("add_character", { subject: "Joon, a man in a grey suit", x: 4, z: 0, facing: -90 });
await call("place_character", { character: "A", x: 0, z: 0, facing: 90 });
await call("cover_scene", { request: "master and coverage" });
const shown = await call("check_structure", { request: "show me the intensity" });
const combined = [...shown.matchAll(/^\d\. .* {2}f\d+-\d+ {2}(\d\.\d\d) {2}size /gm)].map((hit) => Number(hit[1]));
check("master and coverage: five shots, the close-ups above the master", combined.length === 5 && combined[0] < combined[3] && combined[0] < combined[4] && combined[0] === Math.min(...combined), shown);
check("each shot states its seven components", /size \d\.\d\d, height \d\.\d\d, lens \d\.\d\d, movement \d\.\d\d, cutting \d\.\d\d, roll \d\.\d\d, screen jump \d\.\d\d$/m.test(shown), shown);
check("the answer says where it builds and that only flat runs without beats", /rules flat\): intensity builds from 0\.\d\d at beat 1 to a peak of 0\.\d\d at beat [45]/.test(shown) && /beats {5}none \(story_beats adds them; without them only flat runs\)/.test(shown), shown.split("\n")[0]);
check("the question states its resolution", /^resolved {2}camera\.checkStructure · matched "intensity" · confidence high$/m.test(shown), shown);

await call("cover_scene", { request: "cover this conversation" });
const flat = await call("check_structure", { request: "where does this sequence go flat?" });
check("shot-reverse-shot on one lens goes flat, with a technique stack to break it", /medium flat f\d+-\d+: Shots 1-4 .* go flat: .* Try: one size tighter \(.+\), a lower angle, a longer lens \(\d+ mm\).* \(apply_camera_technique [a-z-]+ \+ low-angle on .+\)\.$/m.test(flat), flat);

await call("story_beats", { frame: 60, label: "the letter", kind: "reveal" });
const built = await call("check_structure", { request: "build to the reveal" });
check("\"build to the reveal\" reads the reveal and every rule", /rules flat, peak-off-beat, no-build\)/.test(built) && /beats {5}reveal "the letter" at f60/.test(built) && /^resolved {2}camera\.checkStructure · matched "build to the" · confidence high$/m.test(built), built);
const routed = routeCameraRequest("build to the reveal");
check("the router answers the same", routed.action === "camera.checkStructure" && routed.args.beat === "reveal", JSON.stringify(routed));

const strip = await answer("check_structure", { strip: true });
const png = strip.content[1]?.type === "image" ? decodePng(Buffer.from(strip.content[1].data, "base64")) : null;
check("strip: true adds the strip as a 960 x 160 PNG", strip.content[1]?.mimeType === "image/png" && png?.width === 960 && png?.height === 160, JSON.stringify(strip.content.map((row) => row.type)));

// With an editor: the tool over a bus fixture standing in for the connected editor (the schema builder is a chain stub).
const z = new Proxy(function chain() {}, { get: () => z, apply: () => z });
const { f } = coveredSequence({ roll: false, dissolve: false }), calls = [];
try {
	const live = intensityCurveTools({ tool: (name, config, handler) => ({ name, ...config, handler }), z, text: (body) => ({ content: [{ type: "text", text: body }] }),
		liveError: (error) => { throw error; }, state: {}, cast: () => [], filmback: () => null, framing: () => null, refreshLiveDescription: async () => {}, isLive: () => true,
		runStudioCommand: async ({ action, args }) => { calls.push(action); return { content: [{ type: "text", text: JSON.stringify(f.run(action, args, "agent")) }] }; } })[0];
	const out = await live.handler({ request: "where does this sequence go flat?", strip: true }), receipt = JSON.parse(out.content[0].text);
	check("live: check_structure runs camera.checkStructure and answers the curve", calls.join(",") === "camera.checkStructure" && receipt.ok === true && receipt.output.shots.length === 5
		&& receipt.output.cuts.length === 4 && receipt.output.resolved === "flat words" && /^5 shots: intensity builds/.test(receipt.summary), JSON.stringify(receipt).slice(0, 400));
	const image = out.content[1] ? decodePng(Buffer.from(out.content[1].data, "base64")) : null;
	check("live: the strip is drawn from the receipt", image?.width === 960 && image?.height === 160);
} finally { f.dispose(); }

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
