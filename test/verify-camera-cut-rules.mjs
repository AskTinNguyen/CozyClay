// A3: the editing-rule checks (src/camera-coverage/cut-rules.js) on cuts built
// by hand: for every rule a good cut that passes and a bad one that is flagged
// with its severity, frames and a suggested fix; then zero false flags on
// every A1 coverage pattern planned over four different blockings. Pure.
import assert from "node:assert/strict";
import { checkCut, checkCuts } from "../src/camera-coverage/cut-rules.js";
import { castAt } from "../src/camera-coverage/cut-geometry.js";
import { planCoverage, plannedShot } from "../src/camera-coverage/plan.js";
import { COVERAGE_PATTERNS } from "../src/camera-coverage/patterns.js";

const filmback = { sensorId: "fullFrame", aspectRatio: 16 / 9 };
let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log(`ok - ${label}`); };

/** A camera key looking from `pos` at a point, as shot.frame stores one. */
const look = (pos, at, fovDeg = 30) => ({ pos, yaw: Math.atan2(-(at.x - pos.x), -(at.z - pos.z)), pitch: Math.atan2(at.y - pos.y, Math.hypot(at.x - pos.x, at.z - pos.z)), fovDeg });
const shot = (id, startFrame, endFrame, framing, subjectId = null) => ({ id, name: id, startFrame, endFrame, kind: "clip", cast: {}, camera: { mode: "keys" }, cameraKeys: [{ id: `${id}-k`, frame: startFrame, framing }], ...(subjectId ? { coverage: { pattern: "test", index: 0, role: "", subjectId } } : {}) });
// Mara at the origin faces Joon 4 m along +x.
const dialogue = [{ id: "a", subject: "Mara", x: 0, z: 0, rot: 90 }, { id: "b", subject: "Joon", x: 4, z: 0, rot: -90 }];
const face = (row) => ({ x: row.x, y: 1.6, z: row.z });
const scene = (cast = dialogue, extra = {}) => ({ cast, filmback, ...extra });
const rules = (cut) => cut.issues.map((issue) => issue.rule);

check("180-degree line: same side passes; the far side is flagged high with a flip-side fix; on the line is a neutral", () => {
	const a = shot("A", 0, 47, look({ x: 2.5, y: 1.6, z: 3.5 }, face(dialogue[0])), "a");
	const good = checkCut(a, shot("B", 48, 95, look({ x: 1.5, y: 1.6, z: 3.5 }, face(dialogue[1])), "b"), scene());
	assert.deepEqual(rules(good), []);
	assert.ok(good.measures.line.sides.every((side) => side > 0));
	const bad = checkCut(a, shot("B", 48, 95, look({ x: 1.5, y: 1.6, z: -3.5 }, face(dialogue[1])), "b"), scene());
	assert.deepEqual(rules(bad), ["line"]);
	const [issue] = bad.issues;
	assert.equal(issue.severity, "high");
	assert.deepEqual(issue.frames, [47, 48]);
	assert.equal(issue.fix.kind, "flip-side");
	assert.match(issue.message, /crosses the Mara–Joon line/);
	const neutral = checkCut(a, shot("B", 48, 95, look({ x: 7, y: 1.6, z: 0.05 }, face(dialogue[0])), "a"), scene());
	assert.ok(!rules(neutral).includes("line"), "a camera on the line is a neutral");
});

check("jump cut: the same subject under 30 degrees and one size step is flagged medium; a size step or a wider angle passes", () => {
	const solo = [{ id: "a", subject: "Mara", x: 0, z: 0, rot: 0 }];
	const around = (deg, distance) => ({ x: Math.sin((deg * Math.PI) / 180) * distance, y: 1.6, z: Math.cos((deg * Math.PI) / 180) * distance });
	const a = shot("A", 0, 47, look(around(30, 3.5), face(solo[0])), "a");
	const bad = checkCut(a, shot("B", 48, 95, look(around(45, 3.6), face(solo[0])), "a"), scene(solo));
	assert.deepEqual(rules(bad), ["jump"]);
	assert.equal(bad.issues[0].severity, "medium");
	assert.equal(bad.issues[0].fix.kind, "change-size");
	assert.ok(bad.measures.jump.angleDeg < 30 && bad.measures.jump.sizeSteps === 0);
	assert.deepEqual(rules(checkCut(a, shot("B", 48, 95, look(around(45, 1.6), face(solo[0])), "a"), scene(solo))), [], "a size step passes");
	assert.deepEqual(rules(checkCut(a, shot("B", 48, 95, look(around(75, 3.5), face(solo[0])), "a"), scene(solo))), [], "45 degrees passes");
});

