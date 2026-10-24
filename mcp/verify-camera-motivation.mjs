#!/usr/bin/env node
/**
 * verify-camera-motivation.mjs — the motivation MCP tools against the
 * in-memory scene, through the same registry and argument parsing server.mjs
 * serves: check_motivation reads the shots cover_scene planned and the move
 * mark_camera_move marked, against the story beats story_beats keeps and the
 * subjects' travel, and says in its answer that motion beats (takes) are not
 * read in memory. A push marked with no beat is unmotivated; a beat on its
 * first frame motivates it; a beat 20 frames in flags starts-off-beat. The
 * director's words resolve the same way the router does. No editor is connected;
 * the last checks stand a bus fixture in for one: story_beats edits through the
 * story actions and lists through story.listBeats, every beat with its id and
 * frame, the ones no move answers to included.
 */
import { createToolHandlers } from "./tool-handlers.mjs";
import { routeCameraRequest } from "../src/camera-coverage/route.js";
import { cameraMotivationTools } from "./camera-motivation-tools.mjs";
import { shotsFixture } from "../test/bus/shots-fixture.mjs";

const registry = new Map(createToolHandlers().map((tool) => [tool.name, tool]));
const call = async (name, args = {}) => {
	const tool = registry.get(name), parsed = Object.fromEntries(Object.entries(tool.inputSchema).map(([key, schema]) => [key, schema.parse(args[key])]));
	return (await tool.handler(parsed)).content[0].text;
};
let failures = 0, passes = 0;
const check = (label, ok, detail = "") => {
	if (ok) { passes += 1; console.log(`ok - ${label}`); } else { failures += 1; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};
const NOTE = "memory: no takes are installed here, so motion beats are not read; story beats and subject travel only";

check("both motivation tools are registered and annotated", registry.get("check_motivation")?.annotations?.readOnlyHint === true && registry.get("story_beats")?.annotations?.destructiveHint === true);
const empty = await call("check_motivation");
check("check_motivation with nothing to check says what to do, and what memory reads", empty.includes("No shots to check in memory") && empty.includes(NOTE), empty);

await call("add_character", { subject: "Joon, a man in a grey suit", x: 4, z: 0, facing: -90 });
await call("place_character", { character: "A", x: 0, z: 0, facing: 90 });
await call("cover_scene", { request: "cover the action" });
const action = await call("check_motivation", { request: "is this move motivated?" });
check("the action coverage plan: its tracking shot travels with its subject; the answer says memory reads beats and travel only",
	/^1 move\(s\) in 4 shot\(s\) checked \(the action-coverage plan; memory: no takes are installed here, so motion beats are not read; story beats and subject travel only\): every move has its reason\.$/m.test(action)
	&& /ACTION 2 · Track .* {2}f\d+-\d+ {2}tracking {2}motivated by its subject \(rides a rail that follows the subject\)/.test(action), action);
check("the question states its resolution", /^resolved {2}camera\.checkMotivation · matched "motivated" · confidence high$/m.test(action), action);

// A push-in marked by hand: from 5 m to 2.5 m in front of Mara, over 3 s from frame 0.
await call("set_camera", { x: 0, y: 1.6, z: 5, look_at_x: 0, look_at_y: 1.4, look_at_z: 0, focal_mm: 35 });
await call("mark_camera_move");
await call("set_camera", { x: 0, y: 1.6, z: 2.5, look_at_x: 0, look_at_y: 1.4, look_at_z: 0, focal_mm: 35 });
const bare = await call("check_motivation");
check("a marked push with no beat is unmotivated, with the fix to hold", /^Marked move {2}f0-71 {2}push-in {2}unmotivated$/m.test(bare) && /move marked-move f0-71 {2}high unmotivated: .* Fix: hold \(lock the camera off\)/.test(bare), bare);
const added = await call("story_beats", { request: "add a beat 'confession' at 20" });
check("story_beats adds a beat from words and states its resolution", /story-beat-1 disclosure "confession" at f20/.test(added) && /resolved {2}story\.addBeat frame 20 · matched "add", "beat" · confidence high/.test(added), added);
const late = await call("check_motivation");
check("a beat 20 frames into the push flags starts-off-beat with its fix", /medium starts-off-beat: The push starts at f0, 20 frames before 'confession' \(f20\)\. Fix: start the push at f20 on 'confession'\./.test(late)
	&& /beats {5}disclosure "confession" at f20/.test(late), late);
const moved = await call("story_beats", { op: "move", beat: "confession", frame: 2 });
check("story_beats moves it", /disclosure "confession" at f2\./.test(moved), moved);
const good = await call("check_motivation");
check("a beat on the push's start motivates it: clean", /every move has its reason/.test(good) && /push-in {2}motivated by story beat 'confession' \(f2\)/.test(good), good);
const removed = await call("story_beats", { request: "remove the beat 'confession'" });
check("story_beats removes it by its label", /^0 story beat\(s\) in memory: none\./m.test(removed), removed);
const listed = await call("story_beats");
check("story_beats with nothing to do lists the beats", /^0 story beat\(s\) in memory/.test(listed), listed);
const routed = routeCameraRequest("start the push on the reveal");
check("\"start the push on the reveal\" resolves to camera.alignMove on the reveal", routed.action === "camera.alignMove" && routed.args.beat === "reveal" && routed.args.edge === "start", JSON.stringify(routed));

// With an editor: the same tool over a bus fixture standing in for the connected editor (the schema builder is a
// chain stub: the handler is called directly, so its input schema is never read).
const z = new Proxy(function chain() {}, { get: () => z, apply: () => z });
const editor = shotsFixture(), calls = [];
try {
	const liveTools = new Map(cameraMotivationTools({ tool: (name, config, handler) => ({ name, ...config, handler }), z, text: (body) => ({ content: [{ type: "text", text: body }] }),
		liveError: (error) => { throw error; }, state: {}, cast: () => [], filmback: () => null, framing: () => null, refreshLiveDescription: async () => {}, isLive: () => true,
		runStudioCommand: async ({ action, args }) => { calls.push(action); return { content: [{ type: "text", text: JSON.stringify(editor.run(action, args, "agent")) }] }; } }).map((row) => [row.name, row]));
	const liveCall = async (args) => JSON.parse((await liveTools.get("story_beats").handler(args)).content[0].text);
	await liveCall({ frame: 40, label: "the letter", kind: "reveal" });
	await liveCall({ request: "add a beat 'confession' at 12" });
	const listed = await liveCall({ op: "list" });
	check("live story_beats list runs story.listBeats and answers every beat with its id and frame",
		calls.join(",") === "story.addBeat,story.addBeat,story.listBeats" && listed.ok === true
		&& JSON.stringify(listed.output.beats.map((row) => [row.id, row.frame])) === JSON.stringify([["story-beat-2", 12], ["story-beat-1", 40]]), JSON.stringify({ calls, listed }).slice(0, 400));
	const bare = await liveCall({});
	check("live story_beats with nothing to do lists too", calls.at(-1) === "story.listBeats" && /^2 story beats: story-beat-2 disclosure "confession" at f12, story-beat-1 reveal "the letter" at f40\.$/.test(bare.summary), JSON.stringify(bare).slice(0, 300));
} finally { editor.dispose(); }

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
