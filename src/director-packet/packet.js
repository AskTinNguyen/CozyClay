// The director packet (director-packet D1): one range of shots as a shooting
// plan a mocap team, a game engine or a collaborator can work from. The cast,
// the story beats when there are any, one row per shot (number, name, frames
// and timecode, duration, size, angle, lens, the move in measured words, the
// capabilities, composition, coverage role, transition in, and the flags the
// existing checks raise on it), the notes that belong to the whole range, and
// the plan's primitives. Pure data: no clock, no randomness, fixed rounding,
// so the same document gives the same bytes. The Studio renders the pictures
// (plan.png, contact-sheet.png) from it; files.js writes the rest.
import { buildSequencePrompt, shotsInRange, timecode } from "../shot-prompt-engine/sequence.js";
import { engineScene } from "../shot-prompt-engine/measure.js";
import { castName } from "../shot-prompt-engine/beat.js";
import { castAt } from "../camera-coverage/cut-geometry.js";
import { checkCuts } from "../camera-coverage/cut-rules.js";
import { runPacketChecks } from "./checks.js";
import { planPrimitives } from "./plan.js";

const PACKET_VERSION = 1;
const r = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places + 0;
const LETTERS = "ABCDEFGH";

/** A range as the packet states it: { from, to } (1-based, inclusive) or { shotIds }. */
function rangeOf(document, range) {
	const all = shotsInRange(document), shots = shotsInRange(document, range);
	return { shots, from: shots.length ? all.indexOf(shots[0]) + 1 : 0, to: shots.length ? all.indexOf(shots.at(-1)) + 1 : 0, of: all.length };
}

function shotRow(beat, shot, fps, flags) {
	const focal = beat.measure.focalMm ?? [beat.measure.start?.focalMm ?? 0, beat.measure.end?.focalMm ?? 0];
	return {
		number: beat.index, shotNumber: beat.shotNumber, shotId: beat.id, name: beat.title,
		frames: { start: beat.startFrame, end: beat.endFrame, count: beat.frames },
		timecode: { in: timecode(beat.deliveryStart, fps), out: timecode(beat.deliveryStart + beat.frames - 1, fps) },
		durationSeconds: r(beat.frames / fps), subjectId: beat.subjectId, subject: beat.subjectName,
		size: beat.size, angle: beat.angle, lensMm: focal.map((mm) => r(mm, 1)), lens: beat.lens,
		move: beat.camera, technique: beat.technique, measured: beat.measured, capabilities: beat.rig,
		composition: beat.composition, coverage: beat.coverage, transitionIn: beat.transition,
		...(shot.targetModel ? { targetModel: shot.targetModel } : {}),
		flags: flags.filter((row) => row.shotId === beat.id).map(({ shotId, ...rest }) => rest),
	};
}

/**
 * @param {object} document  the sequence document (shot-prompt-engine/document.js), with storyBeats
 * @param {{ range?: { from?, to? } | { shotIds }, placeAt?: Function }} [options]  placeAt(row, shot, frame) places the cast (default castAt)
 * @returns the packet: { version, title, range, fps, aspect, seconds, cast, beats?, shots, checks, notes, plan }
 */
export function directorPacket(document, { range = null, placeAt = castAt } = {}) {
	const fps = document.fps ?? 24, scene = engineScene(document), picked = rangeOf(document, range), shots = picked.shots;
	// An empty range briefs nothing (an empty shotIds list would read as every shot).
	const brief = shots.length ? buildSequencePrompt(document, { range: { shotIds: shots.map((shot) => shot.id) } }) : { beats: [], seconds: 0, aspect: null, continuity: null };
	const checkScene = { cast: scene.cast, filmback: document.filmback ?? {}, fovDeg: document.fovDeg, placeAt };
	const { checks, flags, notes } = runPacketChecks({ document, shots, scene: checkScene, placeAt });
	const aspectRatio = document.filmback?.aspectRatio ?? 16 / 9;
	const span = shots.length ? { startFrame: shots[0].startFrame, endFrame: shots.at(-1).endFrame } : null;
	const cast = scene.cast.map((row, i) => ({
		letter: LETTERS[i] ?? String(i + 1), id: row.id, name: castName(row), descriptor: String(row.subject ?? row.name ?? row.id).trim(),
		characterSheet: Boolean((document.cast ?? []).find((entry) => entry.id === row.id)?.identityImage),
		subjectOf: brief.beats.filter((beat) => beat.subjectId === row.id).map((beat) => beat.index),
	}));
	const storyBeats = span ? (document.storyBeats ?? []).filter((beat) => beat.frame >= span.startFrame && beat.frame <= span.endFrame) : [];
	const beatOf = (frame) => brief.beats.find((beat) => frame >= beat.startFrame && frame <= beat.endFrame);
	const beats = storyBeats.map((beat) => ({ id: beat.id, frame: beat.frame, kind: beat.kind, label: beat.label, shot: beatOf(beat.frame)?.index ?? null,
		timecode: beatOf(beat.frame) ? timecode(beatOf(beat.frame).deliveryStart + beat.frame - beatOf(beat.frame).startFrame, fps) : null }));
	const rows = brief.beats.map((beat, i) => shotRow(beat, shots[i], fps, flags));
	const plan = planPrimitives(shots, scene, { cuts: checkCuts(shots, checkScene).cuts, placeAt, aspect: aspectRatio });
	return {
		version: PACKET_VERSION, title: document.title || "Untitled",
		range: { from: picked.from, to: picked.to, of: picked.of, ...(span ?? { startFrame: null, endFrame: null }) },
		fps, aspect: brief.aspect ?? document.aspect ?? null, seconds: r(brief.seconds), look: document.look || null, set: document.set?.environment || null,
		cast, ...(beats.length ? { beats } : {}), shots: rows,
		checks, notes, continuity: brief.continuity?.text ?? null, plan,
	};
}
