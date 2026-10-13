import { ko, isKo } from "./locale.js";
import { FK_TRACKS, IK_TRACKS, MID_TRACKS } from "./ardy/ik.js";

// Two clocks, one boundary. The app timeline runs the production 24 fps —
// the rate the reference footage and the recorded export are counted in.
// ARDY Core generates on its trained 20 fps clock and that cannot move, so
// takes are RETIMED inbound (bridge → app, retimeMotion) and frame numbers
// are CONVERTED outbound (app → bridge, toArdyFrame). Nothing between the
// boundaries may mix the clocks.
export const TIMELINE_FPS = 24;
// The motion bridge uses the Studio's fixed 24 fps production clock.
export const ARDY_FPS = 24;
export const toArdyFrame = (frame) => Math.round((frame * ARDY_FPS) / TIMELINE_FPS);

// Outbound converters: timeline-frame entries → strictly-ascending bridge
// frames. Rounding can land two timeline frames on one bridge frame; the
// first wins — the bridge refuses non-ascending lists outright.
/** Where a placed pose lands, in TIMELINE frames, for a clip of `clipFrames`. */
export function posePlacementFrame(placement, clipFrames, playheadFrame) {
	const last = Math.max(0, clipFrames - 1);
	if (placement === "end") return last;
	if (placement === "middle") return Math.round(last / 2);
	if (placement === "playhead") return Math.max(0, Math.min(last, playheadFrame));
	return 0;
}

export function toArdyFrameEntries(entries) {
	const out = [];
	for (const entry of entries) {
		const frame = toArdyFrame(entry.frame);
		if (out.length && frame <= out[out.length - 1].frame) continue;
		out.push({ ...entry, frame });
	}
	return out;
}

export function toArdySegments(segments) {
	const out = [];
	for (const segment of segments) {
		const startFrame = toArdyFrame(segment.startFrame);
		const endFrame = toArdyFrame(segment.endFrame);
		if (endFrame <= startFrame) continue; // a zero-length rounding remnant covers nothing
		out.push({ ...segment, startFrame, endFrame });
	}
	return out;
}

export const DEFAULT_DURATION_S = 15; // pre-motion timeline duration; shown as duration × TIMELINE_FPS frames
export const DEFAULT_PLAYBACK_SPEED = 1;
export const BRIDGE_RECHECK_MS = 3000;
export const ARDY_PROMPT_HORIZON_FRAMES = 2 * TIMELINE_FPS; // core model horizon: 2 seconds, counted on the timeline clock
export const MAX_WAYPOINTS = 32; // ARDY bridge contract: a root path holds 2..32 distinct waypoint frames
export const ARDY_PROMPT_MAX = 500; // bridge contract: prompt must be non-empty, capped at 500 chars
export const ARDY_DURATION_MIN = 1; // the UI works in whole seconds; the bridge floor is 0.15 s
export const ARDY_DURATION_MAX = 1200; // bridge contract: duration capped at 1200 s
export const ARDY_SEED_MAX = 2 ** 31 - 1; // bridge contract: optional seed, integer in 0..2**31-1
// Scheduled inpainting (contract C3): how hard a regeneration holds onto the
// take that is already loaded. 0 turns preserving OFF entirely; 0.5 is the
// paper's recommended setting. The app ships this RAW number and nothing else:
// the strength -> denoising-schedule mapping (sigma_s = round(1000 * strength),
// sigma_e = min(50, sigma_s), diffusion time 0..1000) lives on the box side, and
// duplicating it here is exactly how the two would silently drift apart.
export const ARDY_PRESERVE_DEFAULT = 0.5;
export const DEFAULT_PROMPT_CLIPS = [];

/** The prompt-block schedule: every authored block in frame order, with the gaps
 * between them filled by the base prompt so the bridge always receives one
 * contiguous 0..clipFrames sequence. Blocks shorter than 3 frames are dropped —
 * they cannot carry a generation.
 * Pure and shared on purpose: the request assembly decides which blocks count as
 * "edited", and the preserve panel has to name the SAME blocks. Re-deriving them
 * approximately beside the slider is how the UI starts promising a locality the
 * wire does not carry. */
