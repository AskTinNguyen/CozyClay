// The editing rules a script supervisor flags at a cut, as a pure function of
// the document: camera poses and cast placements at the last frame of the
// outgoing shot and the first frame of the incoming one. Report only: nothing
// here changes a shot (camera.checkCuts, the timeline marks, the MCP plan).
//
//   line     the 180-degree rule: both cameras on one side of the line between
//            the two principal subjects (or a lone subject's travel line)
//   jump     a jump cut: the same subject, under 30 degrees and under one size step apart
//   screen   a moving subject keeps its screen direction across the cut
//   eyeline  shot-reverse-shot: the two speakers look opposite ways on screen
import { angleBetween, castAt, lineSide, shotCameraAt, shotSubject, sizeRung, travelAt } from "./cut-geometry.js";
import { screenDirection } from "./composition.js";

export const CUT_RULES = Object.freeze(["line", "jump", "screen", "eyeline"]);
const NEUTRAL_M = 0.2, JUMP_DEG = 30, LOOK_MIN = 0.2, SCREEN_MIN = 0.25;
const DEG = Math.PI / 180;
const facing = (row) => ({ x: Math.sin(row.rot * DEG), z: Math.cos(row.rot * DEG) });
const sideWord = (value) => (value > 0 ? "left" : "right");
/** Does `a` face roughly toward `b` (within 60 degrees)? Side-by-side people facing the same way are not in a reverse. */
const looksAt = (a, b) => { const d = Math.hypot(b.x - a.x, b.z - a.z) || 1, f = facing(a); return (f.x * (b.x - a.x) + f.z * (b.z - a.z)) / d > 0.5; };
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/** The two subjects whose line a cut must not cross: each shot's subject, or the nearest other character. */
function principals(a, b, people) {
	if (a && b && a.id !== b.id) return [a, b];
	const one = a ?? b;
	if (!one) return [];
	const other = people.filter((row) => row.id !== one.id).sort((p, q) => Math.hypot(p.x - one.x, p.z - one.z) - Math.hypot(q.x - one.x, q.z - one.z))[0];
	return other && Math.hypot(other.x - one.x, other.z - one.z) < 12 ? [one, other] : [one];
}

/**
 * Check one cut.
 * @param {object} from  outgoing shot   @param {object} to  incoming shot
 * @param {object} scene { cast: character rows (visible), filmback, fovDeg, placeAt?(row, shot, frame) (default castAt: placement, walked path, shot override) }
 */
