#!/usr/bin/env node
/**
 * verify-director-packet.mjs — render_packet (director-packet A5) through the
 * same registry and argument parsing server.mjs serves. In memory it reads the
 * shots cover_scene planned and answers the shot list (shot-list.md, or
 * shot-list.csv) and the packet data, with no pictures, the same bytes on a
 * second call; a range narrows it. Then the same tool over a bus fixture
 * standing in for a connected editor (master and coverage laid by
 * camera.cover): its data is directorPacket over the editor's shots, and it
 * names the editor action that writes the full pack.
 */
import { createToolHandlers } from "./tool-handlers.mjs";
import { directorPacketTool } from "./director-packet-tool.mjs";
import { coveredSequence } from "../test/director-packet-fixture.mjs";
import { directorPacket } from "../src/director-packet/packet.js";
import { SHOT_LIST_COLUMNS } from "../src/director-packet/shot-list.js";

const registry = new Map(createToolHandlers().map((tool) => [tool.name, tool]));
const call = async (name, args = {}) => {
	const tool = registry.get(name), parsed = Object.fromEntries(Object.entries(tool.inputSchema).map(([key, schema]) => [key, schema.parse(args[key])]));
	return (await tool.handler(parsed)).content.map((row) => row.text);
};
let failures = 0, passes = 0;
const check = (label, ok, detail = "") => {
	if (ok) { passes += 1; console.log(`ok - ${label}`); } else { failures += 1; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};

check("render_packet is registered read only", registry.get("render_packet")?.annotations?.readOnlyHint === true && registry.get("render_packet")?.annotations?.destructiveHint === false);
const [empty] = await call("render_packet");
check("with no shots it says what to do", /^No shots in memory: plan some with cover_scene, or connect an editor\.$/.test(empty), empty);

await call("add_character", { subject: "Joon, a man in a grey suit", x: 4, z: 0, facing: -90 });
await call("place_character", { character: "A", x: 0, z: 0, facing: 90 });
await call("cover_scene", { request: "cover this conversation" });
const [list, json] = await call("render_packet");
const packet = JSON.parse(json);
console.log(list.split("\n").slice(0, 3).join("\n"));
check("the head names the range, the checks, the plan and that nothing was rendered",
	/^Director packet: .+, shots 1-\d+ of \d+, [\d.]+s; cuts \d+ cuts?, \d+ flagged; coverage .+; motivation .+; plan \d+ cameras, \d+ moving, \d+ lines, \d+ marks, \d+ walks, \d+ legendRows \(memory: the shots cover_scene planned; no pictures rendered here, an editor's export\.directorPacket renders plan\.png and contact-sheet\.png\)\.$/m.test(list), list.split("\n")[0]);
check("the shot list is shot-list.md: a table row per shot", /^## Shots$/m.test(list) && list.split("\n").filter((line) => /^\| \d+ \| /.test(line)).length === packet.shots.length && packet.shots.length >= 2, `${packet.shots.length} shots`);
check("the data has the cast, a row per shot with its fields and flags, the checks and the plan primitives",
	packet.cast.length === 2 && packet.shots.every((row) => row.frames && row.timecode && row.size && row.angle && row.lensMm.length === 2 && row.measured && Array.isArray(row.capabilities) && Array.isArray(row.flags))
	&& packet.checks.some((row) => row.id === "cuts") && packet.plan.counts.cameras === packet.shots.length && packet.plan.primitives.some((row) => row.kind === "line"), JSON.stringify(packet).slice(0, 300));
const [listAgain, jsonAgain] = await call("render_packet");
check("the same bytes on a second call", listAgain === list && jsonAgain === json);
const [csv] = await call("render_packet", { format: "csv" });
check("format csv answers shot-list.csv", csv.includes(`\n\n${SHOT_LIST_COLUMNS.map(([id]) => id).join(",")}\r\n`) && csv.split("\r\n").filter((line) => /^\d+,/.test(line)).length === packet.shots.length, csv.slice(0, 400));
const [ranged, rangedJson] = await call("render_packet", { from_shot: 2, to_shot: 2, include_plan: false });
const one = JSON.parse(rangedJson);
check("a range narrows it; include_plan false keeps only the plan's counts",
	/shots 2-2 of /.test(ranged) && one.shots.length === 1 && one.shots[0].name === packet.shots[1].name && one.plan.primitives === undefined && one.plan.counts.cameras === 1, ranged.split("\n")[0]);
const [past] = await call("render_packet", { from_shot: 40 });
check("a range past the end says so", /^No shots in 40-end: the sequence has \d+\.$/.test(past), past);

// With an editor: the tool over a bus fixture's shots (the schema builder is a chain stub: the handler is called directly).
const z = new Proxy(function chain() {}, { get: () => z, apply: () => z });
const { f, document } = coveredSequence();
try {
	const view = f.actual.readStudioState();
	const tool = directorPacketTool({ tool: (name, config, handler) => ({ name, ...config, handler }), z, text: (body) => ({ content: [{ type: "text", text: body }] }), liveError: (error) => { throw error; },
		state: { timeline: { fps: 24, frameCount: 240 }, focus: "actor-a" }, scene: () => ({ name: "Rooftop", shotDocument: { shots: document.shots, storyBeats: [] } }),
		stage: () => ({ characters: view.characters, shotAspect: "16:9" }), findCharacter: (id) => view.characters.find((row) => row.id === id), filmback: () => view.filmback,
		refreshLiveDescription: async () => {}, isLive: () => true });
	const answer = (await tool.handler({ format: "markdown", include_plan: true })).content.map((row) => row.text), live = JSON.parse(answer[1]);
	const expected = directorPacket({ ...document, title: "Rooftop" });
	check("live: the editor's five shots, the push-in flagged, as directorPacket answers them",
		live.shots.length === 5 && JSON.stringify(live.shots.map((row) => [row.name, row.measured, row.flags.map((flag) => flag.rule)])) === JSON.stringify(expected.shots.map((row) => [row.name, row.measured, row.flags.map((flag) => flag.rule)]))
		&& live.shots[1].flags[0]?.rule === "unmotivated" && JSON.stringify(live.plan.counts) === JSON.stringify(expected.plan.counts), JSON.stringify(live.shots.map((row) => row.flags)).slice(0, 300));
	check("live: the head names the editor action and the pack's files", /the editor's export\.directorPacket writes packet\/index\.html, packet\/shot-list\.csv, packet\/shot-list\.md, packet\/packet\.json, packet\/plan\.png, packet\/contact-sheet\.png inside the sequence pack/.test(answer[0]), answer[0].split("\n")[0]);
} finally { f.dispose(); }

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
