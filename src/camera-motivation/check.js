// The motivation check (camera-motivation D1, D2): every move segment of every
// shot (segments.js) is motivated by a beat, motivated by its subject, or
// unmotivated. A beat motivates a move when it falls within the tolerance
// before the move's start or inside the move (a settle beat may land up to two
// tolerances after it comes to rest); the subject motivates it when the
// camera keeps a travelling subject in place on screen, or when the rig was
// laid to travel with the subject (a follow camera, a body mount, a tracking
// rail, walk-and-talk coverage). A move whose beat is more than the tolerance
// from its start or its rest starts or settles off the beat. Holds are never
// flagged. Report only: nothing here changes a shot. Pure.
import { createCameraBlock } from "../camera-block.js";
import { shortestArc } from "../camera-move.js";
import { castAt } from "../camera-coverage/cut-geometry.js";
import { techniqueById } from "../camera-techniques/index.js";
import { currentTechnique } from "../camera-techniques/storage.js";
import { engineScene } from "../shot-prompt-engine/measure.js";
import { beatsIn, motionBeats } from "../shot-prompt-engine/motion-beats.js";
import { moveClause, moveSegments, moveVerb, shotSubjectRow } from "./segments.js";

export const MOTIVATION_RULES = Object.freeze(["unmotivated", "starts-off-beat", "settles-off-beat"]);
export const DEFAULT_TOLERANCE = 6;
const TRAVEL_M = 0.3, TRAVELLING_PATTERNS = new Set(["walk-and-talk"]);
const NOUNS = { land: "the landing", jump: "the take-off", "walk-start": "the first step", "walk-end": "the stop", turn: "the turn", reach: "the reach", grab: "the grab", release: "the release" };

/** The beats of a shot on the timeline clock: authored story beats in its range, and its cast's motion beats as the shot plays them. */
export function shotBeats(document, shot) {
	const story = (document.storyBeats ?? []).filter((beat) => beat.frame >= shot.startFrame - 24 && beat.frame <= shot.endFrame + 24)
		.map((beat) => ({ source: "story", id: beat.id, frame: beat.frame, kind: beat.kind, label: beat.label, name: `'${beat.label}'`, clause: beat.label }));
	const motion = beatsIn((document.motion ?? []).flatMap((take) => motionBeats(take)), { ...shot, endFrame: shot.endFrame + 24 })
		.map((beat) => ({ source: "motion", frame: beat.frame, kind: beat.kind, label: beat.words, name: NOUNS[beat.kind] ?? `'${beat.words}'`, clause: beat.words, characterId: beat.characterId }));
	return [...story, ...motion].sort((a, b) => a.frame - b.frame || a.source.localeCompare(b.source));
}

const yawTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

/** How the subject motivates a segment: { how, subjectId } or null. */
function subjectMotive(shot, segment, scene, place) {
	const block = createCameraBlock(shot.camera), technique = currentTechnique(shot);
	const subject = shotSubjectRow(scene, shot, segment.start, segment.startFrame, place);
	if (!subject) return null;
	if (block.mount) return { how: "mounted on the subject", subjectId: subject.id };
	const rail = technique?.stack.some((row) => techniqueById(row.id)?.recipe?.move === "rail" && techniqueById(row.id)?.expect === "tracking");
	if (rail || TRAVELLING_PATTERNS.has(shot.coverage?.pattern)) return { how: "laid to travel with the subject", subjectId: subject.id, byDesign: true };
	const row = scene.cast.find((entry) => entry.id === subject.id), a = place(row, shot, segment.startFrame), b = place(row, shot, segment.endFrame);
	if (Math.hypot(b.x - a.x, b.z - a.z) < TRAVEL_M) return null;
	// The subject's angle off the lens axis: a camera that keeps it while it travels follows it.
	const seenFromStart = Math.abs(shortestArc(yawTo(segment.start.pos, a), yawTo(segment.start.pos, b)));
	const drift = Math.abs(shortestArc(shortestArc(segment.start.yaw, yawTo(segment.start.pos, a)), shortestArc(segment.end.yaw, yawTo(segment.end.pos, b))));
	const along = { x: segment.end.pos.x - segment.start.pos.x, z: segment.end.pos.z - segment.start.pos.z }, moved = { x: b.x - a.x, z: b.z - a.z };
	const cos = (along.x * moved.x + along.z * moved.z) / ((Math.hypot(along.x, along.z) || 1) * Math.hypot(moved.x, moved.z));
	return drift <= 0.5 * seenFromStart || (Math.hypot(along.x, along.z) >= 0.05 && cos >= 0.5) ? { how: "follows the subject's travel", subjectId: subject.id } : null;
}

const off = (frames, tolerance) => (Math.abs(frames) > 3 * tolerance ? "medium" : "low");

