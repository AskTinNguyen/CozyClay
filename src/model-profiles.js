// How a sequence brief speaks to each video model, and what it must fix to
// fit one: the phrasing a model wants (camera words or bracket tags, cuts
// inside a clip or one clip per shot, words to leave out) on top of the
// limits in model-presets.js, and the warnings with a fix for a range of shots
// that breaks them (split here, trim to N s, deliver another aspect). Pure
// data and arithmetic: the same shots give the same warnings.
import { VIDEO_MODEL_PRESETS, presetById } from "./model-presets.js";

const EPS = 1e-6;

// Words that describe the previs, not the film: a brief never asks a model for them.
export const PREVIS_WORDS = Object.freeze(["previs", "greybox", "clay figure", "mannequin", "T-pose", "CozyClay"]);

// cameraStyle: "words" states each move in film terms with its numbers; "tags" leads with the bracket tag the
// vendor's guide lists. cuts: "in-clip" lets one clip hold several shots (the brief says CUT TO), "per-clip" makes
// one clip per shot. checkedAt/sources/unverified follow the preset (D2).
const PHRASING = {
	"seedance-2.5": { cameraStyle: "words", cuts: "in-clip", cutsVerified: false, refs: "named", tip: "Name each reference by its role; state cuts with their timecodes." },
	"kling-3": { cameraStyle: "words", cuts: "in-clip", cutsVerified: true, refs: "first-last", tip: "Label each shot with its length (Shot 1, 4s); the shot lengths add up to the clip; time camera changes to the second." },
	"veo-3.1": { cameraStyle: "words", cuts: "per-clip", cutsVerified: false, refs: "first-last", tip: "One continuous shot per clip; describe what is wanted rather than what is not; sound is generated, so name the sounds." },
	"minimax-h3": { cameraStyle: "tags", cuts: "per-clip", cutsVerified: false, refs: "first-last", tip: "Lead each move with its bracket tag ([Push in], [Pan left], [Static]); keep to three tags a shot." },
	"minimax-h3-selfhosted": { cameraStyle: "tags", cuts: "per-clip", cutsVerified: false, refs: "first-last", tip: "As the hosted model: bracket tags first, one clip per shot." },
};
const GENERIC = { id: null, name: "Any model", aspects: null, fps: 24, durationsSeconds: [], cameraStyle: "words", cuts: "in-clip", cutsVerified: false, refs: "named", tip: "Pick a model to check clip lengths, aspects and phrasing." };

/** Every profile: the preset limits plus its phrasing. */
export const MODEL_PROFILES = Object.freeze(VIDEO_MODEL_PRESETS.map((preset) => Object.freeze({ ...preset, ...PHRASING[preset.id] })));

/** A profile by id (or an older id); the generic profile for none or an unknown id. */
export function profileById(id) {
	const preset = id ? presetById(id) : null;
	return preset ? MODEL_PROFILES.find((profile) => profile.id === preset.id) : GENERIC;
}

// The bracket tag a classified move leads with (cameraStyle "tags").
const TAGS = { static: "Static", "push-in": "Push in", "pull-out": "Pull out", "zoom-in": "Zoom in", "zoom-out": "Zoom out", "pan-left": "Pan left", "pan-right": "Pan right",
	"tilt-up": "Tilt up", "tilt-down": "Tilt down", "crane-up": "Pedestal up", "crane-down": "Pedestal down", orbit: "Truck left", tracking: "Tracking shot", "dolly-zoom": "Push in" };
export const moveTag = (moveId) => `[${TAGS[moveId] ?? "Static"}]`;

const s = (seconds) => `${Number(seconds.toFixed(2))}s`;
const lengthOf = (row, fps) => (row.endFrame - row.startFrame + 1) / fps;
/** The longest clip a profile makes (Infinity without a limit). */
const clipSeconds = (profile) => (Number.isFinite(profile.maxSeconds) ? profile.maxSeconds : profile.durationsSeconds?.length ? Math.max(...profile.durationsSeconds) : Infinity);

/** Group consecutive beats into clips the profile can make: one per beat, or as many as fit its length and shot count. */
export function clipsFor(beats, profile, fps) {
	if (profile.cuts === "per-clip") return beats.map((beat) => [beat]);
	const max = clipSeconds(profile), clips = [];
	for (const beat of beats) {
		const clip = clips.at(-1), seconds = clip ? clip.reduce((sum, row) => sum + lengthOf(row, fps), 0) : 0;
		if (clip && seconds + lengthOf(beat, fps) <= max + EPS && clip.length < (profile.maxShotsPerClip ?? Infinity)) clip.push(beat);
		else clips.push([beat]);
	}
	return clips;
}

