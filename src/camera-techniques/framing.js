// Where one framing puts the camera: shot sizes, lens heights and angles,
// group framings, over-the-shoulder, point of view and reverse angle. Pure
// math over plain scene rows; every framing is the exact form frame_shot
// takes ({ position, lookAt, focalMm }).
import { FRAMING_PIVOT_Y, SUBJECT_HEIGHT_M, focalMmToFov, usedSensorHeightMm } from "../shot.js";
import { SIZE_LADDER } from "./entry.js";

const DEG = Math.PI / 180;

/** Screen fraction (subject height over frame height), aim height (share of
 * stature) and default lens for every size a recipe names. The fractions sit
 * mid-band in shot.js SIZE_TABLE, so the derived label is the one asked for. */
export const SIZE_SPECS = Object.freeze({
	italian: { fraction: 5.2, aim: 0.935, lens: 80, ladder: 0 },
	"extreme close-up": { fraction: 3.4, aim: 0.93, lens: 75, ladder: 0 },
	insert: { fraction: 4.2, aim: 0.55, lens: 60, ladder: 0 },
	choker: { fraction: 2.6, aim: 0.91, lens: 70, ladder: 1 },
	"close-up": { fraction: 2.2, aim: 0.9, lens: 65, ladder: 1 },
	head: { fraction: 1.9, aim: 0.89, lens: 60, ladder: 1 },
	"medium close-up": { fraction: 1.375, aim: 0.84, lens: 50, ladder: 2 },
	"medium shot": { fraction: 0.975, aim: 0.76, lens: 40, ladder: 3 },
	cowboy: { fraction: 0.74, aim: 0.66, lens: 35, ladder: 4 },
	american: { fraction: 0.7, aim: 0.64, lens: 35, ladder: 4 },
	"medium-wide shot": { fraction: 0.66, aim: 0.6, lens: 35, ladder: 4 },
	full: { fraction: 0.56, aim: 0.55, lens: 32, ladder: 4 },
	long: { fraction: 0.4, aim: 0.5, lens: 28, ladder: 5 },
	"wide shot": { fraction: 0.36, aim: 0.5, lens: 24, ladder: 5 },
	"extreme wide shot": { fraction: 0.2, aim: 0.5, lens: 20, ladder: 6 },
	establishing: { fraction: 0.12, aim: 0.5, lens: 20, ladder: 6 },
});

/** A size `steps` rungs wider (positive) or tighter (negative) on the ladder. */
export const stepSize = (size, steps) => SIZE_LADDER[Math.max(0, Math.min(SIZE_LADDER.length - 1, (SIZE_SPECS[size]?.ladder ?? 3) + steps))];

/** Lens heights as a share of a 1.8 m stature (studio-agent-commands LEVELS),
 * or a fixed elevation above the aim for the steep views. */
const LEVELS = { ground: { y: 0.3 }, worm: { metres: 0.12 }, trunk: { y: 0.42 }, low: { y: 0.7 }, hip: { y: 1.1 }, eye: { y: 1.65 },
	high: { y: 2.1 }, birds: { elevation: 62 }, overhead: { elevation: 88.5 }, insert: { elevation: 38 }, establish: { metres: 6 } };
const VIEWS = { front: 0, "front three-quarter": 40, profile: 90, "rear three-quarter": 140, back: 180 };

export const rotateXZ = (v, radians) => ({ x: v.x * Math.cos(radians) - v.z * Math.sin(radians), z: v.x * Math.sin(radians) + v.z * Math.cos(radians) });
const facing = (row) => ({ x: Math.sin(row.rot * DEG), z: Math.cos(row.rot * DEG) });
const unit = (v) => { const length = Math.hypot(v.x, v.z) || 1; return { x: v.x / length, z: v.z / length }; };
export const scaleOf = (row) => (row.height ?? SUBJECT_HEIGHT_M) / SUBJECT_HEIGHT_M;

/** The lens range the editor accepts on this filmback (14-90 degree FOV), a hair inside. */
export function clampFocal(focalMm, filmback = {}) {
	const gate = usedSensorHeightMm(filmback.sensorId, filmback.aspectRatio);
	const min = (gate / (2 * Math.tan(45 * DEG))) * 1.01, max = (gate / (2 * Math.tan(7 * DEG))) * 0.99;
	return Math.max(min, Math.min(max, focalMm));
}
const halfTan = (focalMm, filmback) => Math.tan(focalMmToFov(focalMm, filmback.sensorId, filmback.aspectRatio) / 2);

