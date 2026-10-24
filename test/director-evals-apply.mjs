// Director evals, applied (A3): each row marked `apply` runs its request
// through camera.applyTechnique on the fixture scene (Mara and Joon facing each
// other 4 m apart, test/bus/shots-fixture.mjs: the real App wiring and command
// bus, in memory), and the result is measured from the document, not read off
// the resolved name: the move classifier verdict, the size step, the camera
// height against the eyes, every camera on one side of the line, the eyes'
// screen position (measureComposition through every stored key), and the
// camera.checkCuts flags. Negatives must be refused, naming their words.
import { shotsFixture, framing } from "./bus/shots-fixture.mjs";
import { createShot } from "../src/cuts.js";
import { createCharacterEntry } from "../src/scenes.js";
import { checkCuts } from "../src/camera-coverage/cut-rules.js";
import { lineSide, shotCameraAt } from "../src/camera-coverage/cut-geometry.js";
import { eyePoint, measureComposition } from "../src/camera-coverage/composition.js";
import { CAST } from "./director-evals-data.mjs";

const TOL = 0.015;
// The fixture's loaded rigs answer to actor-a and actor-b; the scenarios name Mara and Joon.
const BUS_ID = { mara: "actor-a", joon: "actor-b" };
const characters = CAST.map((row) => createCharacterEntry({ id: BUS_ID[row.id], model: "y-bot-tpose", x: row.x, z: row.z, rot: row.rot, subject: row.name }));
const seed = (start, end, id = "shot-a") => ({ ...createShot("Scene", start, end, [{ id: `key-${id}`, frame: start, framing }]), id });

/** The scene a cut-check row asks about, laid through the bus. */
const SETUPS = {
	srs: (f) => f.run("camera.cover", { pattern: "shot-reverse-shot", cast: [BUS_ID.mara, BUS_ID.joon], shotId: "shot-a" }, "agent"),
	// The third shot's camera mirrored across the Mara-Joon line: the cuts into and out of it cross.
	"srs-crossed": (f) => {
		SETUPS.srs(f);
		const third = shotsOf(f)[2], key = third.cameraKeys[0];
		return f.run("shot.frame", { shotId: third.id, subjectIds: [BUS_ID.mara], framing: { exact: { position: { x: key.framing.pos.x, y: key.framing.pos.y, z: -key.framing.pos.z * 3 }, lookAt: { x: 0, y: 1.5, z: 0 }, focalMm: 60 } } }, "agent");
	},
	// Two shots of Mara from the same place at the same size.
	jump: (f) => {
		load(f, [seed(0, 95), seed(96, 191, "shot-b")]);
		f.run("camera.applyTechnique", { shotId: "shot-a", subjectId: BUS_ID.mara, stack: ["medium-shot"] }, "agent");
		return f.run("camera.applyTechnique", { shotId: "shot-b", subjectId: BUS_ID.mara, stack: ["medium-shot"] }, "agent");
	},
};

function load(f, shots) {
	f.shots.load({ shots, frameCount: 240, camera: f.actual.readStudioState().camera });
	f.live.current.timeline.currentFrame = 10;
}
const shotsOf = (f) => [...f.live.current.shots].sort((a, b) => a.startFrame - b.startFrame);
const sceneOf = (f) => ({ cast: f.actual.readStudioState().characters.filter((row) => !row.hidden), filmback: f.actual.readStudioState().filmback });
const near = (a, b) => Math.abs(a - b) <= TOL;

