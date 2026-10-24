// The colour script (colour-script A3, A6): one column per shot of a range,
// in time order, with the shot's look in words, the palette it is meant to
// read as, and the palette measured from its middle frame when the Studio
// rendered one; the story beats over it; and the colour change across each
// cut (luminance and warmth delta), from the measured palettes when both sides
// have one, else from the planned tone of the two looks. The same input gives
// the same bytes. Pure: no DOM, no three.js.
import { keyHex, mergeShotLook, shotLookWords } from "../stage-shot-look.js";
import { normalizeLighting, createKeyLight } from "../stage-lighting.js";
import { lookRecipe } from "./recipes.js";

const COLOUR_SCRIPT_VERSION = 1;
/** Where a cut's colour change reads as hard (either delta at least this) or soft (their sum at least this). */
const COLOUR_CUT_LIMITS = Object.freeze({ hardLuminance: 0.2, hardWarmth: 0.25, soft: 0.05 });
const r3 = (value) => Math.round((Number.isFinite(value) ? value : 0) * 1000) / 1000 + 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luma = (hex) => { const [r, g, b] = rgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const warmthOf = (hex) => { const [r, , b] = rgb(hex); return r - b; };
const STUDIO_SKY_LUMA = 0.42; // the themed studio stage reads as a mid grey

/**
 * The tone a look plans, before any pixel is rendered: { luminance 0-1, warmth -1..1 }.
 *   light     = exposure x (0.5 x min(2, key / 1.12) + 0.3 x ambient + 0.2 x fill)   (1 for the studio rig)
 *   luminance = 0.7 x min(1, 0.55 x light) + 0.3 x the sky's luma (a themed sky reads 0.42)
 *   warmth    = the key colour's (R - B) x min(1, light) x 0.7 + the sky's (R - B) x 0.3
 */
export function plannedTone({ lighting, keyLight }) {
	const l = normalizeLighting(lighting), key = createKeyLight(keyLight);
	const light = l.exposure * (0.5 * Math.min(2, key.intensity / 1.12) + 0.3 * l.ambient + 0.2 * l.fill);
	const sky = l.sky ? luma(l.sky) : STUDIO_SKY_LUMA, skyWarmth = l.sky ? warmthOf(l.sky) : 0;
	return { luminance: r3(clamp(0.7 * Math.min(1, 0.55 * light) + 0.3 * sky, 0, 1)), warmth: r3(clamp(warmthOf(keyHex(key)) * Math.min(1, light) * 0.7 + skyWarmth * 0.3, -1, 1)) };
}

/** A shot's tone: its measured palette's when there is one, else its look's planned tone. */
const toneOf = (row) => (row.measured ? { luminance: row.measured.meanLuminance, warmth: row.measured.warmth, source: "measured" } : { ...row.planned, source: "planned" });

/** The colour change across each cut between consecutive rows: signed deltas (incoming minus outgoing) and hard / soft / matched. */
export function colourCuts(rows) {
	return rows.slice(1).map((row, k) => {
		const a = toneOf(rows[k]), b = toneOf(row), luminance = r3(b.luminance - a.luminance), warmth = r3(b.warmth - a.warmth);
		const hard = Math.abs(luminance) >= COLOUR_CUT_LIMITS.hardLuminance || Math.abs(warmth) >= COLOUR_CUT_LIMITS.hardWarmth;
		const kind = hard ? "hard" : Math.abs(luminance) + Math.abs(warmth) >= COLOUR_CUT_LIMITS.soft ? "soft" : "matched";
		return { cutFrame: row.startFrame, from: rows[k].shotId, to: row.shotId, index: row.index, luminance, warmth, kind, source: a.source === "measured" && b.source === "measured" ? "measured" : "planned" };
	});
}

const deltaWords = (cut) => `${cut.luminance >= 0 ? "brighter" : "darker"} by ${Math.abs(cut.luminance).toFixed(2)}, ${cut.warmth >= 0 ? "warmer" : "colder"} by ${Math.abs(cut.warmth).toFixed(2)}`;
/** One cut in words ("hard colour cut into 3: darker by 0.31, colder by 0.42 (measured)"). */
export const colourCutWords = (cut) => `${cut.kind === "matched" ? "matched colour" : `${cut.kind} colour cut`} into ${cut.index}: ${deltaWords(cut)} (${cut.source})`;

/**
 * @param {{ shots, stage?, storyBeats? }} document  the shots (time order is taken here), the stage { lighting, keyLight } they play on, the story beats
 * @param {{ range?: { shotIds } | { from, to }, measured?: Record<string, object> }} [options]  measured: measurePalette answers by shot id
 * @returns {{ version, shots: Array, cuts: Array, beats: Array, hardCuts: number }}
 */
export function colourScript(document, { range = null, measured = {} } = {}) {
	const sorted = [...(document.shots ?? [])].filter((shot) => Number.isInteger(shot.startFrame) && Number.isInteger(shot.endFrame)).sort((a, b) => a.startFrame - b.startFrame);
	const picked = Array.isArray(range?.shotIds) && range.shotIds.length ? sorted.filter((shot) => range.shotIds.includes(shot.id))
		: sorted.slice(Math.max(1, range?.from ?? 1) - 1, Math.min(sorted.length, range?.to ?? sorted.length));
	const stage = document.stage ?? {};
	const rows = picked.map((shot, i) => {
		const look = shot.look ?? null, label = look?.recipe ? lookRecipe(look.recipe)?.label ?? null : null, merged = mergeShotLook(stage, look);
		return { index: i + 1, shotId: shot.id, shotName: shot.name ?? shot.id, startFrame: shot.startFrame, endFrame: shot.endFrame, middleFrame: Math.floor((shot.startFrame + shot.endFrame) / 2),
			look, words: shotLookWords(look, { label }), intended: look?.palette ?? null, planned: plannedTone(merged), key: keyHex(merged.keyLight), measured: measured[shot.id] ?? null };
	});
	const span = rows.length ? [rows[0].startFrame, rows.at(-1).endFrame] : null;
	const beats = span ? (document.storyBeats ?? []).filter((beat) => beat.frame >= span[0] && beat.frame <= span[1]).map(({ id, frame, kind, label }) => ({ id, frame, kind, label })) : [];
	const cuts = colourCuts(rows);
	return { version: COLOUR_SCRIPT_VERSION, shots: rows, cuts, beats, hardCuts: cuts.filter((cut) => cut.kind === "hard").length };
}

/** The colour script in one line for receipts and the packet ("3 shots, 2 with a look; 1 hard colour cut: ..."). */
export function colourScriptWords(script) {
	const looked = script.shots.filter((row) => row.look).length, hard = script.cuts.filter((cut) => cut.kind === "hard");
	return `${script.shots.length} ${script.shots.length === 1 ? "shot" : "shots"}, ${looked} with a look; ${hard.length} hard colour ${hard.length === 1 ? "cut" : "cuts"}${hard.length ? `: ${hard.slice(0, 2).map(colourCutWords).join("; ")}` : ""}.`;
}