/** One segment judged: its motivation and its issues (each with a severity, the frames and a fix). */
function judge(shot, segment, beats, { scene, place, tolerance }) {
	const mid = (segment.startFrame + segment.endFrame) / 2, verb = moveVerb(segment.moveId);
	const starters = beats.filter((beat) => beat.frame >= segment.startFrame - tolerance && beat.frame <= mid);
	const start = starters.sort((a, b) => Math.abs(a.frame - segment.startFrame) - Math.abs(b.frame - segment.startFrame))[0] ?? null;
	const settle = beats.filter((beat) => beat !== start && beat.frame > mid && beat.frame <= segment.endFrame + 2 * tolerance)
		.sort((a, b) => Math.abs(a.frame - segment.endFrame) - Math.abs(b.frame - segment.endFrame))[0] ?? null;
	const issues = [], align = (beat, edge) => ({ action: "camera.alignMove", args: { shotId: shot.id, beat: beat.source === "story" ? beat.id : beat.frame, edge, segment: segment.index } });
	if (start || settle) {
		if (start && Math.abs(start.frame - segment.startFrame) > tolerance) {
			const by = start.frame - segment.startFrame;
			issues.push({ rule: "starts-off-beat", severity: off(by, tolerance), frames: [segment.startFrame, start.frame], beat: start,
				message: `The ${verb} starts at f${segment.startFrame}, ${Math.abs(by)} frames ${by > 0 ? "before" : "after"} ${start.name} (f${start.frame}).`,
				fix: { text: `start the ${verb} at f${start.frame} on ${start.name}`, ...align(start, "start") } });
		}
		if (settle && Math.abs(settle.frame - segment.endFrame) > tolerance) {
			const by = settle.frame - segment.endFrame;
			issues.push({ rule: "settles-off-beat", severity: off(by, tolerance), frames: [segment.endFrame, settle.frame], beat: settle,
				message: `The ${verb} comes to rest at f${segment.endFrame}, ${Math.abs(by)} frames ${by > 0 ? "before" : "after"} ${settle.name} (f${settle.frame}).`,
				fix: { text: `settle on ${settle.name} at f${settle.frame}`, ...align(settle, "settle") } });
		}
		return { motivation: { by: "beat", beat: start ?? settle, ...(start && settle ? { settle } : {}), edge: start ? "start" : "settle" }, issues };
	}
	const subject = subjectMotive(shot, segment, scene, place);
	if (subject) return { motivation: { by: "subject", ...subject }, issues };
	const big = segment.distanceM >= TRAVEL_M || Math.abs(segment.panDeg) >= 5 || Math.abs(segment.tiltDeg) >= 5 || Math.abs(segment.focalMm[1] - segment.focalMm[0]) >= 5;
	issues.push({ rule: "unmotivated", severity: big ? "high" : "medium", frames: [segment.startFrame, segment.endFrame],
		message: `The ${verb} over f${segment.startFrame}-${segment.endFrame} has no story beat, motion beat or travelling subject to answer to.`,
		fix: { text: `hold (lock the camera off), or add a story beat where the ${verb} should start`, action: "story.addBeat", args: { frame: segment.startFrame } } });
	return { motivation: { by: null }, issues };
}

/**
 * @param {object} document  a sequence document (shot-prompt-engine/document.js) with storyBeats
 * @param {{ tolerance?: number, shotIds?: string[], placeAt?: Function }} [options]  placeAt(row, shot, frame) places the cast (default castAt)
 * @returns {{ shots: Array, issues: Array, issueCount: number, segments: number, tolerance: number, sources: string[] }}
 */
export function checkMotivation(document, { tolerance = DEFAULT_TOLERANCE, shotIds = null, placeAt = castAt } = {}) {
	const scene = engineScene(document), fps = document.fps ?? 24, place = placeAt;
	const picked = (document.shots ?? []).filter((shot) => shot.kind !== "still" && Number.isInteger(shot.startFrame) && Number.isInteger(shot.endFrame) && (!shotIds || shotIds.includes(shot.id)));
	const shots = picked.sort((a, b) => a.startFrame - b.startFrame).map((shot) => {
		const head = { shotId: shot.id, shotName: shot.name, startFrame: shot.startFrame, endFrame: shot.endFrame };
		const block = createCameraBlock(shot.camera);
		const measured = block.mode === "follow" ? { unmeasured: true, segments: [] } : moveSegments(scene, shot, { fps });
		if (measured.unmeasured) return { ...head, unmeasured: true, follow: block.mode === "follow", segments: [], issues: [] };
		const beats = shotBeats(document, shot);
		const segments = measured.segments.map((segment) => {
			const { motivation, issues } = judge(shot, segment, beats, { scene, place, tolerance });
			const { start, end, ...rest } = segment;
			return { ...rest, motivation, issues: issues.map((issue) => ({ ...issue, shotId: shot.id, segment: segment.index })) };
		});
		return { ...head, segments, issues: segments.flatMap((segment) => segment.issues) };
	});
	const issues = shots.flatMap((shot) => shot.issues);
	const sources = [...((document.storyBeats ?? []).length ? ["story beats"] : []), ...((document.motion ?? []).length ? ["motion beats"] : []), "subject travel"];
	return { shots, issues, issueCount: issues.length, segments: shots.reduce((sum, shot) => sum + shot.segments.length, 0), tolerance, sources };
}

/** A motivated segment's reason as the brief states it: "pushes in as Mara makes her admission", "tracks with Mara". */
export function motivationReason(segment, subjectName = "the subject") {
	const clause = moveClause(segment.moveId), motive = segment.motivation;
	if (motive?.by === "beat") return motive.edge === "settle" ? `${clause}, coming to rest as ${motive.beat.clause}` : `${clause} as ${motive.beat.clause}${motive.settle ? `, coming to rest as ${motive.settle.clause}` : ""}`;
	if (motive?.by === "subject") return motive.how === "follows the subject's travel" ? `${clause}, following ${subjectName}'s travel` : `${clause} with ${subjectName}`;
	return null;
}