export function checkCut(from, to, scene) {
	const aspect = scene.filmback?.aspectRatio ?? 16 / 9, frames = [from.endFrame, to.startFrame], issues = [];
	const camA = shotCameraAt(from, from.endFrame, scene), camB = shotCameraAt(to, to.startFrame, scene);
	const cut = { cutFrame: to.startFrame, from: from.id, to: to.id, fromName: from.name, toName: to.name, frames, issues, measures: {} };
	if (!camA || !camB) return { ...cut, unjudged: "a follow camera or an empty shot has no fixed pose at the cut" };
	const place = scene.placeAt ?? castAt, peopleA = scene.cast.map((row) => place(row, from, from.endFrame)), peopleB = scene.cast.map((row) => place(row, to, to.startFrame));
	const subjectA = shotSubject(from, camA, peopleA, aspect), subjectB = shotSubject(to, camB, peopleB, aspect);
	const at = (row, people) => row && people.find((entry) => entry.id === row.id);
	const issue = (rule, severity, message, fix) => issues.push({ rule, severity, message: message.slice(0, 200), frames, fix });
	const moving = (row) => row && travelAt(scene.cast.find((entry) => entry.id === row.id), to, to.startFrame, place);

	// Screen direction of a moving subject seen in both shots.
	let flipped = false;
	for (const row of [...new Map([subjectA, subjectB].filter(Boolean).map((entry) => [entry.id, entry])).values()]) {
		const travel = moving(row);
		if (!travel) continue;
		const sa = screenDirection(camA, travel), sb = screenDirection(camB, travel);
		cut.measures.screen = [round(sa), round(sb)];
		if (Math.abs(sa) > SCREEN_MIN && Math.abs(sb) > SCREEN_MIN && Math.sign(sa) !== Math.sign(sb)) {
			flipped = true;
			issue("screen", "high", `${row.name} travels screen-${sa > 0 ? "right" : "left"} in ${from.name} and screen-${sb > 0 ? "right" : "left"} in ${to.name}.`,
				{ kind: "insert-neutral", text: `keep ${to.name} on the same side of ${row.name}'s path, or cut through a head-on or tail-away neutral shot` });
		}
	}

	// The 180-degree line between the principals (or a lone subject's travel line).
	const pair = principals(at(subjectA, peopleA) ?? subjectA, at(subjectB, peopleA) ?? subjectB, peopleA);
	const line = pair.length === 2 ? { from: pair[0], direction: { x: pair[1].x - pair[0].x, z: pair[1].z - pair[0].z }, label: `${pair[0].name}–${pair[1].name}` }
		: pair.length === 1 && moving(pair[0]) ? { from: pair[0], direction: moving(pair[0]), label: `${pair[0].name}'s travel` } : null;
	if (line && !(flipped && pair.length === 1)) {
		const sa = lineSide(camA.pos, line.from, line.direction), sb = lineSide(camB.pos, line.from, line.direction);
		cut.measures.line = { label: line.label, sides: [round(sa), round(sb)] };
		if (Math.abs(sa) > NEUTRAL_M && Math.abs(sb) > NEUTRAL_M && Math.sign(sa) !== Math.sign(sb)) {
			issue("line", "high", `${to.name} crosses the ${line.label} line: ${from.name} sits on its ${sideWord(sa)}, ${to.name} on its ${sideWord(sb)}.`,
				{ kind: "flip-side", shotId: to.id, text: `move ${to.name} to the ${sideWord(sa)} side of the line (re-lay it on the other side), or insert a neutral shot on the line` });
		}
	}

	// Jump cut: the same subject, nearly the same angle and size.
	if (subjectA && subjectB && subjectA.id === subjectB.id) {
		const row = at(subjectB, peopleB), angle = angleBetween(camA, camB, row), steps = Math.abs(sizeRung(camA, row).rung - sizeRung(camB, row).rung);
		cut.measures.jump = { angleDeg: round(angle, 1), sizeSteps: steps };
		if (angle < JUMP_DEG && steps < 1) {
			issue("jump", "medium", `${from.name} to ${to.name} on ${row.name} moves only ${Math.round(angle)} degrees at the same size (${sizeRung(camB, row).size}).`,
				{ kind: "change-size", shotId: to.id, text: `change ${to.name} by a size step or more, move the camera 30 degrees or more, or insert a cutaway` });
		}
	}

	// Eyelines in shot-reverse-shot: two different speakers, at least one looking at the other, should look opposite ways on screen.
	if (subjectA && subjectB && subjectA.id !== subjectB.id && sizeRung(camA, subjectA).rung <= 3 && sizeRung(camB, subjectB).rung <= 3 && (looksAt(subjectA, subjectB) || looksAt(subjectB, subjectA))) {
		const la = screenDirection(camA, facing(subjectA)), lb = screenDirection(camB, facing(subjectB));
		cut.measures.eyeline = [round(la), round(lb)];
		if (Math.abs(la) > LOOK_MIN && Math.abs(lb) > LOOK_MIN && Math.sign(la) === Math.sign(lb)) {
			issue("eyeline", "medium", `${subjectA.name} and ${subjectB.name} both look screen-${la > 0 ? "right" : "left"}; in a reverse they should face each other across the cut.`,
				{ kind: "flip-side", shotId: to.id, text: `turn ${subjectB.name} toward ${subjectA.name}, or move ${to.name} so ${subjectB.name} looks screen-${la > 0 ? "left" : "right"}` });
		}
	}
	return { ...cut, subjects: [subjectA?.id ?? null, subjectB?.id ?? null] };
}

/**
 * Every cut between consecutive shots (in time order; a gap between them is noted, still checked).
 * @returns {{ cuts: Array, issueCount: number }}
 */
export function checkCuts(shots, scene) {
	const ordered = [...(shots ?? [])].filter((shot) => shot.kind !== "still").sort((a, b) => a.startFrame - b.startFrame);
	const cuts = ordered.slice(1).map((shot, i) => {
		const cut = checkCut(ordered[i], shot, scene), gap = shot.startFrame - ordered[i].endFrame - 1;
		return gap > 0 ? { ...cut, gapFrames: gap } : cut;
	});
	return { cuts, issueCount: cuts.reduce((sum, cut) => sum + cut.issues.length, 0) };
}