function lengthWarnings(label, seconds, profile, at) {
	const out = [], grid = profile.durationsSeconds ?? [];
	if (grid.length && !grid.some((allowed) => Math.abs(seconds - allowed) < EPS)) {
		const below = grid.filter((allowed) => allowed < seconds).at(-1), above = grid.find((allowed) => allowed > seconds);
		const fix = [below ? `trim to ${below}s` : null, above ? `extend to ${above}s` : null].filter(Boolean).join(" or ");
		out.push({ code: "LENGTH_GRID", message: `${label} runs ${s(seconds)}; ${profile.name} makes ${grid.join(", ")} s clips.`, fix: `${fix[0].toUpperCase()}${fix.slice(1)}${below ? ` (cut at ${at(below)})` : ""}.` });
	} else if (Number.isFinite(profile.maxSeconds) && seconds > profile.maxSeconds + EPS) {
		out.push({ code: "TOO_LONG", message: `${label} runs ${s(seconds)}, over the ${profile.maxSeconds}s ${profile.name} limit.`, fix: `Trim to ${profile.maxSeconds}s (cut at ${at(profile.maxSeconds)}) or split it in two.` });
	}
	if (Number.isFinite(profile.minSeconds) && seconds < profile.minSeconds - EPS) out.push({ code: "TOO_SHORT", message: `${label} runs ${s(seconds)}, under the ${profile.minSeconds}s ${profile.name} minimum.`, fix: `Extend it to ${profile.minSeconds}s or join it to the next beat.` });
	if (profile.wholeSeconds && Math.abs(seconds - Math.round(seconds)) > EPS) {
		const whole = Math.max(profile.minSeconds ?? 1, Math.floor(seconds));
		out.push({ code: "WHOLE_SECONDS", message: `${label} runs ${s(seconds)}; ${profile.name} makes whole seconds.`, fix: `Trim to ${whole}s (cut at ${at(whole)}).` });
	}
	return out;
}

/**
 * Warnings for a range of beats against a profile, each { code, message, fix, beat? }.
 * @param {Array<{ index:number, startFrame:number, endFrame:number, title:string }>} beats  in order
 * @param {object} profile  profileById(...)
 * @param {{ fps:number, aspect:string, timecode:(frame:number)=>string }} options
 */
export function profileWarnings(beats, profile, { fps = 24, aspect, timecode = (frame) => `f${frame}` }) {
	const warnings = [];
	if (!profile?.id || !beats.length) return warnings;
	if (aspect && profile.aspects && !profile.aspects.includes(aspect)) {
		const nearest = profile.aspects.includes("16:9") ? "16:9" : profile.aspects[0];
		warnings.push({ code: "ASPECT", message: `${profile.name} does not deliver ${aspect} (it makes ${profile.aspects.join(", ")}).`, fix: `Deliver ${nearest} and reframe or letterbox to ${aspect} in the edit.` });
	}
	const clips = clipsFor(beats, profile, fps), start = beats[0].startFrame;
	const total = beats.reduce((sum, beat) => sum + lengthOf(beat, fps), 0);
	if (profile.cuts === "in-clip" && clips.length > 1) {
		const splits = clips.slice(1).map((clip) => `beat ${clip[0].index} (${timecode(clip[0].startFrame - start)})`);
		warnings.push({ code: "SPLIT", message: `The range runs ${s(total)} in ${beats.length} beats; ${profile.name} makes ${clipSeconds(profile)}s${profile.maxShotsPerClip ? ` and ${profile.maxShotsPerClip} shots` : ""} per clip.`, fix: `Split here: ${splits.join(", ")} (${clips.length} clips).` });
	}
	clips.forEach((clip) => {
		const seconds = clip.reduce((sum, row) => sum + lengthOf(row, fps), 0), first = clip[0];
		const label = clip.length === 1 ? `Beat ${first.index} (${first.title})` : `Clip of beats ${first.index}-${clip.at(-1).index}`;
		for (const warning of lengthWarnings(label, seconds, profile, (cut) => timecode(first.startFrame - start + Math.round(cut * fps)))) warnings.push({ ...warning, beat: first.index });
	});
	return warnings;
}
