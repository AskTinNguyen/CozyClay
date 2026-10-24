#!/usr/bin/env node
/**
 * verify-camera-coverage.mjs — the coverage MCP tools against the in-memory
 * scene, through the same registry and argument parsing server.mjs serves
 * (createToolHandlers + each tool's zod schema): cover_scene plans each
 * pattern from words for the in-memory cast and checks its cuts, check_cuts
 * reads the plan again (one cut by frame or by a question), and a character
 * moved across the line afterwards is flagged. No editor is connected.
 */
import { createToolHandlers } from "./tool-handlers.mjs";

const registry = new Map(createToolHandlers().map((tool) => [tool.name, tool]));
const call = async (name, args = {}) => {
	const tool = registry.get(name), parsed = Object.fromEntries(Object.entries(tool.inputSchema).map(([key, schema]) => [key, schema.parse(args[key])]));
	return (await tool.handler(parsed)).content[0].text;
};

let failures = 0, passes = 0;
const check = (label, ok, detail = "") => {
	if (ok) { passes += 1; console.log(`ok - ${label}`); } else { failures += 1; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};
const shotLines = (out) => out.split("\n").filter((line) => line.startsWith("shot "));

check("both coverage tools are registered and annotated", registry.get("cover_scene")?.annotations?.destructiveHint === true && registry.get("check_cuts")?.annotations?.readOnlyHint === true);
const empty = await call("check_cuts");
check("check_cuts before any plan says what to do", /plan some with cover_scene/.test(empty), empty);
const alone = await call("cover_scene", { request: "cover this conversation" });
check("a two-person pattern with one character is refused", /Refused \(TARGET_NOT_READY\).*second character/.test(alone), alone);

await call("add_character", { subject: "Joon, a man in a grey suit", x: 2.4, z: 0, facing: -90 });
await call("place_character", { character: "A", facing: 90 });
const conversation = await call("cover_scene", { request: "cover this conversation" });
check("\"cover this conversation\" plans a shot-reverse-shot: four alternating OTS shots", /^Planned Shot-Reverse-Shot over 0-359/.test(conversation) && shotLines(conversation).length === 4
	&& /OTS Joon/.test(shotLines(conversation)[1]) && /every cut clean/.test(conversation), conversation);
const clean = await call("check_cuts");
check("check_cuts reads the plan clean", /3 cut\(s\) checked in the shot-reverse-shot plan: no rule broken/.test(clean), clean);
for (const [words, pattern, count] of [["give me master and coverage", "Master and Coverage", 5], ["walk and talk", "Walk and Talk", 2], ["clean singles", "Dialogue Singles", 2],
	["cover the action", "Action Coverage", 4], ["establish to detail", "Establish to Detail", 4]]) {
	const out = await call("cover_scene", { request: words });
	check(`"${words}" plans ${pattern} (${count} shots, clean cuts)`, out.startsWith(`Planned ${pattern}`) && shotLines(out).length === count && /every cut clean/.test(out), out);
}
const reverse = await call("cover_scene", { request: "reverse on Joon", start_frame: 24, end_frame: 216, shots: 6 });
check("\"reverse on Joon\" starts on Joon's side, over a range, six shots", /over 24-215/.test(reverse) && /SRS 1 · OTS Joon/.test(shotLines(reverse)[0]) && shotLines(reverse).length === 6, reverse);
const one = await call("check_cuts", { request: "is the cut at 90 crossing the line?" });
check("a question about one cut checks the nearest one", /^1 cut\(s\) checked/.test(one) && /cut 88 /.test(one), one);
await call("place_character", { character: "B", z: 2 });
const crossed = await call("check_cuts", { frame: 88 });
check("a character moved across the cameras' line is flagged with a fix", /high line: .* crosses the .* line/.test(crossed) && /Fix: move/.test(crossed), crossed);
const named = await call("cover_scene", { pattern: "dialogue-singles", cast: ["B", "A"] });
check("cast by letter, Joon first", /SINGLES 1 · Single Joon/.test(named), named);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
