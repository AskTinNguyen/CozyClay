// The intensity curve's formulas and weights (intensity-curve D1): every
// component the curve reads, how its measure is normalised to 0-1, and the
// weight it carries in the combined value. The curve (curve.js) and the
// structure rules (structure.js) read these and nothing else, so a later
// intent tunes the curve here, with a changelog line below, without touching
// the rules. A later component (colour-script's tone) is one more row.
//
// Changelog:
// - v1 (intensity-curve rev 1): seven camera components, weights sum to 1.
// - v2 (colour-script rev 1): the tone component (TONE_COMPONENT), weight 0.1,
//   counted only when a shot in the range carries a look (or the caller hands
//   measured tones); then the combined value is the weighted mean over eight.
//   Without it every value is v1's.
//
// Pure data and arithmetic: no DOM, no three.js.

export const INTENSITY_VERSION = 2;

const clamp01 = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

/**
 * One row per component, in the order the curve lists them.
 *   id       the key in every shot's `components` and every cut's `contrast`
 *   label    the word the strip and the receipts use
 *   formula  the normalisation in words (docs and receipts quote it)
 *   weight   its share of the combined value
 *   value(raw)  raw measure -> 0..1 (1 is the most intense)
 * Size, height, lens and roll are read at the shot's first and last frame; the
 * shot's value is the mean of its two ends.
 */
export const INTENSITY_COMPONENTS = Object.freeze([
	{ id: "size", label: "size", weight: 0.3,
		formula: "tightness on the size ladder: (6 - rung) / 6, rung 0 = extreme close-up, 6 = extreme wide shot",
		value: (raw) => clamp01((6 - raw.rung) / 6) },
	{ id: "height", label: "height", weight: 0.1,
		formula: "the camera's angle above or below the subject's eyes: |elevation degrees| / 45",
		value: (raw) => clamp01(Math.abs(raw.elevationDeg) / 45) },
	{ id: "focal", label: "lens", weight: 0.15,
		formula: "focal length on a log scale: ln(mm / 18) / ln(135 / 18), 18 mm = 0, 135 mm = 1",
		value: (raw) => clamp01(Math.log(raw.focalMm / 18) / Math.log(135 / 18)) },
	{ id: "speed", label: "movement", weight: 0.15,
		formula: "the camera's fastest rate while it moves (measureShotCamera): max(m/s / 1.5, pan °/s / 60, tilt °/s / 60, zoom mm/s / 30)",
		value: (raw) => clamp01(Math.max(raw.speedMps / 1.5, Math.abs(raw.panDps) / 60, Math.abs(raw.tiltDps) / 60, Math.abs(raw.zoomMmps) / 30)) },
	{ id: "cutting", label: "cutting", weight: 0.15,
		formula: "shot length as cutting rate: (6 - seconds) / 5, 1 s or shorter = 1, 6 s or longer = 0",
		value: (raw) => clamp01((6 - raw.seconds) / 5) },
	{ id: "roll", label: "roll", weight: 0.05,
		formula: "the horizon's roll: |degrees| / 20",
		value: (raw) => clamp01(Math.abs(raw.rollDeg) / 20) },
	{ id: "screen", label: "screen jump", weight: 0.1,
		formula: "how far the subject's eyes jump across the frame at the cut into the shot: |screen x change| / 0.5 (frame widths); the first shot 0",
		value: (raw) => clamp01(Math.abs(raw.screenJump) / 0.5) },
]);

export const INTENSITY_COMPONENT_IDS = Object.freeze(INTENSITY_COMPONENTS.map((row) => row.id));

/**
 * The tone component (colour-script A6): how far a shot's colour sits from a
 * neutral mid-key, from its measured palette or its look's planned tone
 * (colour-script/script.js plannedTone). Its cut contrast is the colour change
 * itself, so a warm-to-cold cut at one brightness still counts.
 */
export const TONE_COMPONENT = Object.freeze({ id: "tone", label: "tone", weight: 0.1,
	formula: "low key and colour push: 0.7 x (1 - luminance) + 0.3 x |warmth|; at a cut: (|luminance change| + |warmth change|) / 0.6",
	value: (raw) => clamp01(0.7 * (1 - raw.luminance) + 0.3 * Math.abs(raw.warmth)),
	cut: (a, b) => clamp01((Math.abs(b.luminance - a.luminance) + Math.abs(b.warmth - a.warmth)) / 0.6) });

/**
 * How a cut's contrast reads per component: the jump between the outgoing shot's
 * last frame and the incoming shot's first frame (size, height, lens, roll), the
 * change in rate (movement, cutting), and the screen jump itself.
 */
export const CUT_JUMP = Object.freeze({ size: "ends", height: "ends", focal: "ends", roll: "ends", speed: "shots", cutting: "shots", screen: "incoming" });

/** The thresholds the structure rules read (structure.js). */
export const STRUCTURE_LIMITS = Object.freeze({
	flatShots: 3, // flat: this many shots in a row or more ...
	flatContrast: 0.08, // ... with every cut between them under this total contrast
	buildMin: 0.03, // no-build: the beat's shot must sit at least this much above the shot before it
	peakSlack: 0.01, // peak-off-beat: a shot this close to the peak counts as a peak too
});

/** The story beats a build must rise into (no-build), and how strong each kind is (peak-off-beat: the strongest beat). */
export const BUILD_KINDS = Object.freeze(["reveal", "threat", "decision"]);
export const BEAT_STRENGTH = Object.freeze({ threat: 3, reveal: 3, decision: 3, disclosure: 2, event: 1, input: 1 });

/** The combined value: the weighted sum of the components (weights sum to 1), over the components given (tone among them when the curve is toned). */
export function combine(components, ids = INTENSITY_COMPONENT_IDS) {
	const rows = [...INTENSITY_COMPONENTS, TONE_COMPONENT].filter((row) => ids.includes(row.id));
	const total = rows.reduce((sum, row) => sum + row.weight, 0);
	return total > 0 ? rows.reduce((sum, row) => sum + row.weight * (components[row.id] ?? 0), 0) / total : 0;
}