export function buildPromptSchedule(sourcePromptClips, clipFrames, prompt) {
	const segments = [];
	let cursor = 0;
	for (const clip of sourcePromptClips) {
		const startFrame = Math.max(cursor, Math.min(clipFrames, clip.startFrame));
		const endFrame = Math.max(startFrame, Math.min(clipFrames, clip.endFrame));
		if (startFrame > cursor) segments.push({ startFrame: cursor, endFrame: startFrame, prompt });
		if (endFrame - startFrame >= 3) segments.push({ startFrame, endFrame, prompt: clip.text.trim() || prompt });
		cursor = Math.max(cursor, endFrame);
		if (cursor >= clipFrames) break;
	}
	if (cursor < clipFrames) segments.push({ startFrame: cursor, endFrame: clipFrames, prompt });
	if (segments.length === 0) segments.push({ startFrame: 0, endFrame: clipFrames, prompt });
	return segments;
}

/** The DISTINCT ik track ids keyed inside the half-open timeline span
 * [startFrame, endFrame). `ikState.keys` is Map(frame -> Map(trackId -> pose)),
 * so a frame with several dragged effectors contributes all of them. */
export function ikTracksInRange(ikState, ikFrames, startFrame, endFrame) {
	const tracks = new Set();
	for (const frame of ikFrames) {
		if (frame < startFrame || frame >= endFrame) continue;
		for (const trackId of ikState?.keys?.get(frame)?.keys() ?? []) tracks.add(trackId);
	}
	return [...tracks];
}

/* Which limb a keyed IK track frees once the preserve mask is grouped
   (contract C3v2). The single source of truth for track -> mask group is
   TRACK_GROUPS in tools/kimodo/preserve-mask.mjs; nothing under tools/ may be
   imported into src/, so the rule is transcribed here — as USER-FACING LABELS
   only, never as a second copy of the mapping the wire depends on:
     leftHand,  leftElbow  -> leftArm     rightHand, rightElbow -> rightArm
     leftFoot,  leftKnee   -> leftLeg     rightFoot, rightKnee  -> rightLeg
     head,      neck       -> head        spine, chest, leftShoulder,
     hips                  -> torso AND root      rightShoulder -> torso
   The track ids are the same namespace on both sides (src/ardy/ik.js owns
   them), so the app ships whatever ids it has and the mask builder maps them.
   Torso and pelvis tracks are worded as the whole body: the pelvis carries the
   global transform as well as a bone, and naming a limb beside it would promise
   a locality the mask does not have. */
export const PRESERVE_TRACK_LIMBS = {
	leftHand: "leftArm",
	leftElbow: "leftArm",
	rightHand: "rightArm",
	rightElbow: "rightArm",
	leftFoot: "leftLeg",
	leftKnee: "leftLeg",
	rightFoot: "rightLeg",
	rightKnee: "rightLeg",
	head: "head",
	neck: "head",
	spine: "body",
	chest: "body",
	leftShoulder: "body",
	rightShoulder: "body",
	hips: "body",
};
// A fixed reading order, so the same edit always reads back the same way.
export const PRESERVE_LIMB_ORDER = ["head", "leftArm", "rightArm", "leftLeg", "rightLeg"];
export const preserveLimbLabel = (limb) => ({
	head: ko("head", "머리"),
	leftArm: ko("left arm", "왼팔"),
	rightArm: ko("right arm", "오른팔"),
	leftLeg: ko("left leg", "왼발"),
	rightLeg: ko("right leg", "오른발"),
}[limb]);

/** One muted line naming what a grouped preserve run will regenerate, or "" when
 * no track can be attributed — then the request carries no `tracks` either and
 * the panel's existing whole-take wording is already the truth. */
export function preserveTracksSummary(tracks) {
	const limbs = new Set();
	for (const trackId of tracks) {
		const limb = PRESERVE_TRACK_LIMBS[trackId];
		if (limb) limbs.add(limb);
	}
	if (limbs.size === 0) return "";
	if (limbs.has("body")) return ko("regenerates the whole body", "몸 전체를 다시 생성");
	const names = PRESERVE_LIMB_ORDER.filter((limb) => limbs.has(limb)).map(preserveLimbLabel);
	return isKo ? `${names.join("·")}만 다시 생성` : `regenerates ${names.join(" · ")} only`;
}

/** A track id's human label for the trail picker, read straight out of ik.js's three tables
 * so the picker can never drift from the pose studio's own naming; an unknown id falls back
 * to the raw id so the gap is visible. */
const TRACK_LABELS = new Map([...IK_TRACKS, ...MID_TRACKS, ...FK_TRACKS].map((track) => [track.id, track.label]));
export const lineTrackLabel = (id) => TRACK_LABELS.get(id) ?? id;
