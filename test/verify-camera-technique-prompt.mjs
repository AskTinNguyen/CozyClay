// The applied camera technique travels with the shot: stored on it (and kept
// through save, reload and the older-body migration), and stated in the export
// prompt (shot-prompt.js, the keyframe pack's prompt.txt) in the words the
// move classifier confirms. It stops speaking for the shot once the camera is
// edited by hand. (MCP render_prompt: mcp/verify-camera-techniques.mjs.)
import assert from "node:assert/strict";
import { compileStack } from "../src/camera-techniques/compile.js";
import { classifyKeys, techniquePhrase } from "../src/camera-techniques/readback.js";
import { currentTechnique, repairShotTechnique, techniqueSignature } from "../src/camera-techniques/storage.js";
import { classifyMove } from "../src/camera-move.js";
import { createShot } from "../src/cuts.js";
import { keyframePackEntries } from "../src/keyframe-pack.js";
import { readShotAuthoringDocument, readShotAuthoring, serializeShotAuthoring } from "../src/shot-authoring.js";
import { shotCaptureMeta } from "../src/shot-meta.js";
import { buildShotPrompt } from "../src/shot-prompt.js";
import { focalMmToFov } from "../src/shot.js";

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("ok -", name); };
const filmback = { sensorId: "fullFrame", aspectRatio: 16 / 9 };
const subject = { id: "actor-a", x: 0, z: 0, rot: 0, height: 1.8 };
const framingOf = (exact) => {
	const d = { x: exact.lookAt.x - exact.position.x, y: exact.lookAt.y - exact.position.y, z: exact.lookAt.z - exact.position.z };
	return { pos: { ...exact.position }, yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), fovDeg: focalMmToFov(exact.focalMm, filmback.sensorId, filmback.aspectRatio) * 180 / Math.PI };
};
/** A shot the way camera.applyTechnique leaves it: keys, eases and the stored stack. */
function applied(stack, extra = {}) {
	const shot = { ...createShot("Hero", 0, 71), id: "shot-a" }, plan = compileStack(stack, { subject, cast: [subject], shot, filmback });
	shot.cameraKeys = plan.keys.map((key, i) => ({ id: `key-${i}`, frame: key.frame, framing: framingOf(key.framing), ...(key.ease ? { ease: key.ease } : {}) }));
	const move = classifyKeys(shot.cameraKeys, subject, { filmback });
	shot.technique = { stack: plan.stack, label: plan.label, phrase: techniquePhrase(plan, move), move: move.id, promptOnly: plan.promptOnly.map((part) => part.id), signature: techniqueSignature(shot), ...extra };
	return { shot, plan, move };
}
const metaOf = (shot) => shotCaptureMeta({ shot, fps: 24, aspectKey: "16:9", lens: { focalMm: 35, fovDeg: 40 }, cast: [{ name: "Mara" }] });

check("the stored stack survives save and reload, eases included", () => {
	const { shot } = applied(["low-angle", "push-in"]), crash = applied(["crash-zoom"]).shot;
	const state = readShotAuthoring(serializeShotAuthoring({ shots: [shot, { ...crash, id: "shot-b", startFrame: 80, endFrame: 151, cameraKeys: crash.cameraKeys.map((key) => ({ ...key, id: `${key.id}-b`, frame: key.frame + 80 })) }], frameCount: 200 })).state;
	assert.deepEqual(state.shots[0].technique, shot.technique);
	assert.ok(currentTechnique(state.shots[0]), "and still describes the reloaded camera");
	assert.equal(state.shots[1].cameraKeys[1].ease, "linear", "the crash zoom keeps its constant-speed segment");
});

