#!/usr/bin/env node
/**
 * verify-camera-capabilities.mjs — set_camera_capabilities against the
 * in-memory scene, through the registry and zod parsing server.mjs serves:
 * roll, focus, shake, mount, speed and shutter land on the camera, null clears
 * one, a lens merges, render_prompt states them, and a technique stack that
 * sets a capability shows it the same way. (The live path, camera.set over the
 * hub, runs in test/qa-camera-capabilities-live-browser.mjs.)
 */
import { createToolHandlers, state } from "./tool-handlers.mjs";

const registry = new Map(createToolHandlers().map((tool) => [tool.name, tool]));
const call = async (name, args = {}) => {
	const tool = registry.get(name), parsed = Object.fromEntries(Object.entries(tool.inputSchema).map(([key, schema]) => [key, schema.parse(args[key])]));
	return (await tool.handler(parsed)).content[0].text;
};

let failures = 0, passes = 0;
const check = (label, ok, detail = "") => {
	if (ok) { passes += 1; console.log(`ok - ${label}`); } else { failures += 1; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};

try {
	check("the tool is registered with an annotation", registry.get("set_camera_capabilities")?.annotations?.destructiveHint === true);
	await call("add_character", { subject: "Mara, a woman in a red coat", x: 0, z: 0, facing: 0 });
	await call("add_character", { subject: "Joon, a man in a grey suit", x: 1.2, z: -3, facing: 0 });
	const set = await call("set_camera_capabilities", { roll_deg: 15, f_stop: 2, focus_on: "C", shake: { amplitude: 0.7 }, speed: 0.5, shutter_deg: 180 });
	check("roll, lens, shake, speed and shutter land on the camera", /a Dutch angle, the horizon tilted 15 degrees, falling to the right/.test(set) && /shallow depth of field at f\/2, focus on Joon/.test(set)
		&& /handheld camera with strong natural shake/.test(set) && /slow motion at 50% speed/.test(set) && /natural motion blur \(180-degree shutter\)/.test(set), set);
	check("the focus target resolves to a cast id", state.cameraCapabilities.lens.focusTarget?.startsWith("char-"), JSON.stringify(state.cameraCapabilities));
	const merged = await call("set_camera_capabilities", { f_stop: 8, roll_deg: null });
	check("a lens patch merges and null clears", /deep depth of field at f\/8, focus on Joon/.test(merged) && !/Dutch/.test(merged), merged);
	const mount = await call("set_camera_capabilities", { mount: { character: "B", bone: "chest" } });
	check("a mount rides a character", /a Snorricam: the camera rigged to Mara's chest/.test(mount), mount);
	const prompt = await call("render_prompt", { mode: "video", environment: "a rooftop at dusk" });
	check("render_prompt states the capabilities", /\nrig .*deep depth of field at f\/8.*Snorricam/.test(prompt) && /Camera: .*slow motion at 50% speed/.test(prompt), prompt);
	const keyed = await call("set_camera_capabilities", { roll_deg: 5, at_frame: 10 });
	check("at_frame needs the editor's shots", /connect the editor/.test(keyed), keyed);
	const rack = await call("apply_camera_technique", { stack: ["medium-shot", "rack-focus", "whip-pan"], subject: "B" });
	check("a technique stack sets its capabilities on the in-memory camera", /camera {4}shallow depth of field at f\/1.4, a rack focus from Mara to [^;]+; heavy motion blur \(270-degree shutter\)/.test(rack) && !/prompt-only/.test(rack), rack);
	const after = await call("render_prompt", { mode: "video", environment: "a rooftop at dusk" });
	check("and render_prompt says it once, in the technique's words", /technique MS · WHIP PAN · RACK/.test(after) && (after.match(/rack focus from Mara to/g) ?? []).length === 2 && !/\nrig /.test(after), after);
} catch (error) {
	failures += 1;
	console.log(`FAIL  threw: ${error.stack}`);
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
