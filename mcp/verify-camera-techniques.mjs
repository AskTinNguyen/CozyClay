#!/usr/bin/env node
/**
 * verify-camera-techniques.mjs — the camera technique MCP tools against the
 * in-memory scene, through the same registry and argument parsing server.mjs
 * serves (createToolHandlers + each tool's zod schema, as serveRegistryTool
 * runs them): list and search the library, apply a stack from words, read the
 * move back with describe_camera_move, and see render_prompt state it. No
 * editor is connected, so every tool answers from memory.
 */
import { createToolHandlers } from "./tool-handlers.mjs";

const registry = new Map(createToolHandlers().map((tool) => [tool.name, tool]));
const tools = [...registry.values()];
const call = async (name, args = {}) => {
	const tool = registry.get(name), parsed = Object.fromEntries(Object.entries(tool.inputSchema).map(([key, schema]) => [key, schema.parse(args[key])]));
	return (await tool.handler(parsed)).content[0].text;
};

let failures = 0, passes = 0;
const check = (label, ok, detail = "") => {
	if (ok) { passes += 1; console.log(`ok - ${label}`); } else { failures += 1; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};

try {
	check("both technique tools are registered", ["list_camera_techniques", "apply_camera_technique"].every((name) => tools.some((tool) => tool.name === name)));

	const index = await call("list_camera_techniques");
	check("the index lists all 65 techniques", index.startsWith("65 techniques") && index.split("\n").filter((line) => line.includes(" | ")).length === 65, index.slice(0, 80));
	const search = await call("list_camera_techniques", { query: "uneasy" });
	check("a mood query finds the Dutch angle", search.split("\n")[0].startsWith("dutch-angle"), search);
	const full = JSON.parse(await call("list_camera_techniques", { id: "zolly" }));
	check("an alias reads one technique in full", full.id === "dolly-zoom" && full.expectedMove === "dolly-zoom" && full.params.direction);

	// technique-references A4: the index stays its size and carries no citations; a detail request brings them.
	check("the index stays within its size and carries no book references", Buffer.byteLength(index) <= 3400 && !/ p\. \d|Katz|Kenworthy/.test(index), `${Buffer.byteLength(index)} bytes`);
	const closeUp = JSON.parse(await call("list_camera_techniques", { id: "close-up" }));
	check("a technique id brings its book references (book, pages, cite)", closeUp.references.length >= 1 && closeUp.references.every((ref) => Object.keys(ref).join() === "book,pages,cite"
		&& ref.pages.every(Number.isInteger) && ref.cite.includes(`p. ${ref.pages.join(", ")}`)), JSON.stringify(closeUp.references));
	check("a technique the atlas has no page for answers an empty list", Array.isArray(full.references) && JSON.stringify(JSON.parse(await call("list_camera_techniques", { id: "trunk-shot" })).references) === "[]");
	const refs = await call("list_camera_techniques", { references: true });
	check("references: true lists the citations for techniques, coverage patterns and cut rules in one receipt", Buffer.byteLength(refs) <= 8192
		&& /\nbooks\n/.test(refs) && /\nclose-up: [a-z0-9-]+ p\. \d/.test(refs) && /\ncoverage patterns\nshot-reverse-shot: /.test(refs) && /\ncut rules\nline: /.test(refs), refs.slice(0, 300));
	const withId = JSON.parse(await call("list_camera_techniques", { id: "push-in", references: true }));
	check("references: true with an id reads that technique in full", withId.id === "push-in" && withId.references.length >= 1);

	const push = await call("apply_camera_technique", { request: "low-angle slow push-in" });
	check("words apply a low-angle push-in in memory", /^Applied LOW · PUSH-IN · \d+mm/.test(push) && /verified by the move classifier/.test(push), push);
	const named = await call("describe_camera_move", { duration_s: 3 });
	check("describe_camera_move names the push-in from the marked start", /PUSH-IN \(DOLLY IN\)/.test(named), named);
	const prompt = await call("render_prompt", { mode: "video", environment: "a rain-slicked alley at night" });
	check("render_prompt states the technique", /technique LOW · PUSH-IN/.test(prompt) && /Camera move: from a low angle looking up; a (slow )?push-in \(dolly in\) from a medium-wide shot to a medium close-up; 35mm lens\./.test(prompt), prompt);
	const override = await call("render_prompt", { mode: "video", environment: "an alley", camera_move: "Orbit / arc" });
	check("an explicit camera_move still wins", override.includes("Camera move: orbit / arc."), override);

	const vertigo = await call("apply_camera_technique", { stack: ["vertigo-effect"] });
	check("a vertigo stack verifies as a dolly-zoom", /Dolly-zoom \(vertigo\) \(verified/.test(vertigo), vertigo);
	const dutch = await call("apply_camera_technique", { stack: ["medium-shot", "dutch-angle", "handheld-shot"] });
	check("the Dutch roll and the handheld shake are camera capabilities now, not prompt-only", !/prompt-only/.test(dutch) && /camera {4}a Dutch angle, the horizon tilted 20 degrees, falling to the right; handheld camera with subtle natural shake/.test(dutch), dutch);
	check("and stated in the prompt", /prompt {4}.*a Dutch angle, the horizon tilted 20 degrees, falling to the right; handheld camera with subtle natural shake/.test(dutch), dutch);
	await call("add_character", { subject: "a man in a grey suit", x: 1.6, z: 1.4, facing: -130 });
	const ots = await call("apply_camera_technique", { request: "over the shoulder close-up" });
	check("an over-the-shoulder applies with a second character", /^Applied CU · OTS/.test(ots), ots);
	const refused = await call("apply_camera_technique", { stack: ["pan-shot", "tilt-shot"] });
	check("two moves in one stack are refused", /Refused \(INVALID_ARGUMENT\).*two move techniques/.test(refused), refused);
	const moved = await call("set_camera", { x: 4, y: 1.6, z: 4 });
	const stale = await call("render_prompt", { mode: "video", environment: "an alley" });
	check("a camera moved by hand no longer speaks for the technique", moved.startsWith("Camera set") && !/technique /.test(stale), stale.slice(0, 200));
} finally {
	console.log(`${tools.length} tools in the registry`);
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