check("screen direction: a walking subject keeps its screen direction; a reversed camera flags it high", () => {
	const walker = [{ id: "a", subject: "Mara", x: 0, z: 0, rot: 90 }];
	// Mara walks along +x at 1.2 m/s: the scene's placement sampler (camera.checkCuts samples the take the same way).
	const placeAt = (row, s, frame) => ({ ...castAt(row, s, frame), x: (frame * 1.2) / 24 });
	const at = (frame) => ({ x: (frame * 1.2) / 24, y: 1.6, z: 0 });
	const a = shot("A", 0, 47, look({ x: 2, y: 1.6, z: 5 }, at(47)), "a");
	const good = checkCut(a, shot("B", 48, 95, look({ x: 5, y: 1.6, z: 2 }, at(48)), "a"), scene(walker, { placeAt }));
	assert.ok(!rules(good).includes("screen"), JSON.stringify(good.measures));
	assert.ok(good.measures.screen.every((value) => value > 0), "screen-right in both");
	const bad = checkCut(a, shot("B", 48, 95, look({ x: 2, y: 1.6, z: -4 }, at(48)), "a"), scene(walker, { placeAt }));
	assert.ok(rules(bad).includes("screen"), JSON.stringify(bad));
	const issue = bad.issues.find((row) => row.rule === "screen");
	assert.equal(issue.severity, "high");
	assert.equal(issue.fix.kind, "insert-neutral");
	assert.ok(!rules(bad).includes("line"), "a lone walker's flip is reported once, as screen direction");
});

check("eyelines: in a reverse the speakers look opposite ways; a speaker turned away is flagged medium", () => {
	const a = shot("A", 0, 47, look({ x: 1.8, y: 1.6, z: 2.4 }, face(dialogue[0])), "a");
	const reverse = shot("B", 48, 95, look({ x: 2.2, y: 1.6, z: 2.4 }, face(dialogue[1])), "b");
	const good = checkCut(a, reverse, scene());
	assert.deepEqual(rules(good), []);
	assert.ok(good.measures.eyeline[0] > 0 && good.measures.eyeline[1] < 0, "Mara looks screen-right, Joon screen-left");
	const turned = [dialogue[0], { ...dialogue[1], rot: 60 }];
	const bad = checkCut(a, reverse, scene(turned));
	assert.deepEqual(rules(bad), ["eyeline"]);
	assert.equal(bad.issues[0].severity, "medium");
	assert.match(bad.issues[0].message, /both look screen-right/);
	const sideBySide = [{ ...dialogue[0], rot: 0 }, { ...dialogue[1], rot: 0 }];
	assert.deepEqual(rules(checkCut(a, reverse, scene(sideBySide))), [], "two people facing the same way are not a reverse");
});

check("checkCuts walks consecutive shots, notes gaps and leaves follow cameras unjudged", () => {
	const shots = [shot("A", 0, 47, look({ x: 2.5, y: 1.6, z: 3.5 }, face(dialogue[0])), "a"), shot("B", 48, 95, look({ x: 1.5, y: 1.6, z: -3.5 }, face(dialogue[1])), "b"),
		shot("C", 100, 140, look({ x: 1.5, y: 1.6, z: -3.5 }, face(dialogue[0])), "a"), { ...shot("D", 141, 160, null), camera: { mode: "follow" }, cameraKeys: [] }];
	const result = checkCuts(shots, scene());
	assert.equal(result.cuts.length, 3);
	assert.equal(result.cuts[1].gapFrames, 4);
	assert.ok(result.cuts[2].unjudged);
	assert.equal(result.issueCount, 1);
});

const BLOCKINGS = {
	facing: dialogue,
	"side by side": [{ id: "a", subject: "Mara", x: 0, z: 0, rot: 0 }, { id: "b", subject: "Joon", x: 3, z: 0, rot: 0 }],
	diagonal: [{ id: "a", subject: "Mara", x: -1, z: 1, rot: 135 }, { id: "b", subject: "Joon", x: 2, z: -2, rot: -45 }],
	"three-quarter": [{ id: "a", subject: "Mara", x: 0, z: 0, rot: 60 }, { id: "b", subject: "Joon", x: 3, z: 1.5, rot: 250 }],
};
check("zero false flags: every A1 pattern over four blockings and two ranges cuts clean", () => {
	const rows = [];
	for (const [label, people] of Object.entries(BLOCKINGS)) {
		const cast = people.map((row) => ({ id: row.id, name: row.subject, x: row.x, z: row.z, rot: row.rot, height: 1.8 }));
		for (const pattern of COVERAGE_PATTERNS) for (const range of [{ startFrame: 0, endFrame: 191 }, { startFrame: 40, endFrame: 400 }]) {
			const plan = planCoverage(pattern.id, { cast, subjects: ["a", "b"], range, filmback });
			const result = checkCuts(plan.shots.map((row) => plannedShot(row, filmback)), scene(people));
			assert.equal(result.issueCount, 0, `${label} ${pattern.id}: ${JSON.stringify(result.cuts.flatMap((cut) => cut.issues.map((issue) => issue.message)))}`);
			assert.ok(result.cuts.every((cut) => !cut.unjudged), `${label} ${pattern.id}: every cut judged`);
			rows.push(`${label}/${pattern.id}:${result.cuts.length}`);
		}
	}
	console.log(`  ${rows.length} plans, ${rows.reduce((sum, row) => sum + Number(row.split(":")[1]), 0)} cuts, 0 flags`);
});

console.log(`\n${passed} checks passed`);
