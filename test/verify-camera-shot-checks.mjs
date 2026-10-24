#!/usr/bin/env node
// depth-staging A1/A2: camera.checkShots' pure check (src/camera-depth/shot-checks.js)
// over constructed good and bad cases per rule, measured independently where it
// can be: the occluded frames from a 2D sight-line test of a round pillar, the
// crop from the lens height and field of view. Each fix is applied
// (movedCamera, what camera.fixShot does) and the shot checks clean after it.
// Zero false flags: every coverage and group pattern over the cut-rule
// blockings in an empty set (one true block named: see findings F-1).
import assert from "node:assert/strict";
import { createSceneObject } from "../src/scene-objects.js";
import { createCharacterEntry } from "../src/scenes.js";
import { createShot } from "../src/cuts.js";
import { checkShot, checkShots, sampleFrames, JOINTS } from "../src/camera-depth/shot-checks.js";
import { movedCamera } from "../src/camera-depth/fixes.js";
import { shotGeometryFacts } from "../src/studio-geometry-facts.js";
import { shotCameraAt } from "../src/camera-coverage/cut-geometry.js";
import { planCoverage, plannedShot } from "../src/camera-coverage/plan.js";
import { planAnyCoverage } from "../src/camera-coverage/plan-group.js";
import { COVERAGE_PATTERNS } from "../src/camera-coverage/patterns.js";

const filmback = { sensorId: "fullFrame", aspectRatio: 16 / 9 };
let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log(`ok - ${label}`); };
const look = (pos, at, fovDeg = 30) => ({ pos, yaw: Math.atan2(-(at.x - pos.x), -(at.z - pos.z)), pitch: Math.atan2(at.y - pos.y, Math.hypot(at.x - pos.x, at.z - pos.z)), fovDeg });
const mara = createCharacterEntry({ id: "mara", subject: "Mara", x: 0, z: 0, rot: 0 }), joon = createCharacterEntry({ id: "joon", subject: "Joon", x: 3, z: 0, rot: -90 });
const EYE = { x: 0, y: 0.93 * 1.8, z: 0.09 };
const prop = (kind, fields) => ({ ...createSceneObject(kind), ...fields });
const pillarAt = (x, z) => prop("cylinder", { id: "pillar", name: "Pillar", x, z, scaleX: 0.4, scaleY: 3, scaleZ: 0.4, footprint: { width: 1, depth: 1 }, height: 1 });
const held = (keys, start = 0, end = 95) => ({ ...createShot("Hero", start, end, keys.map((framing, i) => ({ id: `k${i}`, frame: i ? end : start, framing }))), id: "hero", subjectIds: ["mara"] });
const scene = (objects = [], cast = [mara, joon]) => ({ cast, objects, filmback });
const rules = (report) => report.issues.map((issue) => issue.rule);
/** Apply a fix the way camera.fixShot does: every key moved by the delta and re-aimed. */
const fixed = (shot, fix) => ({ ...shot, cameraKeys: shot.cameraKeys.map((key) => ({ ...key, framing: movedCamera(key.framing, fix.delta, EYE, filmback.aspectRatio) })) });

check("sampling: the first and last frame plus every k frames, k from the length (D2)", () => {
	assert.deepEqual(sampleFrames({ startFrame: 0, endFrame: 95 }), [0, 12, 24, 36, 48, 60, 72, 84, 95]);
	assert.deepEqual(sampleFrames({ startFrame: 10, endFrame: 13 }), [10, 11, 12, 13]);
	assert.equal(sampleFrames({ startFrame: 0, endFrame: 959 }).length, 81, "k is capped at 12");
});

check("a shot that names no subject keeps the one it reads: the fix for a wall across a two-shot does not hand it to the other person", () => {
	const left = createCharacterEntry({ id: "mara", subject: "Mara", x: -1.2, z: 0, rot: 90 }), right = createCharacterEntry({ id: "sela", subject: "Sela", x: 1.2, z: 0, rot: -90 });
	const wall = prop("cube", { id: "wall", name: "Wall", x: 0, z: 3, scaleX: 1.4, scaleY: 3, scaleZ: 0.4 }), two = { cast: [left, right], objects: [wall], filmback };
	const shot = { ...held([{ pos: { x: 0, y: 1.6, z: 6 }, yaw: 0, pitch: -0.05, fovDeg: 40 }]), subjectIds: [] };
	const bad = checkShot(shot, two);
	assert.deepEqual([bad.subjectId, rules(bad)], ["mara", ["occluded"]], JSON.stringify(bad.issues));
	const after = checkShot(fixed(shot, bad.issues[0].fix), two);
	assert.deepEqual([after.subjectId, rules(after)], ["mara", []], `${bad.issues[0].fix.text}: ${JSON.stringify(after.issues.map((row) => row.message))}`);
});

