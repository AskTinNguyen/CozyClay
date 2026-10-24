/**
 * What a framing capture SAYS about the shot it came from.
 *
 * A PNG on its own is just pixels: an agent handing it to a video model still
 * has to know the lens, the delivery aspect, who is in frame and which model
 * the shot is aimed at. This module answers that in one pure object, so both
 * capture paths (the live `capture_framing_png` command and the embed-mode
 * message handler) describe a pull the same way.
 *
 * Pure data: no DOM, no React, no three.js — it runs in node tests and in the
 * browser unchanged. Everything is read defensively because callers pass live
 * editor state, where a shot can be missing entirely (no shots authored yet).
 */

import { currentTechnique } from "./camera-techniques/storage.js";
import { transitionWords } from "./camera-coverage/transitions.js";
import { cameraCapabilities } from "./camera-capabilities/fields.js";
import { capabilityWords } from "./camera-capabilities/words.js";

const finite = (value) => (Number.isFinite(value) ? value : null);

/**
 * @param {object} input
 * @param {object|null} input.shot         the shot the captured frame lands in
 * @param {object|null} input.stage        { keyLight } — the stage envelope
 * @param {Array}       input.cast         characters array ({ name, model })
 * @param {number}      input.fps          timeline frames per second
 * @param {string}      input.aspectKey    delivery aspect label, e.g. "16:9"
 * @param {object}      input.size         { width, height } of the capture
 * @param {number}      input.frame        the captured frame number
 * @param {number}      [input.shotIndex]  the shot's index in the shot list
 * @param {object}      [input.lens]       { focalMm, fovDeg } of the live shot
 *   camera, used when the shot's own camera block carries no lens — the block
 *   stores the MOVE (rail, crane, follow), while the lens lives on the stage.
 */
function capabilityMeta(camera, cast, fps) {
	const capabilities = cameraCapabilities(camera);
	if (!Object.keys(capabilities).length) return {};
	// A cast member's typed description starts with its name ("Mara, a woman in a red coat").
	const castName = (id) => { const entry = (Array.isArray(cast) ? cast : []).find((row) => row?.id === id); return (entry?.name ?? entry?.subject ?? id).split(",")[0]; };
	return { capabilities, capabilityWords: capabilityWords(capabilities, { castName, fps: finite(fps) ?? 24 }) };
}

export function shotCaptureMeta({ shot = null, stage = null, cast = [], fps = null, aspectKey = null, size = null, frame = null, shotIndex = null, lens = null } = {}) {
	const camera = shot?.camera ?? null;
	return {
		focalMm: finite(camera?.focalMm) ?? finite(lens?.focalMm),
		fovDeg: finite(camera?.fovDeg) ?? finite(lens?.fovDeg),
		aspect: typeof aspectKey === "string" && aspectKey ? aspectKey : null,
		size: {
			width: finite(size?.width),
			height: finite(size?.height),
		},
		// Which instruments the move actually uses, not which ones were once
		// switched on: a stored-but-empty envelope is no dolly move.
		cameraMove: {
			dolly: Boolean(camera?.dollyTiming),
			crane: Boolean(camera?.craneHeight),
			rail: Boolean(camera?.railFollow) && camera.railFollow.mode !== "off",
		},
		keyLight: stage?.keyLight ?? null,
		// A cast member's name is what the operator typed for it: the studio
		// stores that as the subject description, which is exactly the line a
		// generator wants beside the still.
		cast: (Array.isArray(cast) ? cast : []).map((entry) => ({
			name: entry?.name ?? entry?.subject ?? null,
			model: entry?.model ?? null,
		})),
		frameRange: {
			start: finite(shot?.startFrame),
			end: finite(shot?.endFrame),
		},
		fps: finite(fps),
		shotIndex: Number.isInteger(shotIndex) && shotIndex >= 0 ? shotIndex : null,
		shotTitle: typeof shot?.name === "string" && shot.name ? shot.name : null,
		targetModel: shot?.targetModel ?? null,
		frame: finite(frame),
		// The camera technique stack applied to the shot, while it still describes
		// the camera (an edited camera drops it): words for the prompt.
		...(currentTechnique(shot) ? { technique: { label: currentTechnique(shot).label, phrase: currentTechnique(shot).phrase } } : {}),
		// The transition into the shot, in words (camera-coverage).
		...(transitionWords(shot?.transition, finite(fps) ?? 24) ? { transition: transitionWords(shot.transition, finite(fps) ?? 24) } : {}),
		// The shot camera's capabilities (roll, lens, shake, mount, speed, shutter, rig keys) and their words.
		...capabilityMeta(camera, cast, fps),
	};
}
