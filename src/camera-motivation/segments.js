// A shot's measured camera split into move segments: the camera sampled every
// frame through sampleAt (shot-prompt-engine/measure.js, the camera playback
// and export show, shake left out), runs of moving frames joined across short
// pauses, each named by the move classifier from its two ends. A hold, or a
// run too small to read on screen, is no segment. Pure.
import { classifyMove, shortestArc } from "../camera-move.js";
import { castAt, shotSubject } from "../camera-coverage/cut-geometry.js";
import { SUBJECT_HEIGHT_M } from "../shot.js";
import { cameraAt, steady } from "../shot-prompt-engine/measure.js";

const DEG = 180 / Math.PI, GAP = 3;
// Finer than measure.js on purpose: an eased key moves the camera very little on its first frame, and the segment must start on the key.
const STEP_M = 1e-7, STEP_RAD = 1e-7, STEP_MM = 1e-6;

function moved(a, b) {
	return Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z) > STEP_M || Math.abs(shortestArc(a.yaw, b.yaw)) > STEP_RAD || Math.abs(b.pitch - a.pitch) > STEP_RAD
		|| Math.abs(b.focalMm - a.focalMm) > STEP_MM || Math.abs((b.rollDeg ?? 0) - (a.rollDeg ?? 0)) > STEP_RAD || Math.abs((b.focusDistance ?? 0) - (a.focusDistance ?? 0)) > STEP_M;
}

/** What a run of poses does: travel (m), pan and tilt (degrees, summed per frame), focal, roll and focus at both ends. */
function sums(poses) {
	let distanceM = 0, panDeg = 0, tiltDeg = 0;
	for (let i = 1; i < poses.length; i++) {
		const a = poses[i - 1], b = poses[i];
		distanceM += Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z);
		panDeg += shortestArc(a.yaw, b.yaw) * DEG;
		tiltDeg += (b.pitch - a.pitch) * DEG;
	}
	const start = poses[0], end = poses.at(-1);
	return { distanceM, panDeg, tiltDeg, focalMm: [start.focalMm, end.focalMm], rollDeg: [start.rollDeg ?? 0, end.rollDeg ?? 0], focusM: [start.focusDistance ?? null, end.focusDistance ?? null] };
}

/** True when a run reads on screen: 5 cm of travel, a degree of pan or tilt, half a millimetre of focal, half a degree of roll, or a 5 cm focus pull. */
function readable(m) {
	const focus = m.focusM.every(Number.isFinite) ? Math.abs(m.focusM[1] - m.focusM[0]) : 0;
	return m.distanceM >= 0.05 || Math.abs(m.panDeg) >= 1 || Math.abs(m.tiltDeg) >= 1 || Math.abs(m.focalMm[1] - m.focalMm[0]) >= 0.5 || Math.abs(m.rollDeg[1] - m.rollDeg[0]) >= 0.5 || focus >= 0.05;
}

/** The character a shot is about (its coverage subject, else the one nearest the frame centre, else the first), placed at a frame. */
export function shotSubjectRow(scene, shot, camera, frame = shot.startFrame, place = castAt) {
	const people = scene.cast.map((row) => place(row, shot, frame));
	const row = shotSubject(shot, camera, people, scene.filmback?.aspectRatio ?? 16 / 9) ?? people[0];
	return row ? { ...row, height: row.height ?? SUBJECT_HEIGHT_M } : null;
}

/**
 * @param {object} scene  measure.js engineScene(document)
 * @param {object} shot
 * @returns {{ unmeasured: boolean, segments: Array<{ index, startFrame, endFrame, start, end, moveId, phrase, distanceM, panDeg, tiltDeg, focalMm, rollDeg, focusM }> }}
 *   startFrame: the last still frame before the camera moves; endFrame: the frame it comes to rest
 */
export function moveSegments(scene, shot, { fps = 24 } = {}) {
	const still = steady(shot), poses = [];
	for (let frame = shot.startFrame; frame <= shot.endFrame; frame++) poses.push(cameraAt(scene, still, frame));
	if (!poses.length || poses.some((pose) => !pose?.pos)) return { unmeasured: true, segments: [] };
	const runs = [];
	for (let i = 1; i < poses.length; i++) {
		if (!moved(poses[i - 1], poses[i])) continue;
		const run = runs.at(-1);
		if (run && i - run.last <= GAP + 1) run.last = i;
		else runs.push({ first: i, last: i });
	}
	const subject = shotSubjectRow(scene, shot, poses[0]) ?? { x: 0, z: 0, rot: 0, height: SUBJECT_HEIGHT_M };
	const segments = runs.map((run) => ({ run, m: sums(poses.slice(run.first - 1, run.last + 1)) })).filter(({ m }) => readable(m)).map(({ run, m }, index) => {
		const start = poses[run.first - 1], end = poses[run.last], seconds = (run.last - run.first + 1) / fps;
		const move = classifyMove(start, end, subject, { durationS: Math.max(seconds, 0.1), height: subject.height, sensorId: scene.filmback?.sensorId, aspectRatio: scene.filmback?.aspectRatio });
		const lensOnly = move.id === "static" ? (Math.abs(m.rollDeg[1] - m.rollDeg[0]) >= 0.5 ? "roll" : "focus") : move.id;
		return { index, startFrame: shot.startFrame + run.first - 1, endFrame: shot.startFrame + run.last, start, end, moveId: lensOnly, phrase: move.id === "static" ? `a ${lensOnly} change` : move.phrase, ...m };
	});
	return { unmeasured: false, segments, subject };
}

/** The verb a fix names a move by: "push", "pull-out", "pan", "zoom", "crane", "arc", "track", "roll", "focus pull". */
export function moveVerb(moveId) {
	const id = String(moveId ?? "");
	if (id === "push-in") return "push";
	if (id === "pull-out") return "pull-out";
	if (id === "dolly-zoom") return "dolly-zoom";
	if (id === "orbit") return "arc";
	if (id === "focus") return "focus pull";
	return id.split("-")[0] === "tracking" ? "track" : id.split("-")[0] || "move";
}

/** The move as a present-tense clause for the brief: "pushes in", "pans left", "tracks". */
export function moveClause(moveId) {
	const id = String(moveId ?? "");
	const clauses = { "push-in": "pushes in", "pull-out": "pulls back", "dolly-zoom": "dolly-zooms", orbit: "arcs around", tracking: "tracks", "zoom-in": "zooms in", "zoom-out": "zooms out", roll: "rolls", focus: "pulls focus" };
	if (clauses[id]) return clauses[id];
	const [verb, way] = id.split("-");
	return way ? `${verb}s ${way}` : `${verb || "move"}s`;
}
