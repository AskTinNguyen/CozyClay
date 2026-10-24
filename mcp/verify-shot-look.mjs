#!/usr/bin/env node
/**
 * verify-shot-look.mjs — the shot_look MCP tool (colour-script A4), through
 * the same registry and argument parsing server.mjs serves. In memory it works
 * on the shots cover_scene planned: a recipe sets a look, the colour script
 * reads it back with the colour change across each cut, same_as copies it, a
 * nudge in words resolves as the router resolves it, image: true returns the
 * colour script as a 960 x 200 PNG. Then a bus fixture stands in for a
 * connected editor: the tool runs shot.setLook and shot.colourScript, and the
 * colour script measures each shot's middle frame from the renderer it is handed.
 */
import { createToolHandlers } from "./tool-handlers.mjs";
import { shotLookTool } from "./shot-look-tool.mjs";
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

check("shot_look is registered as a mutation", registry.get("shot_look")?.annotations?.readOnlyHint === false);
check("with nothing planned it says what to do", /^No shots in memory/.test(await call("shot_look", { recipe: "warm-safety" })));

await call("add_character", { subject: "Joon, a man in a grey suit", x: 4, z: 0, facing: -90 });
await call("place_character", { character: "A", x: 0, z: 0, facing: 90 });
await call("cover_scene", { request: "master and coverage" });
const warm = await call("shot_look", { shot: 1, recipe: "warm-safety" });
check("a recipe sets the first shot's look", /^Look on .+ \(in memory\): warm safety: interior preset, exposure 1\.05, fill 0\.75; intended palette 'amber hearth'/.test(warm), warm);
const cold = await call("shot_look", { shot: 2, recipe: "night-menace" });
check("and a second recipe the next shot's", /night menace: night preset/.test(cold), cold);
const read = await call("shot_look", { request: "colour script for this scene" });
check("the colour script reads every planned shot with its look", /^Colour script \(the master-coverage plan, planned tones\): 5 shots, 2 with a look; 2 hard colour cuts: hard colour cut into 2: darker by 0\.\d\d, colder by 0\.\d\d \(planned\); hard colour cut into 3: brighter/.test(read), read.split("\n")[0]);
check("each column states its look and planned tone", /^1\. .+ warm safety: .+ planned lum 0\.\d+ warmth 0\.\d+$/m.test(read) && /^3\. .+ stage look {2}planned lum/m.test(read), read);
check("the read states its resolution", /^resolved {2}shot\.colourScript · matched "colour script" · confidence high$/m.test(read), read);
const same = await call("shot_look", { request: "the same look as shot 2", shot: 3 });
check("same_as in words copies shot 2's look onto shot 3", /night menace: night preset/.test(same) && /^resolved {2}shot\.setLook · matched "the same look as" · confidence high$/m.test(same), same);
const nudged = await call("shot_look", { request: "make it darker", shot: 3 });
check("a nudge in words lowers the exposure", /exposure 0\.68/.test(nudged) && /matched "darker"/.test(nudged), nudged);
const routed = routeCameraRequest("make it darker");
check("the router answers the same", routed.action === "shot.setLook" && routed.args.adjust === "darker", JSON.stringify(routed));
const refused = await call("shot_look", { shot: 4, same_as: 5 });
check("copying a shot with no look is refused", /^Refused \(TARGET_NOT_READY\)/.test(refused), refused);
const picture = await answer("shot_look", { read: true, image: true });
const png = picture.content[1]?.type === "image" ? decodePng(Buffer.from(picture.content[1].data, "base64")) : null;
check("image: true adds the colour script as a 960 x 200 PNG", png?.width === 960 && png?.height === 200, JSON.stringify(picture.content.map((row) => row.type)));

// With an editor: the tool over a bus fixture standing in for the connected editor (the schema builder is a chain stub).
const z = new Proxy(function chain() {}, { get: () => z, apply: () => z });
const { f } = coveredSequence({ roll: false, dissolve: false }), calls = [];
// The renderer: a warm frame for the first shot, a cold one after it (rows of one colour, 64 x 36).
const frame = (rgb) => ({ data: new Uint8Array(64 * 36 * 4).map((_, i) => (i % 4 === 3 ? 255 : rgb[i % 4])), width: 64, height: 36 });
const shots = () => [...f.live.current.shots].sort((a, b) => a.startFrame - b.startFrame);
f.actionHandlers.current.renderFrameBuffer = (at) => frame(at <= shots()[0].endFrame ? [230, 170, 110] : [60, 90, 150]);
try {
	const live = shotLookTool({ tool: (name, config, handler) => ({ name, ...config, handler }), z, text: (body) => ({ content: [{ type: "text", text: body }] }),
		liveError: (error) => { throw error; }, state: {}, refreshLiveDescription: async () => {}, isLive: () => true,
		runStudioCommand: async ({ action, args }) => { calls.push(action); return { content: [{ type: "text", text: JSON.stringify(f.run(action, args, "agent")) }] }; } })[0];
	const set = JSON.parse((await live.handler({ shot: 1, recipe: "warm-safety" })).content[0].text);
	check("live: shot_look runs shot.setLook", calls.join(",") === "shot.setLook" && set.ok && shots()[0].look?.recipe === "warm-safety", JSON.stringify(set).slice(0, 300));
	const out = await live.handler({ read: true, image: true }), receipt = JSON.parse(out.content[0].text);
	const [first, second] = receipt.output?.shots ?? [];
	check("live: the colour script measures each middle frame", calls.at(-1) === "shot.colourScript" && receipt.output.measured && first.measured.swatches[0].hex === "#e6aa6e" && first.measured.warmth > 0.4 && second.measured.warmth < -0.3,
		JSON.stringify(receipt).slice(0, 400));
	check("live: the warm-to-cold cut is hard and measured", receipt.output.cuts[0].kind === "hard" && receipt.output.cuts[0].source === "measured" && /^hard colour cut into 2: darker by 0\.\d\d, colder by 0\.\d\d \(measured\)$/.test(receipt.output.cuts[0].words), JSON.stringify(receipt.output.cuts[0]));
	const image = out.content[1] ? decodePng(Buffer.from(out.content[1].data, "base64")) : null;
	check("live: the colour script image is drawn from the receipt", image?.width === 960 && image?.height === 200);
} finally { f.dispose(); }

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
