// The camera change that clears a shot check (depth-staging A1): raise or
// lower by d m, slide left or right by d m, or change the size one step (a
// dolly along the line to the subject). Each candidate moves every sampled
// camera by the same world offset and keeps its aim on the same point
// (movedCamera, which camera.fixShot applies to the shot's keys too), and the
// smallest one that clears the rule on every sample, without breaking another,
// is the fix. The set and the cast never move (non-goal). Pure.
import { projectPoint } from "../camera-coverage/composition.js";
import { sizeRung } from "../camera-coverage/cut-geometry.js";
import { SIZE_SPECS } from "../camera-techniques/framing.js";
import { SIZE_LADDER } from "../camera-techniques/entry.js";

const STEPS = Array.from({ length: 30 }, (_, i) => Math.round((i + 1) * 0.1 * 100) / 100), MIN_LENS_Y = 0.2;
const round = (value) => Math.round(value * 1000) / 1000 + 0;
const forwardOf = ({ yaw, pitch }) => ({ x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) });

/** A stored camera moved by `delta` (world m), still aimed at the point its view ray met at the depth of `target`. */
export function movedCamera(camera, delta, target, aspectRatio = 16 / 9) {
	const depth = Math.max(projectPoint(camera, target, aspectRatio).depth, 0.5), forward = forwardOf(camera);
	const look = { x: camera.pos.x + forward.x * depth, y: camera.pos.y + forward.y * depth, z: camera.pos.z + forward.z * depth };
	const pos = { x: camera.pos.x + delta.x, y: camera.pos.y + delta.y, z: camera.pos.z + delta.z }, d = { x: look.x - pos.x, y: look.y - pos.y, z: look.z - pos.z };
	return { ...camera, pos, yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
}

/** Raise, lower and slide candidates in growing steps, from the first sample's camera. */
function moves(camera) {
	const right = { x: Math.cos(camera.yaw), z: -Math.sin(camera.yaw) };
	return STEPS.flatMap((metres) => [
		{ kind: "slide-right", metres, delta: { x: right.x * metres, y: 0, z: right.z * metres } },
		{ kind: "slide-left", metres, delta: { x: -right.x * metres, y: 0, z: -right.z * metres } },
		{ kind: "raise", metres, delta: { x: 0, y: metres, z: 0 } },
		...(camera.pos.y - metres >= MIN_LENS_Y ? [{ kind: "lower", metres, delta: { x: 0, y: -metres, z: 0 } }] : []),
	]);
}
const WORDS = { "slide-right": (m) => `slide the camera ${m} m right`, "slide-left": (m) => `slide the camera ${m} m left`, raise: (m) => `raise the camera ${m} m`, lower: (m) => `lower the camera ${m} m` };

/** One size step tighter and wider: the dolly along the line to the subject that makes the size read one rung over. */
function sizeSteps(camera, subject) {
	const now = sizeRung(camera, subject);
	return [-1, 1].flatMap((step) => {
		const size = SIZE_LADDER[now.rung + step];
		if (!size) return [];
		const k = now.fraction / SIZE_SPECS[size].fraction, delta = { x: (camera.pos.x - subject.x) * (k - 1), y: 0, z: (camera.pos.z - subject.z) * (k - 1) };
		return [{ kind: step < 0 ? "size-tighter" : "size-wider", size, metres: round(Math.hypot(delta.x, delta.z)), delta }];
	});
}

/**
 * The fix for one issue: { kind, metres, delta, size?, shotId, text }, or a { kind: "reframe", text } when no candidate clears it.
 * @param {string} rule  occluded | inside | crop
 * @param {Array} samples the shot's judged samples ({ frame, camera, people, props, subject, eye, state })
 * @param {object} context { aspect, clears(rule, camera, sample), keeps?(camera, sample) } from shot-checks.js; keeps says the moved camera still reads the same subject
 */
export function suggestFix(rule, shot, samples, { aspect, clears, keeps = () => true }) {
	// A candidate clears the rule on every sample, keeps the subject the check reads, and leaves every other rule as clean as it was.
	const first = samples[0], ok = (candidate) => samples.every((row) => {
		const camera = movedCamera(row.camera, candidate.delta, row.eye, aspect);
		return clears(rule, camera, row) && keeps(camera, row) && ["occluded", "inside", "crop"].every((name) => name === rule || !clears(name, row.camera, row) || clears(name, camera, row));
	});
	const found = (rule === "crop" ? sizeSteps(first.camera, first.subject) : moves(first.camera)).find(ok);
	if (!found) return { kind: "reframe", shotId: shot.id, text: rule === "crop" ? `reframe ${shot.name} so no frame edge falls at a joint` : `move ${shot.name}'s camera around what is in the way, or cut to another angle` };
	const text = found.size ? `change ${shot.name} to a ${found.size} (one size ${found.kind === "size-tighter" ? "tighter" : "wider"}: move the camera ${found.metres} m ${found.kind === "size-tighter" ? "in" : "back"})` : WORDS[found.kind](found.metres);
	return { kind: found.kind, metres: found.metres, delta: { x: round(found.delta.x), y: round(found.delta.y), z: round(found.delta.z) }, ...(found.size ? { size: found.size } : {}), shotId: shot.id, text };
}
