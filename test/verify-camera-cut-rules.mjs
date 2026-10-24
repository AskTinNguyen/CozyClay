// A3: the editing-rule checks (src/camera-coverage/cut-rules.js) on cuts built
// by hand: for every rule a good cut that passes and a bad one that is flagged
// with its severity, frames and a suggested fix; then zero false flags on
// every A1 coverage pattern planned over four different blockings. Then the
// group-coverage A1 cases: three people in range, the pair each cut is about
// (an authored line, the subjects, whom the subject looks at, or "cannot
// tell"), and a legal line change through a neutral or an in-shot move. Pure.
import assert from "node:assert/strict";
import { checkCut, checkCuts } from "../src/camera-coverage/cut-rules.js";
import { castAt } from "../src/camera-coverage/cut-geometry.js";
import { planCoverage, plannedShot } from "../src/camera-coverage/plan.js";
import { planAnyCoverage } from "../src/camera-coverage/plan-group.js";
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

// group-coverage A1: three people in range. Mara faces Joon 4 m along +x; Sela stands 3.6 m off, nearer Mara than Joon is.
const trio = [{ id: "a", subject: "Mara", x: 0, z: 0, rot: 90 }, { id: "b", subject: "Joon", x: 4, z: 0, rot: -90 }, { id: "c", subject: "Sela", x: 2, z: 3, rot: 180 }];
const lined = (row, between) => ({ ...row, line: { between } });
const moving = (id, startFrame, endFrame, from, to, at) => ({ ...shot(id, startFrame, endFrame, look(from, at)), cameraKeys: [{ id: `${id}-k0`, frame: startFrame, framing: look(from, at) }, { id: `${id}-k1`, frame: endFrame, framing: look(to, at) }] });

check("three people: the line is the pair the shots are about, never the nearest person; every line issue names its pair", () => {
	// Two shots of Mara, both below the Mara-Joon line (z < 0) but on either side of the Mara-Sela line: she looks at Joon, so that is the line.
	const a = shot("A", 0, 47, look({ x: 1.5, y: 1.6, z: -2.5 }, face(trio[0])), "a"), b = shot("B", 48, 95, look({ x: -2.4, y: 1.6, z: -0.6 }, face(trio[0])), "a");
	const held = checkCut(a, b, scene(trio));
	assert.ok(!rules(held).includes("line"), JSON.stringify(held.measures));
	assert.deepEqual([held.measures.line.label, held.measures.line.source, held.measures.line.pair], ["Mara–Joon", "gaze", ["a", "b"]], "the pair from whom Mara looks at");
	const crossed = checkCut(a, shot("B", 48, 95, look({ x: 1.5, y: 1.6, z: 2.5 }, face(trio[1])), "b"), scene(trio));
	assert.ok(rules(crossed).includes("line"), "crossing Mara-Joon is flagged (its eyelines flip with it)");
	assert.match(crossed.issues[0].message, /crosses the Mara–Joon line/);
	assert.deepEqual(crossed.issues[0].pair, ["a", "b"], "the issue names its pair");
	// An authored line wins over the subjects: Mara to Sela, judged on the Mara-Joon line the shots keep.
	const toSela = checkCut(lined(a, ["a", "b"]), lined(shot("B", 48, 95, look({ x: 3, y: 1.6, z: 5.5 }, face(trio[2])), "c"), ["a", "b"]), scene(trio));
	assert.deepEqual([toSela.measures.line.label, toSela.measures.line.source], ["Mara–Joon", "authored"]);
	assert.deepEqual(rules(toSela), ["line"], "the camera on Sela sits across the authored Mara-Joon line");
	assert.deepEqual(toSela.issues[0].pair, ["a", "b"]);
});

check("three people: when the pair cannot be told the report says so instead of guessing; two authored pairs are a line change", () => {
	// Mara turned to face between Joon and Sela: two shots of her alone, no line authored.
	const torn = [{ ...trio[0], rot: 58 }, trio[1], { ...trio[2], x: 2.2, z: 3.4 }];
	const a = shot("A", 0, 47, look({ x: 2.5, y: 1.6, z: -2.5 }, face(torn[0])), "a"), b = shot("B", 48, 95, look({ x: -1.5, y: 1.6, z: 3 }, face(torn[0])), "a");
	const unclear = checkCut(a, b, scene(torn));
	assert.equal(unclear.measures.line.pair, null);
	assert.match(unclear.measures.line.unclear, /Mara looks between (Joon and Sela|Sela and Joon); name the line with camera\.setLine/);
	assert.ok(!rules(unclear).includes("line"), "no guessed crossing");
	assert.equal(checkCut(lined(a, ["a", "b"]), lined(b, ["a", "b"]), scene(torn)).issues.filter((issue) => issue.rule === "line").length, 1, "named, the line is judged");
	const change = checkCut(lined(a, ["a", "b"]), lined(shot("B", 48, 95, look({ x: 4.5, y: 1.6, z: 4 }, face(trio[2])), "c"), ["b", "c"]), scene(trio));
	assert.deepEqual(change.measures.line, { pair: null, change: ["Mara–Joon", "Joon–Sela"] });
	assert.ok(!rules(change).includes("line") && !rules(change).includes("eyeline"), "a line change is not a crossing");
});