/** The measured results of one row, as problems against its `apply` block, and a one-line account. */
function measure(f, row, receipt) {
	const want = row.apply, problems = [], said = [];
	if (want.refused) {
		if (receipt.ok !== false || receipt.code !== want.refused) problems.push(`want refused ${want.refused}, got ${receipt.ok ? "applied" : receipt.code}`);
		else if (!/No camera action/.test(receipt.message) || !/confidence (high|medium|low)/.test(receipt.message)) problems.push(`the refusal names no words or confidence: ${receipt.message}`);
		return { problems, line: `refused ${receipt.code}` };
	}
	if (!receipt.ok) return { problems: [`refused ${receipt.code}: ${receipt.message}`], line: "refused" };
	const checks = receipt.checks ?? {}, output = receipt.output ?? {};
	if (!output.matched?.length || !output.confidence) problems.push("the receipt states no matched words or confidence");
	if (want.move) {
		if (checks.move !== want.move || checks.moveVerified !== true) problems.push(`move ${checks.move} (verified ${checks.moveVerified}), want ${want.move} verified`);
		said.push(`move ${checks.move}${checks.moveVerified ? " verified" : ""}`);
	}
	if (want.size && checks.toSize !== want.size) problems.push(`size ${checks.toSize}, want ${want.size}`);
	if (want.sizes && (checks.fromSize !== want.sizes[0] || checks.toSize !== want.sizes[1])) problems.push(`sizes ${checks.fromSize} -> ${checks.toSize}, want ${want.sizes.join(" -> ")}`);
	if (want.size || want.sizes) said.push(`size ${checks.fromSize} -> ${checks.toSize}`);
	const shot = shotsOf(f).find((entry) => entry.id === "shot-a"), view = f.actual.readStudioState();
	const subject = view.characters.find((entry) => entry.id === (output.subjectId ?? BUS_ID[row.expected.subject]));
	if (want.height) {
		const camera = shot.cameraKeys[0].framing.pos.y, eye = eyePoint(subject).y, side = camera < eye - 0.05 ? "below" : camera > eye + 0.05 ? "above" : "level";
		if (side !== want.height) problems.push(`camera ${side} the eyes (${camera.toFixed(2)} m vs ${eye.toFixed(2)} m), want ${want.height}`);
		said.push(`camera ${side} the eyes`);
	}
	if (want.screenX !== undefined || want.eyeLineY !== undefined) {
		for (const key of shot.cameraKeys) {
			const at = measureComposition(key.framing, eyePoint(subject), view.filmback.aspectRatio);
			if (want.screenX !== undefined && !near(at.screenX, want.screenX)) problems.push(`key ${key.frame}: eyes at x ${at.screenX}, want ${want.screenX}`);
			if (want.eyeLineY !== undefined && !near(at.eyeLineY, want.eyeLineY)) problems.push(`key ${key.frame}: eye line ${at.eyeLineY}, want ${want.eyeLineY}`);
		}
		const first = measureComposition(shot.cameraKeys[0].framing, eyePoint(subject), view.filmback.aspectRatio);
		said.push(`eyes ${first.screenX},${first.eyeLineY} on ${shot.cameraKeys.length} key(s)`);
	}
	if (want.shots !== undefined || want.oneSide || want.issues !== undefined) {
		const shots = shotsOf(f), scene = sceneOf(f), [a, b] = [BUS_ID.mara, BUS_ID.joon].map((id) => scene.cast.find((entry) => entry.id === id));
		const sides = shots.flatMap((entry) => [entry.startFrame, entry.endFrame].map((at) => lineSide(shotCameraAt(entry, at, scene).pos, a, { x: b.x - a.x, z: b.z - a.z })));
		const oneSide = sides.every((value) => Math.sign(value) === Math.sign(sides[0]) || Math.abs(value) <= 0.2), issues = checkCuts(shots, scene).issueCount;
		if (want.shots !== undefined && shots.length !== want.shots) problems.push(`${shots.length} shots, want ${want.shots}`);
		if (want.oneSide && !oneSide) problems.push(`cameras on both sides of the line: ${sides.map((value) => value.toFixed(2)).join(" ")}`);
		if (want.issues !== undefined && issues !== want.issues) problems.push(`${issues} cut issues measured, want ${want.issues}`);
		said.push(`${shots.length} shots, ${oneSide ? "one side of the line" : "both sides"}, ${issues} cut issues`);
	}
	if (want.flags) {
		const flags = [...new Set((output.cuts ?? []).flatMap((cut) => cut.issues.map((issue) => issue.rule)))].sort();
		if (JSON.stringify(flags) !== JSON.stringify([...want.flags].sort())) problems.push(`flags [${flags}], want [${want.flags}]`);
		if (row.expected.frame !== undefined && (output.cuts?.length !== 1 || Math.abs(output.cuts[0].cutFrame - row.expected.frame) > 1)) problems.push(`the cut checked is ${output.cuts?.map((cut) => cut.cutFrame)}, want the one at ${row.expected.frame}`);
		said.push(`${output.cuts?.length ?? 0} cut(s), flags [${flags.join(",")}]`);
	}
	return { problems, line: said.join("; ") };
}

/** Run each row on a fresh scene; answers Map(id -> { problems, line }). */
export async function applyScenarios(rows) {
	const out = new Map(), f = shotsFixture({ characters });
	try {
		for (const row of rows) {
			const coverage = row.expected.action === "camera.cover" || row.apply.setup;
			load(f, [coverage ? seed(0, 191) : seed(0, 95)]);
			if (row.apply.setup) {
				const laid = SETUPS[row.apply.setup](f);
				if (!laid.ok) { out.set(row.id, { problems: [`setup ${row.apply.setup} refused: ${laid.message}`], line: "" }); continue; }
			}
			// A cut question runs camera.checkCuts itself: camera.applyTechnique answers one too, but as a no-op mutation its receipt keeps no cut list (findings F-1).
			const receipt = row.expected.action === "camera.checkCuts" ? f.run("camera.checkCuts", { request: row.request }, "agent") : f.run("camera.applyTechnique", { shotId: "shot-a", request: row.request }, "agent");
			out.set(row.id, measure(f, row, receipt));
		}
	} finally { f.dispose(); }
	return out;
}