check("occluded: a pillar between a held camera and Mara's eyes is flagged on every frame; aside, it is not; the fix clears it", () => {
	const shot = held([look({ x: 0, y: 1.6, z: 5 }, EYE)]);
	const bad = checkShot(shot, scene([pillarAt(0, 2.5)]));
	assert.deepEqual(rules(bad), ["occluded"], JSON.stringify(bad.issues));
	const [issue] = bad.issues;
	assert.equal(issue.severity, "high");
	assert.deepEqual(issue.frames, sampleFrames(shot));
	assert.deepEqual(issue.by, ["pillar"]);
	assert.match(issue.message, /Pillar hides Mara's eyes from the lens on 9 of 9 sampled frames/);
	assert.ok(["slide-left", "slide-right", "raise", "lower"].includes(issue.fix.kind) && issue.fix.metres > 0 && issue.fix.metres <= 1, JSON.stringify(issue.fix));
	assert.match(issue.fix.text, /^(slide the camera [\d.]+ m (left|right)|raise the camera [\d.]+ m|lower the camera [\d.]+ m)$/);
	assert.deepEqual(rules(checkShot(fixed(shot, issue.fix), scene([pillarAt(0, 2.5)]))), [], "after the fix nothing hides her");
	assert.deepEqual(rules(checkShot(shot, scene([pillarAt(2, 2.5)]))), [], "a pillar off the sight line is fine");
	// The agent's geometry facts read the same pillar between that camera and her (studio-geometry-facts occludersOf).
	const facts = shotGeometryFacts({ frame: 0, camera: null, characters: [mara], objects: [pillarAt(0, 2.5)], shotDocument: { shots: [shot] } }, { ports: { bounds: ({ entity }) => ({ min: { x: entity.x - 0.25, y: 0, z: entity.z - 0.15 }, max: { x: entity.x + 0.25, y: 1.8, z: entity.z + 0.15 } }) } });
	assert.deepEqual(facts.shots[0].occluders.map((row) => row.byObjectId), ["pillar"]);
});

check("occluded during a move: a truck past a screen is flagged on the frames the sight line crosses it (measured in 2D)", () => {
	const shot = held([look({ x: -3, y: 1.6, z: 5 }, EYE), look({ x: 3, y: 1.6, z: 5 }, EYE)]);
	const screen = prop("cube", { id: "screen", name: "Screen", x: 0, z: 2.5, scaleX: 2, scaleY: 2, scaleZ: 0.04 });
	const report = checkShot(shot, scene([screen]));
	// A 2 m wide panel at z 2.5: blocked where the sight line from the lens to the eyes crosses either face within 1 m of its middle.
	const expected = sampleFrames(shot).filter((frame) => {
		const pos = shotCameraAt(shot, frame, { cast: [mara], filmback }).pos;
		return [2.48, 2.52].some((z) => Math.abs(pos.x + (EYE.x - pos.x) * ((pos.z - z) / (pos.z - EYE.z))) <= 1);
	});
	const issue = report.issues.find((row) => row.rule === "occluded");
	assert.ok(expected.length >= 3 && issue, JSON.stringify({ expected, issues: report.issues }));
	assert.deepEqual(issue.frames, expected, "the crossing frames, and only those");
	assert.equal(issue.severity, "medium", "clear on the held frames, blocked on part of the move");
	assert.ok(!expected.includes(0) && !expected.includes(95));
	assert.deepEqual(rules(checkShot(fixed(shot, issue.fix), scene([screen]))), [], `the fix (${issue.fix.text}) clears the whole move`);
});

check("occluded by a person; a prop she holds, a hidden prop and the floor do not count", () => {
	const shot = held([look({ x: 0, y: 1.6, z: 5 }, EYE)]);
	const between = createCharacterEntry({ id: "joon", subject: "Joon", x: 0, z: 2.5, rot: 0 });
	const report = checkShot(shot, scene([], [mara, between]));
	assert.deepEqual(report.issues.map((row) => [row.rule, row.by]), [["occluded", ["joon"]]]);
	const cup = prop("cube", { id: "cup", name: "Cup", x: 0, y: 1.5, z: 2.5, scaleX: 0.5, scaleY: 0.5, scaleZ: 0.5, attach: { characterId: "mara", bone: "rightHand" } });
	const hidden = { ...pillarAt(0, 2.5), id: "hidden-pillar", hidden: true }, floor = prop("plane", { id: "floor", name: "Floor", scaleX: 10, scaleZ: 10 });
	assert.deepEqual(rules(checkShot(shot, scene([hidden, floor], [mara]))), []);
	assert.ok(!checkShot(shot, { ...scene([cup], [mara]), bounds: () => ({ min: { x: -0.2, y: 1.3, z: 2.3 }, max: { x: 0.2, y: 1.8, z: 2.7 } }) }).issues.length, "a carried prop rides with her");
});

check("inside: the lens in a wall is high, within the near clip is medium, half a metre off is clean; a room around both is the set", () => {
	const shot = held([look({ x: 0, y: 1.6, z: 5 }, EYE)]);
	const wall = (z, depth = 0.2) => prop("cube", { id: "wall", name: "Wall", x: 0, z, scaleX: 6, scaleY: 3, scaleZ: depth });
	const inWall = checkShot(shot, scene([wall(5)], [mara])).issues.find((row) => row.rule === "inside");
	assert.ok(inWall && inWall.severity === "high" && /inside Wall/.test(inWall.message), JSON.stringify(inWall));
	assert.ok(["slide-left", "slide-right", "raise", "lower"].includes(inWall.fix.kind) || inWall.fix.kind === "reframe", JSON.stringify(inWall.fix));
	const near = checkShot(shot, scene([wall(5.13)], [mara])).issues.find((row) => row.rule === "inside");
	assert.ok(near && near.severity === "medium" && /within 10 cm of Wall/.test(near.message), JSON.stringify(near));
	assert.deepEqual(rules(checkShot(fixed(shot, near.fix), scene([wall(5.13)], [mara]))), [], `the fix (${near.fix.text}) clears it`);
	assert.deepEqual(rules(checkShot(shot, scene([wall(5.6)], [mara]))), []);
	const room = prop("cube", { id: "room", name: "Room", x: 0, z: 2, scaleX: 12, scaleY: 4, scaleZ: 12 });
	assert.deepEqual(rules(checkShot(shot, scene([room], [mara]))), [], "an enclosure around the camera and the subject");
});

check("crop: a bottom edge at the knee is flagged with a one-step size fix; the same shot a size tighter is clean", () => {
	// A level camera 3 m from her axis: the bottom edge meets it at 1.6 - 3 tan(fov/2).
	const fovAt = (share) => (2 * Math.atan((1.6 - share * 1.8) / 3) * 180) / Math.PI;
	const shot = held([{ pos: { x: 0, y: 1.6, z: 3 }, yaw: 0, pitch: 0, fovDeg: fovAt(JOINTS.knee) }]);
	const report = checkShot(shot, scene([], [mara]));
	assert.deepEqual(report.issues.map((row) => [row.rule, row.joint, row.edge]), [["crop", "knee", "bottom"]], JSON.stringify(report.issues));
	const { fix } = report.issues[0];
	assert.ok(["size-tighter", "size-wider"].includes(fix.kind) && fix.size && /one size (tighter|wider)/.test(fix.text), JSON.stringify(fix));
	assert.deepEqual(rules(checkShot(fixed(shot, fix), scene([], [mara]))), [], `after ${fix.text}`);
	assert.deepEqual(rules(checkShot(held([{ pos: { x: 0, y: 1.6, z: 3 }, yaw: 0, pitch: 0, fovDeg: fovAt(0.44) }]), scene([], [mara]))), [], "an edge between the knee and the waist");
	for (const joint of ["ankle", "waist"]) assert.deepEqual(checkShot(held([{ pos: { x: 0, y: 1.6, z: 3 }, yaw: 0, pitch: 0, fovDeg: fovAt(JOINTS[joint]) }]), scene([], [mara])).issues.map((row) => row.joint), [joint]);
});

const dialogue = [{ id: "a", subject: "Mara", x: 0, z: 0, rot: 90 }, { id: "b", subject: "Joon", x: 4, z: 0, rot: -90 }];
const BLOCKINGS = { facing: dialogue, "side by side": [{ id: "a", subject: "Mara", x: 0, z: 0, rot: 0 }, { id: "b", subject: "Joon", x: 3, z: 0, rot: 0 }],
	diagonal: [{ id: "a", subject: "Mara", x: -1, z: 1, rot: 135 }, { id: "b", subject: "Joon", x: 2, z: -2, rot: -45 }], "three-quarter": [{ id: "a", subject: "Mara", x: 0, z: 0, rot: 60 }, { id: "b", subject: "Joon", x: 3, z: 1.5, rot: 250 }] };
const round = (rows) => { const c = { x: rows.reduce((s, r) => s + r.x, 0) / rows.length, z: rows.reduce((s, r) => s + r.z, 0) / rows.length }; return rows.map((r) => ({ height: 1.8, ...r, rot: r.rot ?? (Math.atan2(c.x - r.x, c.z - r.z) * 180) / Math.PI })); };
const GROUPS = { equilateral: round([{ id: "a", name: "Mara", x: 0, z: 0 }, { id: "b", name: "Joon", x: 4, z: 0 }, { id: "c", name: "Sela", x: 2, z: 3.4 }]),
	scalene: round([{ id: "a", name: "Mara", x: 0, z: 0 }, { id: "b", name: "Joon", x: 5, z: 1 }, { id: "c", name: "Sela", x: 1.5, z: 2.5 }]),
	tight: round([{ id: "a", name: "Mara", x: 0, z: 0 }, { id: "b", name: "Joon", x: 1.6, z: 0 }, { id: "c", name: "Sela", x: 0.8, z: 1.4 }]),
	square: round([{ id: "a", name: "A", x: 0, z: 0 }, { id: "b", name: "B", x: 3, z: 0 }, { id: "c", name: "C", x: 3, z: 3 }, { id: "d", name: "D", x: 0, z: 3 }]) };

check("zero false flags (A2): every coverage and group pattern over the cut-rule blockings, in an empty set", () => {
	let shots = 0;
	const trueBlocks = [];
	for (const [label, people] of Object.entries(BLOCKINGS)) for (const pattern of COVERAGE_PATTERNS) for (const range of [{ startFrame: 0, endFrame: 191 }, { startFrame: 40, endFrame: 400 }]) {
		const cast = people.map((row) => ({ id: row.id, name: row.subject, x: row.x, z: row.z, rot: row.rot, height: 1.8 }));
		const report = checkShots(planCoverage(pattern.id, { cast, subjects: ["a", "b"], range, filmback }).shots.map((row) => plannedShot(row, filmback)), { cast: people, objects: [], filmback });
		shots += report.shots.length;
		for (const row of report.shots) for (const issue of row.issues) {
			// F-1: a head-on leading single pulled back through the partner who stands in front of her (walk-and-talk staged face to face) is a true block.
			if (pattern.id === "walk-and-talk" && /Leading single/.test(row.name) && issue.rule === "occluded" && issue.by.join() === "b" && ["facing", "diagonal"].includes(label)) { trueBlocks.push(`${label}/${row.startFrame}`); continue; }
			assert.fail(`${label} ${pattern.id} ${row.name}: ${issue.message}`);
		}
	}
	for (const [label, people] of Object.entries(GROUPS)) for (const pattern of ["triangle-dialogue", "group-singles", "branching-dialogue"]) for (const range of [{ startFrame: 0, endFrame: 311 }, { startFrame: 40, endFrame: 600 }]) {
		if (pattern === "triangle-dialogue" && people.length !== 3) continue;
		const plan = planAnyCoverage(pattern, { cast: people, subjects: people.map((row) => row.id), range, filmback, branches: 3 });
		const report = checkShots(plan.shots.map((row) => plannedShot(row, filmback)), { cast: people.map((row) => ({ ...row, subject: row.name })), objects: [], filmback });
		shots += report.shots.length;
		assert.equal(report.issueCount, 0, `${label} ${pattern}: ${JSON.stringify(report.shots.flatMap((row) => row.issues.map((issue) => `${row.name}: ${issue.message}`)))}`);
	}
	assert.deepEqual(trueBlocks, ["facing/96", "facing/221", "diagonal/96", "diagonal/221"]);
	console.log(`  ${shots} pattern shots, 0 false flags; ${trueBlocks.length} true blocks (F-1)`);
});

check("a pillar placed between a pattern's camera and its subject is flagged with the frames, the rule kept with rule: occluded", () => {
	const cast = dialogue.map((row) => ({ id: row.id, name: row.subject, x: row.x, z: row.z, rot: row.rot, height: 1.8 }));
	const shots = planCoverage("shot-reverse-shot", { cast, subjects: ["a", "b"], range: { startFrame: 0, endFrame: 191 }, filmback }).shots.map((row) => plannedShot(row, filmback));
	const target = shots[0], camera = shotCameraAt(target, target.startFrame, { cast: dialogue, filmback }).pos, subject = dialogue.find((row) => row.id === target.coverage.subjectId);
	const between = pillarAt((camera.x + subject.x) / 2, (camera.z + subject.z) / 2);
	const report = checkShots(shots, { cast: dialogue, objects: [between], filmback }, { rule: "occluded" });
	const flagged = report.shots.find((row) => row.shotId === target.id);
	assert.deepEqual(flagged.issues.map((row) => [row.rule, row.frames]), [["occluded", sampleFrames(target)]]);
	assert.ok(report.shots.every((row) => row.issues.every((issue) => issue.rule === "occluded")));
});

console.log(`\n${passed} checks passed (depth-staging A1/A2 shot checks)`);
