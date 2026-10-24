// The whole-sequence brief: one text a video model can follow for a range of
// shots. A header (format, total length, aspect, look, the model it is shaped
// for), the cast with stable descriptors, numbered beats with timecodes (what
// the camera does in the classifier's words and measured, size, angle, lens,
// rig, composition, coverage role, the transition in, and the story beats the
// cast's motion makes there), then the continuity line. The same document
// gives the same bytes (D1): no clock, no randomness, fixed rounding.
import { describeBeat, castName } from "./beat.js";
import { engineScene } from "./measure.js";
import { motionBeats, beatsIn } from "./motion-beats.js";
import { continuityLine } from "./continuity.js";
import { referenceManifest } from "./references.js";
import { PREVIS_WORDS, clipsFor, moveTag, profileById, profileWarnings } from "../model-profiles.js";
import { checkMotivation, motivationReason } from "../camera-motivation/check.js";
import { depthWords, shotLayers } from "../camera-depth/layers.js";

const DEFAULT_LOOK = "cinematic, natural light";
const pad = (value) => String(value).padStart(2, "0");
const sec = (seconds) => `${Number(seconds.toFixed(2))}s`;

/** SMPTE-style timecode HH:MM:SS:FF of a frame count at fps. */
export function timecode(frames, fps = 24) {
	const whole = Math.max(0, Math.round(frames)), f = whole % fps, total = Math.floor(whole / fps);
	return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}:${pad(f)}`;
}

/** The shots a range picks, in time order: { from, to } (1-based, inclusive), { shotIds }, or all. */
export function shotsInRange(document, range = null) {
	const sorted = [...(document.shots ?? [])].filter((shot) => Number.isInteger(shot.startFrame) && Number.isInteger(shot.endFrame)).sort((a, b) => a.startFrame - b.startFrame);
	if (Array.isArray(range?.shotIds) && range.shotIds.length) return sorted.filter((shot) => range.shotIds.includes(shot.id));
	const from = Math.max(1, range?.from ?? 1), to = Math.min(sorted.length, range?.to ?? sorted.length);
	return sorted.slice(from - 1, to);
}

function castLines(document, scene, beats) {
	const letters = "ABCDEFGH";
	return scene.cast.map((row, i) => {
		const descriptor = String(row.subject ?? row.name ?? row.id).trim(), name = castName(row), shown = beats.filter((beat) => beat.subjectId === row.id).map((beat) => beat.index);
		const sheet = (document.cast ?? []).find((entry) => entry.id === row.id)?.identityImage ? "; match the character sheet" : "";
		return `- ${letters[i] ?? i + 1}: ${descriptor}${descriptor.toLowerCase().startsWith(name.toLowerCase()) ? "" : ` (${name})`}. The same person in every beat${sheet}${shown.length ? `; the subject of beat ${shown.join(", ")}` : ""}.`;
	});
}

// Timecodes are delivery time: the selected shots back to back, as the delivered video plays them (no gaps).
function beatLines(beat, { fps, profile, actions, clipLabel, story = [], motives = [] }) {
	const from = beat.deliveryStart, to = from + beat.frames - 1, seconds = beat.frames / fps;
	const head = profile.id === "kling-3" ? `Shot ${beat.index}, ${sec(seconds)}` : `${beat.index}.`;
	const tag = profile.cameraStyle === "tags" ? `${moveTag(beat.moveId)} ` : "";
	return [
		...(clipLabel ? [clipLabel] : []),
		`${head} ${timecode(from, fps)}-${timecode(to, fps)} (${sec(from / fps)}-${sec((to + 1) / fps)}, ${beat.frames} frames) ${beat.title}`,
		`   In: ${beat.transition}.`,
		`   Camera: ${tag}${beat.camera}.`,
		`   Measured: ${beat.measured}.`,
		`   Frame: ${beat.size}; ${beat.angle}; lens ${beat.lens}${beat.composition ? `; ${beat.composition}` : ""}.`,
		...(beat.depth ? [`   Depth: ${beat.depth}.`] : []),
		...(beat.rig.length ? [`   Rig: ${beat.rig.join("; ")}.`] : []),
		...(beat.coverage ? [`   Coverage: ${beat.coverage}.`] : []),
		...actions.map((action) => `   Action ${timecode(from + action.frame - beat.startFrame, fps)} (f${action.frame}${action.takeFrame !== action.frame ? `, take f${action.takeFrame}` : ""}): ${action.words}.`),
		// Authored story beats in the shot, and why each camera move happens (camera-motivation).
		...story.map((row) => `   Story ${timecode(from + row.frame - beat.startFrame, fps)} (f${row.frame}): ${row.kind}, ${row.label}.`),
		...(motives.length ? [`   Motive: the camera ${motives.join("; then ")}.`] : []),
	];
}

/**
 * @param {object} document  { title?, fps, aspect, look?, filmback, frameCount?, activeCharacterId?, cast: [...], shots: [...],
 *   set?: { environment?, image? }, motion?: [{ characterId, name, startFrame?, timeline, observations, objects, yaw }] }
 * @param {{ range?: object, profile?: string }} options
 * @returns {{ text, beats, warnings, profile, aspect, seconds, clips, references, continuity, actions }}
 */
export function buildSequencePrompt(document, { range = null, profile: profileId = null } = {}) {
	const fps = document.fps ?? 24, profile = profileById(profileId), scene = engineScene(document);
	const shots = shotsInRange(document, range);
	if (!shots.length) return { text: "SEQUENCE: no shots in this range.", beats: [], warnings: [], profile, aspect: document.aspect ?? null, seconds: 0, clips: [], references: referenceManifest([], document), continuity: null, actions: [] };
	// shotNumber: the shot's place in the whole sequence, which names its keyframe pack folder.
	const all = shotsInRange(document);
	let delivered = 0;
	const beats = shots.map((shot, i) => {
		const beat = { ...describeBeat(document, shot, { scene, index: i + 1, first: shot === all[0] }), shotNumber: all.indexOf(shot) + 1, deliveryStart: delivered };
		// What stands in front of and behind the subject (depth-staging): the cast and the set's props, through the opening camera.
		beat.depth = depthWords(shotLayers(shot, beat.measure.start, beat.subjectId, { cast: scene.cast, objects: document.objects ?? [], aspectRatio: document.filmback?.aspectRatio }), beat.subjectName);
		delivered += beat.frames;
		return beat;
	});
	const aspects = [...new Set(shots.map((shot) => shot.aspect ?? document.aspect).filter(Boolean))], aspect = aspects[0] ?? null;
	const seconds = delivered / fps;
	const actions = (document.motion ?? []).flatMap((take) => motionBeats(take)).sort((a, b) => a.frame - b.frame || a.name.localeCompare(b.name));
	// The limits read delivery time too: each beat where it starts in the delivered video.
	const warnings = profileWarnings(beats.map((beat) => ({ ...beat, startFrame: beat.deliveryStart, endFrame: beat.deliveryStart + beat.frames - 1 })), profile, { fps, aspect, timecode: (frames) => timecode(frames, fps) });
	if (aspects.length > 1) warnings.push({ code: "MIXED_ASPECT", message: `These shots mix aspects (${aspects.join(", ")}).`, fix: `Deliver every beat at ${aspect}, or brief the ${aspects.slice(1).join(", ")} beats on their own.` });
	const clips = clipsFor(beats, profile, fps), continuity = continuityLine(beats, shots, scene), references = referenceManifest(beats, document);
	const limits = profile.id ? `${profile.durationsSeconds?.length ? `${profile.durationsSeconds.join(", ")} s clips` : `${profile.minSeconds ?? 1}-${profile.maxSeconds} s clips`}${profile.maxShotsPerClip ? `, up to ${profile.maxShotsPerClip} shots` : ""}; ${profile.aspects.join(", ")}; checked ${profile.checkedAt}` : "no model limits applied";
	const look = typeof document.look === "string" && document.look.trim() ? document.look.trim() : DEFAULT_LOOK;
	const lines = [
		`SEQUENCE: ${document.title || "Untitled"}: ${beats.length} ${beats.length === 1 ? "shot" : "shots"}, ${sec(seconds)} at ${fps} fps, ${aspect ?? "the project aspect"}.`,
		`LOOK: ${look}.`,
		...(document.set?.environment ? [`SET: ${document.set.environment.trim()}.`] : []),
		`FOR: ${profile.name} (${limits}). ${profile.tip}`,
		`DELIVERY: ${profile.cuts === "per-clip" ? `one clip per beat (${clips.length} ${clips.length === 1 ? "clip" : "clips"}), each a single continuous shot` : `${clips.length} ${clips.length === 1 ? "clip" : "clips"}, cutting between beats at the timecodes below`}.`,
		"CAST:", ...(scene.cast.length ? castLines(document, scene, beats) : ["- none"]),
		`REFERENCES: references.json lists ${references.entries.length} stills by role (first and last frames, composition guides, character sheets, the set)${references.missing.length ? `; missing: ${references.missing.map((row) => row.subject ? `${row.role} for ${row.subject}` : row.role).join(", ")}` : ""}.`,
		"BEATS:",
	];
	const motivation = new Map(checkMotivation(document, { shotIds: shots.map((shot) => shot.id) }).shots.map((row) => [row.shotId, row.segments]));
	const motives = (beat) => (motivation.get(beat.id) ?? []).map((segment) => motivationReason(segment, beat.subjectName)).filter(Boolean);
	const story = (beat) => (document.storyBeats ?? []).filter((row) => row.frame >= beat.startFrame && row.frame <= beat.endFrame);
	clips.forEach((clip, c) => clip.forEach((beat, k) => lines.push(...beatLines(beat, { fps, profile, actions: beatsIn(actions, shots[beat.index - 1]), story: story(beat), motives: motives(beat),
		clipLabel: clips.length > 1 && k === 0 ? `CLIP ${c + 1} of ${clips.length} (${sec(clip.reduce((sum, row) => sum + row.frames / fps, 0))})${profile.cuts === "per-clip" ? ": generate on its own" : ""}` : null }))));
	lines.push(`CONTINUITY: ${continuity.text}`, `KEEP OUT: the previs itself (${PREVIS_WORDS.slice(0, 4).join(", ")}): render real people in a real place in the look above.`);
	if (warnings.length) lines.push("WARNINGS:", ...warnings.map((warning) => `- ${warning.message} Fix: ${warning.fix}`));
	return { text: lines.join("\n"), beats, warnings, profile, aspect, seconds, clips, references, continuity, actions };
}
