// The reference manifest beside a sequence brief (references.json): every
// still a video model can be given, by role, with its file name inside the
// keyframe pack and the beats it serves: each beat's first and last frame and
// composition guide, a character sheet per cast member, the set. A role the
// project has no picture for is listed under `missing` with how to add one.
// Also the composition guide itself: an SVG of the frame with its thirds and
// where the subject's eyes measured. Pure.
import { slugifyTitle } from "../keyframe-pack.js";

const REFERENCES_SCHEMA = "cozyclay.references.v1";
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const r3 = (value) => Math.round(value * 1000) / 1000;

/** The file extension a data URL's picture keeps, or null for anything that is not a picture. */
function imageExtension(dataUrl) {
	const mime = typeof dataUrl === "string" ? /^data:([^;,]+)[;,]/.exec(dataUrl)?.[1] : null;
	return EXT[mime] ?? null;
}

/** Where a beat's files sit in the pack: the keyframe pack's `<shot number>-<slug>` folder. */
const beatFolder = (beat) => `${beat.shotNumber ?? beat.index}-${slugifyTitle(beat.title)}`;

const nameOf = (row) => String(row.subject ?? row.name ?? row.id).split(",")[0].trim();

/**
 * The reference pictures a pack carries besides the frames: { name, dataUrl } per cast sheet and the set.
 * @param {object} document  { cast: [{ id, subject, identityImage? , hidden? }], set: { image? } }
 */
function referenceImages(document) {
	const out = [];
	for (const row of (document.cast ?? []).filter((entry) => !entry.hidden)) {
		const ext = imageExtension(row.identityImage);
		if (ext) out.push({ role: "character-sheet", characterId: row.id, name: `references/cast-${slugifyTitle(nameOf(row))}.${ext}`, dataUrl: row.identityImage });
	}
	const setExt = imageExtension(document.set?.image);
	if (setExt) out.push({ role: "set", name: `references/set.${setExt}`, dataUrl: document.set.image });
	return out;
}

/**
 * @param {Array} beats  describeBeat results in order (index, title, frames, subjectId, placed)
 * @param {object} document  the sequence document
 * @returns {{ schema, beats: number, entries: Array<{ role, file, beats: number[], subject? }>, missing: Array<{ role, subject?, fix }> }}
 */
export function referenceManifest(beats, document) {
	const entries = [], missing = [], all = beats.map((beat) => beat.index), images = referenceImages(document);
	beats.forEach((beat) => {
		const folder = beatFolder(beat);
		entries.push({ role: "first-frame", file: `${folder}/first.png`, beats: [beat.index], note: "the frame the beat opens on" });
		if (beat.frames > 1) entries.push({ role: "last-frame", file: `${folder}/last.png`, beats: [beat.index], note: "the frame the beat lands on" });
		if (beat.placed) entries.push({ role: "composition-guide", file: `${folder}/composition.svg`, beats: [beat.index], subject: beat.subjectName, note: "thirds and where the subject's eyes sit" });
	});
	for (const row of (document.cast ?? []).filter((entry) => !entry.hidden)) {
		const sheet = images.find((image) => image.characterId === row.id), serves = beats.filter((beat) => beat.subjectId === row.id).map((beat) => beat.index);
		if (sheet) entries.push({ role: "character-sheet", file: sheet.name, beats: serves.length ? serves : all, subject: nameOf(row), note: "the same face, build and wardrobe in every beat" });
		else missing.push({ role: "character-sheet", subject: nameOf(row), fix: `add a character sheet for ${nameOf(row)} in the cast inspector` });
	}
	const set = images.find((image) => image.role === "set");
	if (set) entries.push({ role: "set", file: set.name, beats: all, note: "the location every beat plays in" });
	else missing.push({ role: "set", fix: "add an environment picture in the Environment panel" });
	return { schema: REFERENCES_SCHEMA, beats: beats.length, entries, missing };
}

/** The composition guide of a beat as SVG text: the frame, its thirds, and the measured eye point with its numbers. */
function compositionGuideSvg(beat, aspectRatio = 16 / 9) {
	const width = 640, height = Math.round(width / aspectRatio), placed = beat.placed ?? { screenX: 0.5, eyeLineY: 0.5, inFront: false };
	const x = r3(placed.screenX * width), y = r3(placed.eyeLineY * height), thirds = [1, 2].map((k) => [r3((k * width) / 3), r3((k * height) / 3)]);
	const label = `${beat.index}. ${beat.title}: ${beat.subjectName} at ${r3(placed.screenX)} across, eyes ${r3(placed.eyeLineY)} down`.replace(/[<>&"]/g, "");
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
		`<rect x="0" y="0" width="${width}" height="${height}" fill="#1d1f24" stroke="#c8ccd4" stroke-width="2"/>`,
		...thirds.map(([tx, ty]) => `<line x1="${tx}" y1="0" x2="${tx}" y2="${height}" stroke="#6b7280" stroke-dasharray="6 6"/><line x1="0" y1="${ty}" x2="${width}" y2="${ty}" stroke="#6b7280" stroke-dasharray="6 6"/>`),
		placed.inFront ? `<circle cx="${x}" cy="${y}" r="10" fill="none" stroke="#f2b134" stroke-width="3"/><line x1="${x - 18}" y1="${y}" x2="${x + 18}" y2="${y}" stroke="#f2b134" stroke-width="2"/>` : "",
		`<text x="12" y="${height - 14}" fill="#e5e7eb" font-family="sans-serif" font-size="16">${label}</text>`,
		"</svg>",
	].filter(Boolean).join("\n") + "\n";
}

/** A data URL's bytes (base64 or percent-encoded). */
function dataUrlBytes(dataUrl) {
	const comma = dataUrl.indexOf(","), head = dataUrl.slice(0, comma), body = dataUrl.slice(comma + 1);
	if (!head.includes(";base64")) return new TextEncoder().encode(decodeURIComponent(body));
	const binary = atob(body), bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/**
 * The files a keyframe pack carries for a brief, beside each shot's frames: sequence-prompt.txt and
 * references.json at the root, each beat's composition.svg in its folder, the character sheets and
 * the set under references/. Every name the manifest lists is among them or a frame the pack writes.
 * @param {object} brief     buildSequencePrompt's answer
 * @param {object} document  the sequence document
 * @returns {Array<{ name: string, data: string | Uint8Array }>}
 */
export function sequencePackFiles(brief, document) {
	const aspectRatio = document.filmback?.aspectRatio ?? 16 / 9;
	return [
		{ name: "sequence-prompt.txt", data: `${brief.text}
` },
		{ name: "references.json", data: `${JSON.stringify(brief.references, null, 2)}
` },
		...brief.beats.filter((beat) => beat.placed).map((beat) => ({ name: `${beatFolder(beat)}/composition.svg`, data: compositionGuideSvg(beat, aspectRatio) })),
		...referenceImages(document).map((image) => ({ name: image.name, data: dataUrlBytes(image.dataUrl) })),
	];
}
