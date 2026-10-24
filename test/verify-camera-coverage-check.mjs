// group-coverage A3: is there enough here to edit? checkCoverage
// (src/camera-coverage/completeness.js) on complete fixtures (the triangle,
// group singles and branching plans, and master and coverage for two) and on
// gapped ones: no master, one size only, a line change with nothing to cut
// through, a pair seen from both sides, a branch missing a setup or with a
// moved camera. Every gap carries a suggested shot as a technique stack. Then
// camera.checkCoverage through the real App wiring: read only, request words.
import assert from "node:assert/strict";
import { checkCoverage } from "../src/camera-coverage/completeness.js";
import { planAnyCoverage } from "../src/camera-coverage/plan-group.js";
import { plannedShot } from "../src/camera-coverage/plan.js";
import { techniqueById } from "../src/camera-techniques/index.js";
import { shotsFixture, framing } from "./bus/shots-fixture.mjs";
import { createShot } from "../src/cuts.js";
import { createCharacterEntry } from "../src/scenes.js";

const filmback = { sensorId: "fullFrame", aspectRatio: 16 / 9 };
let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log(`ok - ${label}`); };
const facingIn = (rows) => { const c = { x: rows.reduce((s, r) => s + r.x, 0) / rows.length, z: rows.reduce((s, r) => s + r.z, 0) / rows.length }; return rows.map((r) => ({ height: 1.8, ...r, rot: r.rot ?? (Math.atan2(c.x - r.x, c.z - r.z) * 180) / Math.PI })); };
const TRIO = facingIn([{ id: "a", name: "Mara", x: 0, z: 0 }, { id: "b", name: "Joon", x: 4, z: 0 }, { id: "c", name: "Sela", x: 2, z: 3.4 }]);
const DUO = [{ id: "a", name: "Mara", x: 0, z: 0, rot: 90, height: 1.8 }, { id: "b", name: "Joon", x: 4, z: 0, rot: -90, height: 1.8 }];
const scene = (cast) => ({ cast, filmback });
/** A plan as the document holds it: keys, coverage record, authored line and stack. */
function laid(pattern, cast, extra = {}) {
	const plan = planAnyCoverage(pattern, { cast, subjects: cast.map((row) => row.id), range: { startFrame: 0, endFrame: 359 }, filmback, ...extra });
	return plan.shots.map((row) => ({ ...plannedShot(row, filmback), id: `s${row.index + 1}`, technique: { stack: row.stack },
		coverage: { pattern, index: row.index, role: row.role, subjectId: row.subjectId, ...(row.setup ? { setup: row.setup, branch: row.branch } : {}) }, ...(row.line ? { line: { between: row.line } } : {}) }));
}
const kinds = (report) => report.gaps.map((gap) => gap.kind);
/** Every gap carries a suggested shot whose stack is real techniques. */
function suggestions(report) {
	for (const gap of report.gaps) {
		assert.ok(gap.suggest?.stack?.length, `${gap.kind}: a suggested stack`);
		for (const item of gap.suggest.stack) assert.ok(techniqueById(item.id), `${gap.kind}: ${item.id} is a technique`);
		assert.ok(gap.message.length > 20 && gap.suggest.text, gap.kind);
	}
}

check("complete: the triangle, group singles, branching and master-and-coverage plans have no gap", () => {
	for (const [pattern, cast, extra] of [["triangle-dialogue", TRIO], ["group-singles", TRIO], ["branching-dialogue", TRIO, { branches: 3 }], ["branching-dialogue", DUO, { branches: 2 }], ["master-coverage", DUO]]) {
		const report = checkCoverage(laid(pattern, cast, extra), scene(cast));
		assert.equal(report.complete, true, `${pattern} (${cast.length}): ${report.gaps.map((gap) => gap.message).join(" | ")}`);
		assert.ok(report.checks.master && report.checks.sizes && report.checks.lineChanges);
		assert.ok(Object.values(report.measures.sizes).every((sizes) => sizes.length >= 2), `${pattern}: two sizes each`);
		if (pattern === "triangle-dialogue") assert.ok(report.measures.lineChanges.length >= 2 && report.measures.lineChanges.every((row) => row.kind === "pair" && row.bridge === "s1"), "the triangle's line changes are bridged by its master");
		if (pattern === "branching-dialogue") assert.equal(report.checks.branches, true, "every branch has the same setups");
		console.log(`  ${pattern} x${cast.length}: ${report.shots} shots, master ${report.measures.master}, sizes ${Object.values(report.measures.sizes).map((row) => row.length).join("/")}, ${report.measures.lineChanges.length} line changes, branches ${report.measures.branches.length}`);
	}
});

