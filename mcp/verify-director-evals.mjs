#!/usr/bin/env node
/**
 * verify-director-evals.mjs — live parity for the director eval set
 * (test/fixtures/director-evals): the scenarios run through the MCP tools in
 * memory, through the same registry and argument parsing server.mjs serves
 * (apply_camera_technique for technique rows and negatives, cover_scene for
 * coverage, check_cuts for cut questions), and each answer's `resolved` line
 * must give the same resolution as the router the runner uses
 * (routeCameraRequest) and as the row expects. Composition rows are left
 * out: in memory there is no shot to compose. No editor is connected.
 */
import { createToolHandlers } from "./tool-handlers.mjs";
import { routeCameraRequest } from "../src/camera-coverage/route.js";
import { loadScenarios, resolutionMismatch, resolutionOf } from "../test/director-evals-data.mjs";

const registry = new Map(createToolHandlers().map((tool) => [tool.name, tool]));
const call = async (name, args = {}) => {
	const tool = registry.get(name), parsed = Object.fromEntries(Object.entries(tool.inputSchema).map(([key, schema]) => [key, schema.parse(args[key])]));
	return (await tool.handler(parsed)).content[0].text;
};
let failures = 0, passes = 0;
const check = (label, ok, detail = "") => {
	if (ok) { passes += 1; console.log(`ok - ${label}`); } else { failures += 1; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};

// The eval cast in memory: Mara at the origin facing Joon 4 m along +x.
await call("place_character", { character: "A", subject: "Mara", x: 0, z: 0, facing: 90 });
await call("add_character", { subject: "Joon", x: 4, z: 0, facing: -90 });
const described = await call("describe_scene");
const idOf = (name) => described.match(new RegExp(`\\b([\\w-]+)\\s+"${name}"`))?.[1];
const ids = { mara: idOf("Mara"), joon: idOf("Joon") }, names = Object.fromEntries(Object.entries(ids).map(([key, id]) => [id, key]));
check("the eval cast is in memory", ids.mara && ids.joon && ids.mara !== ids.joon, described.slice(0, 300));
const cast = [{ id: ids.mara, name: "Mara" }, { id: ids.joon, name: "Joon" }];

/** The `resolved` line of an answer as the fields resolutionMismatch compares (subject from "Applied ... on <name>."). */
function readAnswer(out) {
	const line = out.match(/^resolved {2}(\S+)(?: (.*?))? · matched (.*) · confidence (\w+)$/m);
	if (!line) return null;
	const [, action, what = "", matched, confidence] = line, frame = what.match(/^frame (\d+)$/)?.[1];
	const subject = out.match(/^Applied .* on (\w+)\.$/m)?.[1]?.toLowerCase();
	return { action, stack: action === "camera.applyTechnique" && what ? what.split(" + ").map((id) => ({ id })) : undefined, pattern: action === "camera.cover" ? what : undefined,
		frame: frame === undefined ? undefined : Number(frame), confidence, matched: matched === "nothing" ? [] : [...matched.matchAll(/"([^"]*)"/g)].map((hit) => hit[1]), subject };
}

// Motivation rows run through check_motivation and story_beats; camera.alignMove retimes editor keys, so it has no in-memory tool (studio_run reaches it live).
const tools = { "camera.applyTechnique": "apply_camera_technique", none: "apply_camera_technique", "camera.cover": "cover_scene", "camera.checkCuts": "check_cuts",
	"camera.checkMotivation": "check_motivation", "story.addBeat": "story_beats", "story.moveBeat": "story_beats", "story.removeBeat": "story_beats" };
const rows = loadScenarios().filter((row) => row.tier === "core" && !row.expected.composition && tools[row.expected.action]);
const byTool = {};
await call("cover_scene", { request: "cover this conversation" }); // check_cuts in memory reads a plan.
for (const row of rows.sort((a, b) => (a.expected.action === "camera.checkCuts") - (b.expected.action === "camera.checkCuts"))) {
	const tool = tools[row.expected.action], out = await call(tool, { request: row.request });
	if (row.expected.action === "camera.cover" && /^Planned /.test(out)) await call("cover_scene", { request: "cover this conversation" });
	const got = readAnswer(out), routed = routeCameraRequest(row.request, { cast }), want = resolutionOf(routed);
	if (!got) { check(`${row.id}: ${tool} states what it resolved`, false, out.slice(0, 300)); continue; }
	const sameAsRunner = got.action === want.action && JSON.stringify(got.stack?.map((item) => item.id)) === JSON.stringify(want.stack?.map((item) => item.id))
		&& (got.pattern ?? null) === (want.pattern ?? null) && (got.frame ?? null) === (want.frame ?? null) && got.confidence === want.confidence && JSON.stringify(got.matched) === JSON.stringify(routed.matched);
	const expected = resolutionMismatch({ ...row.expected, params: undefined, cast: undefined, label: undefined, kind: undefined, beat: undefined, edge: undefined, subject: row.expected.action === "camera.applyTechnique" ? row.expected.subject : undefined },
		{ ...got, subject: got.subject && (names[ids[got.subject]] ?? got.subject) });
	byTool[tool] = (byTool[tool] ?? 0) + 1;
	check(`${row.id} via ${tool}: ${got.action}${got.stack ? ` ${got.stack.map((item) => item.id).join("+")}` : ""}${got.pattern ? ` ${got.pattern}` : ""} (${got.confidence}) matches the runner and the row`,
		sameAsRunner && !expected.length, `${sameAsRunner ? "" : `runner ${JSON.stringify({ ...want, matched: routed.matched })} vs mcp ${JSON.stringify(got)}; `}${expected.join("; ")}\n${out.slice(0, 300)}`);
}
check(`at least 10 scenarios ran through the MCP tools (${Object.entries(byTool).map(([tool, count]) => `${tool} ${count}`).join(", ")})`, passes >= 11 && Object.keys(byTool).length === new Set(Object.values(tools)).size);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
