// Keyframe pack export: bundles a shot's reference material into a ZIP that
// can be dropped into Seedance-style multi-reference video tools. Each pack
// is one folder holding first/last frames, an optional motion clip, the
// camera state, the prompt, and a README explaining what each file is for.

import { buildZip } from "./zip-store.js";

export function slugifyTitle(title) {
	const slug = String(title ?? "")
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "shot";
}

/** ZIP file name for a sequence pack (every shot of a range in one archive). */
export const sequencePackName = (title) => `cozyclay-sequence-${slugifyTitle(title)}.zip`;

/** ZIP file name for a shot pack: `cozyclay-shot-<index>-<slug>.zip`. */
export function keyframePackName(shot) {
	return `cozyclay-shot-${shot.index}-${slugifyTitle(shot.title)}.zip`;
}

function readmeText({ shot, fps, hasLast, hasClip, ext, hasStylized, hasSequence }) {
	const lines = [
		`CozyClay keyframe pack - shot ${shot.index}: ${shot.title}`,
		`Frame range ${shot.startFrame}-${shot.endFrame} at ${fps} fps.`,
		"",
		"This pack is a multi-reference bundle for Seedance-style tools.",
		"Each file plays a distinct reference role:",
		"",
		"- first.png: identity reference. The first frame defines what the",
		"  subject and scene must look like when the shot begins.",
	];
	if (hasLast) {
		lines.push(
			"- last.png: motion endpoint reference. The final frame pins where",
			"  the motion should land, constraining the generated trajectory.",
		);
	} else {
		lines.push(
			"- last.png: not included. Without an endpoint the tool is free to",
			"  choose how the motion resolves.",
		);
	}
	if (hasClip) {
		lines.push(
			`- clip.${ext}: motion reference. The source clip carries the movement`,
			"  the generated video should follow.",
		);
	} else {
		lines.push(
			`- clip.${ext}: not included. Without a motion clip the tool must`,
			"  invent the movement from the frames and prompt alone.",
		);
	}
	lines.push(
		"- camera.json: camera reference. The recorded camera move, fps, and",
		"  frame range to reproduce the framing over time.",
		"- prompt.txt: the text prompt describing the intended action.",
	);
	if (hasStylized) lines.push("- stylized.png: the stylized picture of this panel; first.png is its greybox.");
	if (hasSequence) {
		lines.push(
			"- ../sequence-prompt.txt: the whole brief for a video model: numbered beats",
			"  with timecodes, the measured camera, the cast and the continuity line.",
			"- ../references.json: every reference still by role (first and last frame,",
			"  composition guide, character sheet, set), its file and the beats it serves.",
		);
	}
	lines.push(
		"",
		"Not in this pack: the shot-wide depth video (blocking-depth.mp4) is a",
		"separate export - use Depth (mp4) in the export menu.",
	);
	return lines.join("\n") + "\n";
}

/**
 * Build the ZIP entries for one shot's keyframe pack.
 * @param {object} args
 * @param {{ title: string, index: number, startFrame: number, endFrame: number, kind?: "clip" | "still" }} args.shot
 *   a still (storyboard panel) is one picture held for its whole range:
 *   camera.json gets startFrame === endFrame === the panel start, `hold`
 *   frames and `kind: "still"`.
 * @param {string} [args.folder] folder inside the zip, default `<index>-<slug>`
 * @param {number} args.fps
 * @param {Uint8Array} args.firstFramePng
 * @param {Uint8Array | null} args.lastFramePng
 * @param {{ data: Uint8Array, ext: "mp4" | "webm" } | null} args.clip
 * @param {object} args.camera
 * @param {string} args.prompt
 * @param {Uint8Array | null} [args.stylizedPng] the panel's stylized picture
 * @param {Array<{ name: string, data: string | Uint8Array }>} [args.sequenceFiles] the brief's files
 *   (shot-prompt-engine sequencePackFiles): sequence-prompt.txt, references.json, composition.svg, references/
 * @returns {Array<{ name: string, data: Uint8Array | string }>} entries for buildZip
 */
export function keyframePackEntries({ shot, fps, firstFramePng, lastFramePng, clip, camera, prompt, stylizedPng = null, sequenceFiles = [], folder = `${shot.index}-${slugifyTitle(shot.title)}` }) {
	const entries = [{ name: `${folder}/first.png`, data: firstFramePng }];
	if (lastFramePng != null) entries.push({ name: `${folder}/last.png`, data: lastFramePng });
	if (clip != null) entries.push({ name: `${folder}/clip.${clip.ext}`, data: clip.data });
	if (stylizedPng != null) entries.push({ name: `${folder}/stylized.png`, data: stylizedPng });
	const range = shot.kind === "still"
		? { startFrame: shot.startFrame, endFrame: shot.startFrame, hold: shot.endFrame - shot.startFrame + 1, kind: "still" }
		: { startFrame: shot.startFrame, endFrame: shot.endFrame };
	entries.push(
		{ name: `${folder}/camera.json`, data: JSON.stringify({ ...camera, fps, ...range }, null, 2) + "\n" },
		{ name: `${folder}/prompt.txt`, data: `${prompt}\n` },
		{ name: `${folder}/README.txt`, data: readmeText({ shot, fps, hasLast: lastFramePng != null, hasClip: clip != null, ext: clip ? clip.ext : "mp4", hasStylized: stylizedPng != null, hasSequence: sequenceFiles.length > 0 }) },
		...sequenceFiles,
	);
	return entries;
}

/** Convenience wrapper: entries plus the archive bytes. */
export function buildKeyframePack(args) {
	return buildZip(keyframePackEntries(args));
}
