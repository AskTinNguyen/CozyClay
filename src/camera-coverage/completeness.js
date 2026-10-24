// Is there enough here to edit? (group-coverage A3). For a range of shots and
// a cast, measured from the cameras the shots show (cut-geometry.js) and the
// line each one keeps (cut-line.js):
//
//   master    a master or establishing shot: every cast member in one frame
//   sizes     each cast member read at two sizes or more (their own shots and the group shots)
//   line      where the line changes (two pairs, or one pair seen from both sides) a
//             neutral, a cutaway or a group shot holding both pairs is there to cut through
//   branches  every branch is covered by the same setups (the same camera for each)
//
// Each gap carries a suggested shot as a technique stack. Read only, pure.
import { SIZE_LADDER } from "../camera-techniques/entry.js";
import { castAt, lineSide, shotCameraAt, shotSubject, sizeRung } from "./cut-geometry.js";
import { authoredLine, cutPair, pairLabel } from "./cut-line.js";
import { projectPoint } from "./composition.js";

const NEUTRAL_M = 0.2, SAME_SETUP_M = 0.05, WIDE_RUNG = SIZE_LADDER.indexOf("medium-wide shot");
const nameOf = (row) => String(row?.name ?? row?.subject ?? row?.id ?? "").split(",")[0].trim();
const GROUP_IDS = new Set(["master-shot", "establishing-shot", "three-shot", "two-shot"]);
const stackIds = (shot) => (shot.technique?.stack ?? []).map((item) => item.id);

/** Is a cast member in a camera's frame (chest height, in front of the lens)? */
function inFrame(camera, row, aspect) {
	const ndc = projectPoint(camera, { x: row.x, y: 0.6 * (row.height ?? 1.8), z: row.z }, aspect);
	return ndc.depth > 0.2 && Math.abs(ndc.x) <= 1.05 && Math.abs(ndc.y) <= 1.6;
}

/** One shot as the checks read it: its camera at both ends, the cast where it stands, who it is about, who is in frame. */
function readShot(shot, scene, aspect) {
	const place = scene.placeAt ?? castAt, start = shotCameraAt(shot, shot.startFrame, scene), end = shotCameraAt(shot, shot.endFrame, scene);
	const people = scene.cast.map((row) => place(row, shot, shot.startFrame)), subject = start ? shotSubject(shot, start, people, aspect) : null;
	const seen = start ? people.filter((row) => inFrame(start, row, aspect)) : [];
	return { shot, start, end, people, subject, seen, cutaway: Boolean(start) && (stackIds(shot).includes("insert-shot") || !seen.length) };
}

/** The signed side of a pair's line a camera sits on (0 within the neutral band). */
function sideOf(camera, pair, people) {
	// One direction per pair, whichever order it was named in.
	const [a, b] = [...pair].sort().map((id) => people.find((row) => row.id === id));
	if (!camera || !a || !b) return 0;
	const value = lineSide(camera.pos, a, { x: b.x - a.x, z: b.z - a.z });
	return Math.abs(value) > NEUTRAL_M ? Math.sign(value) : 0;
}

/**
 * @param {Array} shots   the shot document rows
 * @param {object} scene  { cast: visible character rows, filmback, placeAt? }
 * @param {object} [options] { range: { startFrame, endFrame }, castIds, branches: [{ startFrame, endFrame }] }
 */
