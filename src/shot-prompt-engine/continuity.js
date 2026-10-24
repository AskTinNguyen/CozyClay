// The closing continuity line of a sequence brief: which side of the line of
// action every camera keeps (the line between the two principals, or a lone
// subject's facing), where each principal holds on screen, and the screen
// direction of anyone who travels. Measured from the same sampled cameras the
// beats state, with the cut rules' geometry (camera-coverage). Pure.
import { castAt, lineSide, travelAt } from "../camera-coverage/cut-geometry.js";
import { eyePoint, projectPoint, screenDirection } from "../camera-coverage/composition.js";

const NEUTRAL_M = 0.2, SCREEN_MIN = 0.25, DEG = Math.PI / 180;
const nameOf = (row) => String(row.subject ?? row.name ?? row.id).split(",")[0].trim();

function principals(beats, cast) {
	const ids = [...new Set(beats.map((beat) => beat.subjectId).filter(Boolean))];
	const rows = ids.map((id) => cast.find((row) => row.id === id)).filter(Boolean);
	for (const row of cast) if (rows.length < 2 && !rows.includes(row)) rows.push(row);
	return rows.slice(0, 2);
}

/**
 * @param {Array} beats   describeBeat results (measure.start / measure.end cameras)
 * @param {Array} shots   the shots the beats describe, same order
 * @param {object} scene  measure.js engineScene (visible cast, filmback)
 * @returns {{ text: string, side: string|null, crossings: number[] }}
 */
export function continuityLine(beats, shots, scene) {
	const cast = scene.cast ?? [], aspect = scene.filmback?.aspectRatio ?? 16 / 9, parts = [], crossings = [];
	const [a, b] = principals(beats, cast);
	if (!a) return { text: "No cast in these shots: keep the set's geography from beat to beat.", side: null, crossings };
	const first = shots[0], pa = castAt(a, first, first.startFrame), pb = b ? castAt(b, first, first.startFrame) : null;
	const r = (pa.rot ?? 0) * DEG, direction = pb ? { x: pb.x - pa.x, z: pb.z - pa.z } : { x: Math.sin(r), z: Math.cos(r) };
	const lineName = pb ? `the ${nameOf(a)}-${nameOf(b)} line` : `${nameOf(a)}'s line of facing`;
	let sign = 0;
	beats.forEach((beat, i) => {
		const sides = [beat.measure.start, beat.measure.end].filter(Boolean).map((camera) => lineSide(camera.pos, pa, direction)).filter((value) => Math.abs(value) > NEUTRAL_M);
		const here = Math.sign(sides.reduce((sum, value) => sum + value, 0));
		if (!here) return;
		if (!sign) sign = here;
		else if (here !== sign) crossings.push(beats[i].index);
	});
	const side = sign > 0 ? "left" : sign < 0 ? "right" : null;
	if (!side) parts.push(`The cameras stay on ${lineName}, neutral`);
	else if (!crossings.length) parts.push(`Every camera stays on the ${side} side of ${lineName} (seen from ${nameOf(a)})`);
	else parts.push(`The camera starts on the ${side} side of ${lineName} and crosses it at beat ${crossings.join(", beat ")}: cut through a neutral shot there or move that camera back`);
	if (pb && beats[0]?.measure.start) {
		const xa = projectPoint(beats[0].measure.start, eyePoint(pa), aspect), xb = projectPoint(beats[0].measure.start, eyePoint(pb), aspect);
		if (xa.depth > 0 && xb.depth > 0) {
			const left = xa.x < xb.x ? a : b, right = left === a ? b : a;
			parts.push(`${nameOf(left)} holds screen left and ${nameOf(right)} screen right`);
		}
	}
	for (const row of [a, b].filter(Boolean)) {
		const ways = beats.map((beat, i) => {
			const shot = shots[i], camera = beat.measure.start, travel = camera && travelAt(row, shot, Math.round((shot.startFrame + shot.endFrame) / 2));
			const x = travel ? screenDirection(camera, travel) : 0;
			return Math.abs(x) > SCREEN_MIN ? { index: beat.index, way: Math.sign(x) } : null;
		}).filter(Boolean);
		if (!ways.length) continue;
		const flips = ways.filter((entry) => entry.way !== ways[0].way).map((entry) => entry.index);
		parts.push(`${nameOf(row)} travels ${ways[0].way > 0 ? "left to right" : "right to left"} on screen${flips.length ? `, flipping at beat ${flips.join(", beat ")}` : " in every beat that shows it"}`);
	}
	return { text: `${parts.join("; ")}.`, side, crossings };
}