check("three people, D2: a line change through a neutral shot or through an in-shot move is legal; the same cut straight across is flagged", () => {
	const left = lined(shot("S1", 0, 47, look({ x: 1.6, y: 1.6, z: 3.2 }, face(trio[0])), "a"), ["a", "b"]);
	const right = (start) => lined(shot("S3", start, start + 47, look({ x: 2.4, y: 1.6, z: -3.2 }, face(trio[1])), "b"), ["a", "b"]);
	assert.ok(rules(checkCuts([left, right(48)], scene(trio)).cuts[0]).includes("line"), "straight across: flagged");
	// A neutral on the Mara-Joon line (behind Joon, looking down the line at Mara).
	const neutral = lined(shot("S2", 48, 95, look({ x: 7, y: 1.6, z: 0.05 }, face(trio[0])), "a"), ["a", "b"]);
	const through = checkCuts([left, neutral, right(96)], scene(trio));
	assert.equal(through.issueCount, 0, JSON.stringify(through.cuts.map((cut) => cut.measures)));
	// A camera that moves across the line inside the shot: it starts on S1's side and ends on S3's.
	const dolly = lined(moving("S2", 48, 95, { x: -1.5, y: 1.6, z: 3 }, { x: -1.5, y: 1.6, z: -3 }, face(trio[0])), ["a", "b"]);
	dolly.coverage = { pattern: "test", index: 0, role: "", subjectId: "a" };
	const moved = checkCuts([left, dolly, right(96)], scene(trio));
	assert.equal(moved.issueCount, 0, JSON.stringify(moved.cuts.map((cut) => [cut.measures, cut.issues.map((issue) => issue.message)])));
	assert.ok(moved.cuts.every((cut) => cut.measures.line.pair.join() === "a,b"), "both cuts judged on the Mara-Joon line");
});

const round = (rows) => { const c = { x: rows.reduce((s, r) => s + r.x, 0) / rows.length, z: rows.reduce((s, r) => s + r.z, 0) / rows.length }; return rows.map((r) => ({ height: 1.8, ...r, rot: r.rot ?? (Math.atan2(c.x - r.x, c.z - r.z) * 180) / Math.PI })); };
const GROUPS = {
	equilateral: round([{ id: "a", name: "Mara", x: 0, z: 0 }, { id: "b", name: "Joon", x: 4, z: 0 }, { id: "c", name: "Sela", x: 2, z: 3.4 }]),
	scalene: round([{ id: "a", name: "Mara", x: 0, z: 0 }, { id: "b", name: "Joon", x: 5, z: 1 }, { id: "c", name: "Sela", x: 1.5, z: 2.5 }]),
	tight: round([{ id: "a", name: "Mara", x: 0, z: 0 }, { id: "b", name: "Joon", x: 1.6, z: 0 }, { id: "c", name: "Sela", x: 0.8, z: 1.4 }]),
	"two face off, one watches": trio.map((row) => ({ ...row, name: row.subject, height: 1.8 })),
	square: round([{ id: "a", name: "A", x: 0, z: 0 }, { id: "b", name: "B", x: 3, z: 0 }, { id: "c", name: "C", x: 3, z: 3 }, { id: "d", name: "D", x: 0, z: 3 }]),
};
check("zero false flags: the group patterns over five blockings and two ranges cut clean, the authored lines judged", () => {
	let plans = 0, cuts = 0;
	for (const [label, people] of Object.entries(GROUPS)) for (const pattern of ["triangle-dialogue", "group-singles", "branching-dialogue"]) for (const range of [{ startFrame: 0, endFrame: 311 }, { startFrame: 40, endFrame: 600 }]) {
		if (pattern === "triangle-dialogue" && people.length !== 3) continue;
		const plan = planAnyCoverage(pattern, { cast: people, subjects: people.map((row) => row.id), range, filmback, branches: 3 });
		const result = checkCuts(plan.shots.map((row) => ({ ...plannedShot(row, filmback), ...(row.line ? { line: { between: row.line } } : {}) })), scene(people));
		assert.equal(result.issueCount, 0, `${label} ${pattern}: ${JSON.stringify(result.cuts.flatMap((cut) => cut.issues.map((issue) => issue.message)))}`);
		assert.deepEqual(plan.notes, [], `${label} ${pattern}: every shot kept its pair's side`);
		plans += 1; cuts += result.cuts.length;
	}
	console.log(`  ${plans} group plans, ${cuts} cuts, 0 flags`);
});

console.log(`\n${passed} checks passed`);
