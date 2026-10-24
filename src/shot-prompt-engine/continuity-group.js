// The continuity line of a sequence brief with three or more people in it
// (group-coverage A6): each pair keeps its own line of action, so the line
// names every pair's line, the side its cameras keep and the beats that keep
// it. A beat's pair is the line authored on its shot (camera.setLine, or the
// pair a group pattern laid it for), else its subject and the next or last
// beat's subject. Measured from the same sampled cameras the beats state,
// with the cut rules' geometry. Pure.
import { castAt, lineSide } from "../camera-coverage/cut-geometry.js";
import { authoredLine } from "../camera-coverage/cut-line.js";

const NEUTRAL_M = 0.2;
const nameOf = (row) => String(row.subject ?? row.name ?? row.id).split(",")[0].trim();
const span = (list) => (list.length > 1 && list.at(-1) - list[0] === list.length - 1 ? `beats ${list[0]}-${list.at(-1)}` : `beat${list.length > 1 ? "s" : ""} ${list.join(", ")}`);

/** The people the beats are about: subjects and authored line members, in first-seen order. */
export function sequencePeople(beats, shots) {
	return [...new Set(beats.flatMap((beat, i) => [beat.subjectId, ...(authoredLine(shots[i]) ?? [])]).filter(Boolean))];
}

/**
 * @param {Array} beats  describeBeat results   @param {Array} shots  the same order   @param {object} scene  { cast }
 * @returns {{ text: string, side: string|null, crossings: number[] }}
 */
export function groupContinuityLine(beats, shots, scene) {
	const cast = scene.cast ?? [], pairs = new Map(), crossings = [];
	beats.forEach((beat, i) => {
		const other = [beats[i + 1], beats[i - 1]].find((row) => row?.subjectId && row.subjectId !== beat.subjectId)?.subjectId;
		const ids = authoredLine(shots[i]) ?? (beat.subjectId && other ? [beat.subjectId, other] : null);
		if (!ids) return;
		const key = [...ids].sort().join("|");
		if (!pairs.has(key)) pairs.set(key, { ids, beats: [] });
		pairs.get(key).beats.push(i);
	});
	const parts = [...pairs.values()].map(({ ids, beats: held }) => {
		const rows = ids.map((id) => cast.find((row) => row.id === id));
		if (rows.some((row) => !row)) return null;
		const first = shots[held[0]], [pa, pb] = rows.map((row) => castAt(row, first, first.startFrame)), direction = { x: pb.x - pa.x, z: pb.z - pa.z };
		let sign = 0;
		const flips = [];
		for (const i of held) {
			const sides = [beats[i].measure.start, beats[i].measure.end].filter(Boolean).map((camera) => lineSide(camera.pos, pa, direction)).filter((value) => Math.abs(value) > NEUTRAL_M);
			const here = Math.sign(sides.reduce((sum, value) => sum + value, 0));
			if (!here) continue;
			if (!sign) sign = here;
			else if (here !== sign) flips.push(beats[i].index);
		}
		crossings.push(...flips);
		const name = `the ${rows.map(nameOf).join("-")} line`, numbers = span(held.map((i) => beats[i].index));
		if (!sign) return `${name} (${numbers}): the cameras stay on it, neutral`;
		return `${name} (${numbers}): every camera on its ${sign > 0 ? "left" : "right"} (seen from ${nameOf(rows[0])})${flips.length ? `, crossing at beat ${flips.join(", beat ")}: cut through a neutral shot there or move that camera back` : ""}`;
	}).filter(Boolean);
	if (!parts.length) return { text: "Several people and no pair to hold a line between: keep the set's geography from beat to beat.", side: null, crossings };
	return { text: `Each pair keeps its own line of action: ${parts.join("; ")}.`, side: null, crossings: [...new Set(crossings)].sort((a, b) => a - b) };
}