check("gapped: shot-reverse-shot alone has no master and one size each; the suggestions are a master and a wide", () => {
	const report = checkCoverage(laid("shot-reverse-shot", DUO), scene(DUO));
	assert.equal(report.complete, false);
	assert.deepEqual(kinds(report), ["master", "sizes", "sizes"]);
	assert.deepEqual(report.gaps[0].suggest.stack, [{ id: "master-shot" }]);
	assert.deepEqual(report.gaps.slice(1).map((gap) => [gap.subjectId, gap.suggest.stack[0].id]), [["a", "wide-shot"], ["b", "wide-shot"]]);
	assert.match(report.gaps[1].message, /Mara is covered at one size only \(medium close-up\)/);
	suggestions(report);
});

check("gapped: a triangle without its master leaves the line changes with nothing to cut through", () => {
	const report = checkCoverage(laid("triangle-dialogue", TRIO).slice(1), scene(TRIO));
	assert.ok(kinds(report).includes("master") && kinds(report).includes("line-change"), kinds(report).join());
	const change = report.gaps.find((gap) => gap.kind === "line-change");
	assert.match(change.message, /The line changes from .+ to .+ at \d+ with no neutral, cutaway or group shot/);
	assert.deepEqual(change.suggest.stack, [{ id: "three-shot" }]);
	// A cutaway anywhere in the coverage is something to cut through.
	const withInsert = [...laid("triangle-dialogue", TRIO).slice(1), { ...plannedShot({ index: 20, name: "Insert", subjectId: "a", startFrame: 360, endFrame: 380, plan: { keys: [{ frame: 360, framing: { position: { x: 9, y: 0.4, z: 9 }, lookAt: { x: 12, y: 0.2, z: 12 }, focalMm: 50 } }] } }, filmback), id: "ins", technique: { stack: [{ id: "insert-shot" }] }, coverage: null }];
	const bridged = checkCoverage(withInsert, scene(TRIO));
	assert.ok(!kinds(bridged).includes("line-change"), `a cutaway bridges the line changes: ${bridged.gaps.map((gap) => gap.message).join(" | ")}`);
	suggestions(report);
});

check("gapped: a pair seen from both sides with no neutral between; a neutral on the line clears it", () => {
	const shots = laid("master-coverage", DUO), flipped = shots.map((row, i) => (i === 3 ? { ...row, cameraKeys: row.cameraKeys.map((key) => ({ ...key, framing: { ...key.framing, yaw: Math.PI - key.framing.yaw, pos: { ...key.framing.pos, z: -key.framing.pos.z } } })) } : row));
	const report = checkCoverage(flipped, scene(DUO));
	assert.deepEqual(kinds(report), ["line-change", "line-change"], "over the line into the flipped close-up, and back");
	assert.match(report.gaps[0].message, /sees the Mara–Joon line from its other side/);
	assert.deepEqual(report.gaps[0].suggest.stack.map((item) => item.id), ["medium-shot", "head-on-shot"]);
	const neutral = { ...plannedShot({ index: 9, name: "Neutral", subjectId: "a", startFrame: 400, endFrame: 440, plan: { keys: [{ frame: 400, framing: { position: { x: 7, y: 1.6, z: 0.05 }, lookAt: { x: 0, y: 1.5, z: 0 }, focalMm: 40 } }] } }, filmback), id: "neutral" };
	assert.ok(!kinds(checkCoverage([...flipped, neutral], scene(DUO))).includes("line-change"), "a neutral on the line clears it");
	suggestions(report);
});