export function checkCoverage(shots, scene, { range = null, castIds = null, branches = null } = {}) {
	const aspect = scene.filmback?.aspectRatio ?? 16 / 9, ordered = [...(shots ?? [])].filter((shot) => shot.kind !== "still").sort((a, b) => a.startFrame - b.startFrame);
	const clips = range ? ordered.filter((shot) => shot.endFrame >= range.startFrame && shot.startFrame <= range.endFrame) : ordered;
	const span = range ?? { startFrame: clips[0]?.startFrame ?? 0, endFrame: clips.at(-1)?.endFrame ?? 0 };
	const read = clips.map((shot) => readShot(shot, scene, aspect)), gaps = [];
	const named = new Set(castIds ?? clips.flatMap((shot) => [shot.coverage?.subjectId, ...(authoredLine(shot) ?? [])]).filter(Boolean));
	const cast = scene.cast.filter((row) => (named.size ? named.has(row.id) : true));
	const gap = (kind, message, suggest, extra = {}) => gaps.push({ kind, message: message.slice(0, 200), ...extra, suggest });

	// Master: one frame holds the whole cast: a master, establishing or group shot, or everyone read medium-wide or wider.
	const holds = (entry) => cast.every((row) => entry.seen.some((other) => other.id === row.id));
	const wide = (entry) => entry.seen.filter((row) => cast.some((member) => member.id === row.id)).every((row) => sizeRung(entry.start, row).rung >= WIDE_RUNG);
	const master = cast.length ? read.find((entry) => holds(entry) && (stackIds(entry.shot).some((idOf) => GROUP_IDS.has(idOf)) || wide(entry))) : null;
	if (!master && clips.length) gap("master", `No master or establishing shot holds ${cast.map(nameOf).join(", ")} in one frame.`, { stack: [{ id: "master-shot" }], subjectId: cast[0]?.id, text: "lay a master that holds the whole cast" });

	// Sizes: a cast member's own shots, plus every group frame they are seen in.
	const sizes = Object.fromEntries(cast.map((row) => [row.id, [...new Set(read.flatMap((entry) => {
		const seen = entry.seen.find((other) => other.id === row.id), group = entry.seen.length >= 2 && (stackIds(entry.shot).some((idOf) => GROUP_IDS.has(idOf)) || entry === master);
		return seen && (entry.subject?.id === row.id || group) ? [sizeRung(entry.start, seen).rung] : [];
	}))].sort((a, b) => a - b).map((rung) => SIZE_LADDER[rung])]));
	for (const row of cast) {
		const own = sizes[row.id];
		if (own.length >= 2) continue;
		const tight = own.length && SIZE_LADDER.indexOf(own[0]) < WIDE_RUNG;
		gap("sizes", own.length ? `${nameOf(row)} is covered at one size only (${own[0]}).` : `${nameOf(row)} has no shot of their own.`,
			{ stack: [{ id: tight ? "wide-shot" : "close-up" }], subjectId: row.id, text: `add a ${tight ? "wide" : "close-up"} of ${nameOf(row)}` }, { subjectId: row.id });
	}

	// Line changes: a cut between two pairs' lines, or one pair seen from its other side.
	const lineChanges = [], last = new Map();
	const abouts = read.map((entry, i) => (read[i + 1] ? cutPair(entry.shot, read[i + 1].shot, entry.subject, read[i + 1].subject, entry.people) : {}));
	read.forEach((entry, i) => {
		const next = read[i + 1], about = abouts[i], bridge = (test, besides = next) => read.find((other) => other !== entry && other !== besides && (other.cutaway || test(other)));
		if (about.change) {
			const [p, q] = [authoredLine(entry.shot), authoredLine(next.shot)], members = [...new Set([...p, ...q])];
			const found = bridge((other) => members.every((idOf) => other.seen.some((row) => row.id === idOf)) || [p, q].some((pair) => sideOf(other.start, pair, other.people) === 0 && sideOf(other.end, pair, other.people) === 0));
			lineChanges.push({ cutFrame: next.shot.startFrame, kind: "pair", from: about.change[0], to: about.change[1], bridge: found?.shot.id ?? null });
			if (!found) gap("line-change", `The line changes from ${about.change[0]} to ${about.change[1]} at ${next.shot.startFrame} with no neutral, cutaway or group shot to cut through.`,
				{ stack: [{ id: members.length >= 3 ? "three-shot" : "two-shot" }], subjectId: q[0], text: `add a group shot holding ${members.length} people, or a cutaway (insert-shot)` }, { frames: [entry.shot.endFrame, next.shot.startFrame] });
		}
		const near = about.pair ?? abouts[i - 1]?.pair, pair = authoredLine(entry.shot) ?? (near ? near.map((row) => row.id) : null);
		if (!pair || !entry.start || entry.cutaway) return;
		const key = [...pair].sort().join("|"), was = last.get(key), [s0, s1] = [sideOf(entry.start, pair, entry.people), sideOf(entry.end, pair, entry.people)];
		if (was && s0 && s0 !== was.side) {
			const found = bridge((other) => (sideOf(other.start, pair, other.people) === 0 && sideOf(other.end, pair, other.people) === 0) || (sideOf(other.start, pair, other.people) * sideOf(other.end, pair, other.people) < 0), null);
			const label = pairLabel(pair.map((idOf) => entry.people.find((row) => row.id === idOf)));
			lineChanges.push({ cutFrame: entry.shot.startFrame, kind: "side", from: label, to: label, bridge: found?.shot.id ?? null });
			if (!found) gap("line-change", `${entry.shot.name} sees the ${label} line from its other side, and no neutral or cutaway is there to cut through.`,
				{ stack: [{ id: "medium-shot" }, { id: "head-on-shot" }], subjectId: pair[0], text: "add a neutral on the line (head-on), or a cutaway" }, { shotId: entry.shot.id });
		}
		if (s1 || s0) last.set(key, { side: s1 || s0, index: i });
	});

	// Branches: the given ranges, else the branches camera.cover laid.
	const laid = [...new Set(clips.map((shot) => shot.coverage?.branch).filter(Number.isInteger))].sort((a, b) => a - b);
	const spans = branches ?? (laid.length > 1 ? laid.map((n) => { const own = clips.filter((shot) => shot.coverage?.branch === n); return { startFrame: own[0].startFrame, endFrame: own.at(-1).endFrame }; }) : []);
	const setupKey = (entry) => entry.shot.coverage?.setup ?? `${entry.subject?.id ?? "none"}:${stackIds(entry.shot).join("+")}`;
	const perBranch = spans.map((b) => read.filter((entry) => entry.shot.startFrame >= b.startFrame && entry.shot.endFrame <= b.endFrame));
	const allSetups = new Map(perBranch.flat().map((entry) => [setupKey(entry), entry]));
	perBranch.forEach((entries, n) => {
		for (const [key, model] of allSetups) {
			const mine = entries.find((entry) => setupKey(entry) === key), say = `${model.shot.coverage?.role ?? "shot"}${model.subject ? ` on ${nameOf(model.subject)}` : ""}`;
			const suggest = { stack: model.shot.technique?.stack ?? [{ id: "medium-close-up" }], subjectId: model.subject?.id, text: `lay the ${say} setup in branch ${n + 1} with the same stack` };
			if (!mine) gap("branch", `Branch ${n + 1} (${spans[n].startFrame}-${spans[n].endFrame}) has no ${say} setup that the other branches use.`, suggest, { branch: n });
			else if (mine.start && model.start && Math.hypot(mine.start.pos.x - model.start.pos.x, mine.start.pos.y - model.start.pos.y, mine.start.pos.z - model.start.pos.z) > SAME_SETUP_M) {
				gap("branch", `Branch ${n + 1}'s ${say} is not the same setup: its camera stands ${Math.hypot(mine.start.pos.x - model.start.pos.x, mine.start.pos.z - model.start.pos.z).toFixed(2)} m from the other branches'.`, suggest, { branch: n, shotId: mine.shot.id });
			}
		}
	});

	return { complete: gaps.length === 0, range: span, shots: clips.length, cast: cast.map((row) => row.id), gaps,
		checks: { master: Boolean(master), sizes: gaps.every((row) => row.kind !== "sizes"), lineChanges: gaps.every((row) => row.kind !== "line-change"), branches: spans.length ? gaps.every((row) => row.kind !== "branch") : null },
		measures: { master: master?.shot.id ?? null, sizes, lineChanges, branches: spans.map((b, n) => ({ ...b, setups: perBranch[n].map(setupKey) })) } };
}