check("an older body without a technique loads unchanged, and a malformed one is dropped", () => {
	const v4 = { version: 4, frameCount: 120, shots: [{ id: "s1", name: "Old", startFrame: 0, endFrame: 47, cameraKeys: [], camera: { mode: "keys" } }] };
	const read = readShotAuthoringDocument(v4);
	assert.equal(read.status, "migrated");
	assert.equal("technique" in read.state.shots[0], false);
	assert.equal(repairShotTechnique({ stack: "push-in" }), null);
	assert.equal(repairShotTechnique({ stack: [{ id: "Bad Id!" }] }), null);
	const kept = repairShotTechnique({ stack: [{ id: "push-in", params: { speed: "slow", nested: { no: 1 }, steps: 2 } }], label: "x".repeat(200), phrase: "p" });
	assert.deepEqual(kept.stack, [{ id: "push-in", params: { speed: "slow", steps: 2 } }]);
	assert.equal(kept.label.length, 80);
	const unknownKey = readShotAuthoringDocument({ version: 5, frameCount: 120, shots: [{ id: "s1", startFrame: 0, endFrame: 47, cameraKeys: [{ id: "k", frame: 0, framing: { pos: { x: 0, y: 1, z: 3 }, yaw: 0, pitch: 0, fovDeg: 40 }, ease: "bounce" }] }] });
	assert.equal("ease" in unknownKey.state.shots[0].cameraKeys[0], false, "an unknown ease heals to the default");
});

check("the export prompt states the stack in the words the classifier confirms", () => {
	const { shot, move } = applied(["low-angle", { id: "push-in", params: { speed: "slow" } }]);
	const recheck = classifyMove(shot.cameraKeys[0].framing, shot.cameraKeys.at(-1).framing, subject, { durationS: 3, ...filmback });
	assert.equal(recheck.id, "push-in");
	const prompt = buildShotPrompt(metaOf(shot), { target: "video" }), line = prompt.split("\n").find((row) => row.startsWith("TECHNIQUE: "));
	assert.ok(line, prompt);
	assert.ok(line.startsWith(`TECHNIQUE: ${shot.technique.label}: from a low angle looking up; `), line);
	assert.ok(line.includes(move.phrase), `${line} should carry the classifier's phrase "${move.phrase}"`);
	assert.ok(line.includes(recheck.phrase.replace(/^a (slow |fast )?/, "")), "the same move an independent classifyMove names");
	console.log(`  ${line}`);
});

check("the keyframe pack's prompt.txt carries it", () => {
	const { shot } = applied(["arc-shot"]);
	const entries = keyframePackEntries({ shot: { title: shot.name, index: 1, startFrame: 0, endFrame: 71 }, fps: 24, firstFramePng: new Uint8Array(1), lastFramePng: null, clip: null,
		camera: metaOf(shot), prompt: buildShotPrompt(metaOf(shot), { target: "video" }) });
	const text = entries.find((entry) => entry.name.endsWith("/prompt.txt")).data;
	assert.match(text, /TECHNIQUE: ARC · \d+mm: an? (fast |slow )?orbit around the subject, arcing 60 degrees/);
	assert.ok(JSON.parse(entries.find((entry) => entry.name.endsWith("/camera.json")).data).technique.label.startsWith("ARC"));
});

check("the camera capabilities a stack sets are stated in its words (roll, slow motion)", () => {
	const { shot } = applied(["medium-shot", "dutch-angle", "slow-motion", "static-shot"]);
	const line = buildShotPrompt(metaOf(shot), { target: "image" }).split("\n").find((row) => row.startsWith("TECHNIQUE: "));
	assert.equal(line, `TECHNIQUE: ${shot.technique.label}: a medium shot from the waist up; a static camera; 40mm lens; a Dutch angle, the horizon tilted 20 degrees, falling to the right; slow motion at 50% speed (shot at 48 fps)`.replace("40mm", line.match(/(\d+)mm lens/)[1] + "mm"));
});

check("a camera edited by hand drops the stack from the prompt", () => {
	const { shot } = applied(["push-in"]);
	const moved = { ...shot, cameraKeys: shot.cameraKeys.map((key, i) => (i === 1 ? { ...key, framing: { ...key.framing, pos: { ...key.framing.pos, x: key.framing.pos.x + 0.5 } } } : key)) };
	assert.equal(currentTechnique(moved), null);
	assert.equal(metaOf(moved).technique, undefined);
	assert.ok(!buildShotPrompt(metaOf(moved), { target: "video" }).includes("TECHNIQUE:"));
	assert.ok(!buildShotPrompt(metaOf({ ...createShot("Plain", 0, 47), id: "plain" }), { target: "video" }).includes("TECHNIQUE:"), "a shot with no technique says nothing");
});

console.log(`\n${passed} checks passed`);
