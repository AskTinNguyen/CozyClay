#!/usr/bin/env node
/**
 * verify-render-prompt-sequence.mjs — shot-prompt-engine A6: MCP render_prompt
 * with scope "sequence" and a profile, in memory (no editor), through the same
 * registry and zod parsing server.mjs serves. cover_scene plans master and
 * coverage for the in-memory cast; render_prompt then writes the brief for those
 * shots (one beat each, timecodes, coverage roles, the continuity line), a range
 * of them, and the Veo 3.1 and Kling 3.0 shapes with their warnings. scope "shot"
 * keeps answering the single-shot prompt.
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
const beats = (out) => out.split("\n").filter((line) => /^(\d+\.|Shot \d+,) \d\d:\d\d:\d\d:\d\d-/.test(line));

const schema = registry.get("render_prompt").inputSchema;
check("render_prompt takes scope shot | sequence and a profile", schema.scope.parse(undefined) === "shot" && schema.scope.parse("sequence") === "sequence" && schema.profile.parse("veo-3.1") === "veo-3.1" && schema.profile.parse("kling-2") === "kling-2");
check("an unknown profile is refused by the schema", !schema.profile.safeParse("sora-9").success);
check("render_prompt stays read-only", registry.get("render_prompt").annotations.readOnlyHint === true);

const none = await call("render_prompt", { scope: "sequence" });
check("with no planned shots it says what to do", /No shots in memory: plan some with cover_scene/.test(none), none);

await call("add_character", { subject: "Joon, a man in a grey suit", x: 2.4, z: 0, facing: -90 });
await call("place_character", { character: "A", facing: 90 });
const planned = await call("cover_scene", { request: "give me master and coverage", start_frame: 0, end_frame: 192 });
check("cover_scene plans five shots in memory", /^Planned Master and Coverage over 0-191/.test(planned), planned);

const brief = await call("render_prompt", { scope: "sequence", style: "night rain, sodium light" });
const lines = brief.split("\n");
check("the brief opens with its header: five shots, 8 s at 24 fps, the stage aspect", /^SEQUENCE: .+: 5 shots, 8s at 24 fps, 16:9\.$/.test(lines[0]), lines[0]);
check("the look comes from style", lines.includes("LOOK: night rain, sodium light."), lines[1]);
check("one numbered beat per planned shot, from 00:00:00:00", beats(brief).length === 5 && beats(brief)[0].startsWith("1. 00:00:00:00-00:00:01:13 "), beats(brief).join(" | "));
check("each beat carries the measured camera and its coverage role", (brief.match(/^ {3}Measured: /gm) ?? []).length === 5 && /^ {3}Coverage: Master on .+ in Master and Coverage\.$/m.test(brief) && /^ {3}Coverage: CU on Joon in Master and Coverage\.$/m.test(brief), brief);
check("the cast lines keep their descriptors", /^- B: Joon, a man in a grey suit\. The same person in every beat/m.test(brief), brief);
check("a continuity line closes the beats", /^CONTINUITY: Every camera stays on the (left|right) side of the .+-Joon line/m.test(brief), lines.find((line) => line.startsWith("CONTINUITY")));
check("memory says frames come from an editor's pack", /references\.json: 15 stills by role; missing .*Joon, set \(memory: frames are exported by an editor's keyframe pack\)\.$/.test(brief), lines.at(-1));
check("the same plan gives the same bytes", (await call("render_prompt", { scope: "sequence", style: "night rain, sodium light" })) === brief);

const range = await call("render_prompt", { scope: "sequence", from_shot: 2, to_shot: 3 });
check("from_shot / to_shot brief a range, renumbered from 1", /^SEQUENCE: .+: 2 shots, /.test(range) && beats(range).length === 2 && /^ {3}In: a straight cut from the previous shot\.$/m.test(range), range.split("\n")[0]);

const veo = await call("render_prompt", { scope: "sequence", profile: "veo-3.1" });
check("profile veo-3.1: one clip per beat and a fix for each off-grid length", /^DELIVERY: one clip per beat \(5 clips\)/m.test(veo) && (veo.match(/Veo 3\.1 makes 4, 6, 8 s clips\. Fix: Extend to 4s\./g) ?? []).length === 5, veo.split("\n").filter((line) => line.startsWith("- Beat")).join(" | "));
const kling = await call("render_prompt", { scope: "sequence", profile: "kling-2" });
check("the stale kling-2 id briefs for Kling 3.0 with shot labels", /^FOR: Kling 3\.0 \(3-15 s clips, up to 6 shots/m.test(kling) && /^Shot 1, 1\.58s 00:00:00:00-/m.test(kling), kling.split("\n").slice(0, 4).join(" | "));

const shot = await call("render_prompt", { environment: "a rooftop at dusk" });
check("scope shot still answers the single-shot prompt", !/^SEQUENCE/.test(shot) && /rooftop at dusk/.test(shot), shot.slice(0, 200));
const profiled = await call("render_prompt", { environment: "a rooftop at dusk", profile: "veo-3.1" });
check("scope shot with a profile and no editor says there is no shot to check", /profile Veo 3\.1: no editor shot to check/.test(profiled), profiled.slice(0, 300));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