check("gapped: a branch missing a setup, and a branch whose setup camera moved", () => {
	const shots = laid("branching-dialogue", DUO, { branches: 3 });
	const missing = checkCoverage(shots.filter((row) => !(row.coverage.branch === 2 && row.coverage.setup === "single-2")), scene(DUO));
	assert.deepEqual(kinds(missing), ["branch"]);
	assert.match(missing.gaps[0].message, /^Branch 3 \(\d+-\d+\) has no Single on Joon setup/);
	assert.deepEqual([missing.gaps[0].suggest.subjectId, missing.gaps[0].suggest.stack.map((item) => item.id)], ["b", ["medium-close-up"]]);
	const moved = checkCoverage(shots.map((row) => (row.coverage.branch === 1 && row.coverage.setup === "single-1" ? { ...row, cameraKeys: row.cameraKeys.map((key) => ({ ...key, framing: { ...key.framing, pos: { ...key.framing.pos, x: key.framing.pos.x + 0.6 } } })) } : row)), scene(DUO));
	assert.ok(moved.gaps.some((gap) => gap.kind === "branch" && /Branch 2's Single on Mara is not the same setup/.test(gap.message)), moved.gaps.map((gap) => gap.message).join(" | "));
	// Branch ranges named by hand read the same setups.
	const named = checkCoverage(shots, scene(DUO), { branches: [0, 1, 2].map((n) => ({ startFrame: shots.find((row) => row.coverage.branch === n).startFrame, endFrame: shots.filter((row) => row.coverage.branch === n).at(-1).endFrame })) });
	assert.equal(named.checks.branches, true);
	suggestions(missing);
});

check("camera.checkCoverage through the bus: read only, from words, a cast and a range", () => {
	const characters = [createCharacterEntry({ id: "actor-a", model: "y-bot-tpose", x: 0, z: 0, rot: 90, subject: "Mara" }), createCharacterEntry({ id: "actor-b", model: "y-bot-tpose", x: 4, z: 0, rot: -90, subject: "Joon" })];
	const f = shotsFixture({ characters });
	try {
		f.shots.load({ shots: [{ ...createShot("Scene", 0, 191, [{ id: "key-a", frame: 0, framing }]), id: "shot-a" }], frameCount: 240, camera: f.actual.readStudioState().camera });
		assert.equal(f.run("camera.cover", { pattern: "shot-reverse-shot", cast: ["actor-a", "actor-b"], shotId: "shot-a" }, "agent").ok, true);
		const asked = f.run("camera.checkCoverage", { request: "is my coverage enough to edit?" }, "agent");
		assert.equal(asked.ok, true, JSON.stringify(asked).slice(0, 400));
		assert.ok(!asked.undo, "read only");
		assert.deepEqual([asked.checks.complete, asked.checks.master, asked.checks.sizes], [false, false, false]);
		assert.deepEqual(asked.output.gaps.map((gap) => gap.kind), ["master", "sizes", "sizes"]);
		assert.ok(asked.warnings.some((row) => row.code === "COVERAGE_MASTER"));
		assert.deepEqual([asked.output.matched, asked.output.confidence], [["coverage", "enough"], "high"]);
		const routed = f.run("camera.applyTechnique", { request: "is my coverage enough to edit?" }, "agent");
		assert.equal(routed.ok, true, JSON.stringify(routed).slice(0, 300));
		assert.equal(routed.checks.complete, false, "a coverage question to camera.applyTechnique runs camera.checkCoverage");
		const laidMaster = f.run("camera.cover", { pattern: "master-coverage", cast: ["actor-a", "actor-b"], range: { startFrame: 0, endFrameExclusive: 96 } }, "agent");
		assert.equal(laidMaster.ok, true, JSON.stringify(laidMaster).slice(0, 300));
		const part = f.run("camera.checkCoverage", { range: { startFrame: 0, endFrameExclusive: 96 }, cast: ["actor-a"] }, "agent");
		assert.equal(part.checks.complete, true, JSON.stringify(part.output.gaps));
		console.log(`  ${asked.summary}`);
	} finally { f.dispose(); }
});

console.log(`\n${passed} checks passed`);