/**
 * One subject, one size, one level, one view: the inverse of shot.js
 * deriveShot (distance to the framing pivot sets the size).
 * @param {{x:number,z:number,rot:number,height?:number}} subject
 * @param {{size:string, level:string, view:string, side:string, focalMm:number, levelMetres?:number}} state
 */
export function singleFraming(subject, state, filmback, notes = []) {
	const spec = SIZE_SPECS[state.size] ?? SIZE_SPECS["medium shot"], s = scaleOf(subject), height = SUBJECT_HEIGHT_M * s;
	const focalMm = clampFocal(state.focalMm ?? spec.lens, filmback);
	const d3 = height / (2 * spec.fraction * halfTan(focalMm, filmback));
	const pivot = FRAMING_PIVOT_Y * s, level = LEVELS[state.level] ?? LEVELS.eye;
	let dy = level.elevation !== undefined ? d3 * Math.sin(level.elevation * DEG) : (state.levelMetres ?? level.metres ?? level.y * s) - pivot;
	if (level.elevation === undefined && Math.abs(dy) > d3 * 0.95) {
		dy = Math.sign(dy) * d3 * 0.95;
		notes.push(`the ${state.level} lens height was eased to ${(pivot + dy).toFixed(2)} m to keep the ${state.size ?? "medium shot"}`);
	}
	const horizontal = Math.sqrt(Math.max(d3 * d3 - dy * dy, 0.0025));
	const angle = (subject.rot + (state.side === "left" ? 1 : -1) * (VIEWS[state.view] ?? 40)) * DEG;
	const position = { x: subject.x + Math.sin(angle) * horizontal, y: pivot + dy, z: subject.z + Math.cos(angle) * horizontal };
	return { position, lookAt: { x: subject.x, y: spec.aim * height, z: subject.z }, focalMm };
}

/** Two, three or all of the cast in one frame: the camera faces the line
 * they stand on, from the side they face, far enough for both edges. */
export function groupFraming(members, state, filmback) {
	if (members.length < 2) return singleFraming(members[0], state, filmback);
	const centre = { x: members.reduce((sum, row) => sum + row.x, 0) / members.length, z: members.reduce((sum, row) => sum + row.z, 0) / members.length };
	const far = members.reduce((best, row) => (Math.hypot(row.x - members[0].x, row.z - members[0].z) > Math.hypot(best.x - members[0].x, best.z - members[0].z) ? row : best), members[1]);
	const axis = unit({ x: far.x - members[0].x, z: far.z - members[0].z });
	const faced = members.reduce((sum, row) => ({ x: sum.x + facing(row).x, z: sum.z + facing(row).z }), { x: 0, z: 0 });
	let normal = { x: -axis.z, z: axis.x };
	if (normal.x * faced.x + normal.z * faced.z < 0) normal = { x: -normal.x, z: -normal.z };
	normal = rotateXZ(normal, (state.side === "left" ? -1 : 1) * 18 * DEG);
	const tallest = Math.max(...members.map((row) => SUBJECT_HEIGHT_M * scaleOf(row)));
	const spec = SIZE_SPECS[state.size] ?? SIZE_SPECS["medium-wide shot"], focalMm = clampFocal(state.focalMm ?? Math.min(spec.lens, 32), filmback);
	const vTan = halfTan(focalMm, filmback), hTan = vTan * (filmback.aspectRatio ?? 16 / 9);
	const halfWidth = Math.max(...members.map((row) => Math.abs((row.x - centre.x) * axis.x + (row.z - centre.z) * axis.z))) + 0.55 * scaleOf(far);
	const depth = Math.max(...members.map((row) => (row.x - centre.x) * normal.x + (row.z - centre.z) * normal.z));
	const distance = Math.max(halfWidth / hTan * 1.08 + Math.max(depth, 0), tallest / (2 * spec.fraction * vTan));
	const y = (LEVELS[state.level]?.y ?? 1.65) * (tallest / SUBJECT_HEIGHT_M);
	return { position: { x: centre.x + normal.x * distance, y, z: centre.z + normal.z * distance }, lookAt: { x: centre.x, y: spec.aim * tallest, z: centre.z }, focalMm };
}

/** Past the near shoulder of `over` onto `target`'s face; the lens sets the size. */
export function shoulderFraming(target, over, state, filmback) {
	const sOver = scaleOf(over), toward = unit({ x: target.x - over.x, z: target.z - over.z }), right = { x: -toward.z, z: toward.x };
	const side = state.side === "left" ? -1 : 1;
	const position = { x: over.x - toward.x * 0.55 * sOver + right.x * 0.36 * sOver * side, y: 1.68 * sOver, z: over.z - toward.z * 0.55 * sOver + right.z * 0.36 * sOver * side };
	const height = SUBJECT_HEIGHT_M * scaleOf(target), spec = SIZE_SPECS[state.size] ?? SIZE_SPECS["medium close-up"];
	const distance = Math.hypot(target.x - position.x, target.z - position.z, FRAMING_PIVOT_Y * scaleOf(target) - position.y);
	const gate = usedSensorHeightMm(filmback.sensorId, filmback.aspectRatio);
	const focalMm = clampFocal(state.focalMm ?? (gate * spec.fraction * distance) / height, filmback);
	return { position, lookAt: { x: target.x, y: spec.aim * height, z: target.z }, focalMm };
}

/** From the viewer's eyes (a head bone when the editor has one) toward the target or straight ahead. */
export function povFraming(viewer, target, state, filmback) {
	const s = scaleOf(viewer), eye = viewer.eye ?? { x: viewer.x, y: 0.935 * SUBJECT_HEIGHT_M * s, z: viewer.z };
	const look = target ? { x: target.x, y: 0.9 * SUBJECT_HEIGHT_M * scaleOf(target), z: target.z } : null;
	const ahead = look ? unit({ x: look.x - eye.x, z: look.z - eye.z }) : facing(viewer);
	const position = { x: eye.x + ahead.x * 0.16 * s, y: eye.y, z: eye.z + ahead.z * 0.16 * s };
	return { position, lookAt: look ?? { x: position.x + ahead.x * 5, y: position.y - 0.3, z: position.z + ahead.z * 5 }, focalMm: clampFocal(state.focalMm ?? 32, filmback) };
}

/** The current camera swung 180 degrees around the subject, same height and lens. */
export function reverseFraming(subject, camera, state, filmback) {
	if (!camera?.position) return singleFraming(subject, { ...state, view: "back" }, filmback);
	const back = { x: subject.x - (camera.position.x - subject.x), z: subject.z - (camera.position.z - subject.z) };
	const aimY = Number.isFinite(camera.lookAt?.y) ? camera.lookAt.y : 0.8 * SUBJECT_HEIGHT_M * scaleOf(subject);
	return { position: { x: back.x, y: camera.position.y, z: back.z }, lookAt: { x: subject.x, y: aimY, z: subject.z }, focalMm: clampFocal(state.focalMm ?? camera.focalMm ?? 35, filmback) };
}

/** Is a cast member's head and feet inside the frame? (A pure pinhole check.) */
export function inFrame(framing, row, filmback) {
	const f = { x: framing.lookAt.x - framing.position.x, y: framing.lookAt.y - framing.position.y, z: framing.lookAt.z - framing.position.z };
	const fl = Math.hypot(f.x, f.y, f.z), fw = { x: f.x / fl, y: f.y / fl, z: f.z / fl };
	const rl = Math.hypot(fw.z, fw.x) || 1, right = { x: -fw.z / rl, y: 0, z: fw.x / rl };
	const up = { x: right.y * fw.z - right.z * fw.y, y: right.z * fw.x - right.x * fw.z, z: right.x * fw.y - right.y * fw.x };
	const vTan = halfTan(framing.focalMm, filmback), hTan = vTan * (filmback.aspectRatio ?? 16 / 9);
	return [0.05, 0.97].every((share) => {
		const p = { x: row.x - framing.position.x, y: share * SUBJECT_HEIGHT_M * scaleOf(row) - framing.position.y, z: row.z - framing.position.z };
		const depth = p.x * fw.x + p.y * fw.y + p.z * fw.z;
		return depth > 0 && Math.abs((p.x * right.x + p.z * right.z) / depth) <= hTan * 1.02 && Math.abs((p.x * up.x + p.y * up.y + p.z * up.z) / depth) <= vTan * 1.02;
	});
}
