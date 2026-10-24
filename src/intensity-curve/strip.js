// The intensity strip (intensity-curve A3, A4) as pure data: one layout that
// both the timeline strip (an SVG) and the exported image draw. x follows the
// timeline's frame scale (frame / (frameCount - 1), as the Shots lane places
// its blocks), y is intensity 0 (bottom) to 1 (top). The combined curve and
// each shown component are steps across their shots; story beats are ticks;
// flagged stretches are bands. stripImage rasterises the same layout into an
// RGBA buffer (rows top-down) that an encoder turns into a PNG: the picture
// director-packet carries. No DOM, no three.js.
import { INTENSITY_COMPONENT_IDS } from "./weights.js";

export const STRIP_SIZE = Object.freeze({ width: 960, height: 160 });
export const STRIP_COLORS = Object.freeze({
	combined: "#f2f2f5", size: "#e8a33d", height: "#5ec4a8", focal: "#7aa7ff", speed: "#d873d0", cutting: "#f07a5a", roll: "#b6c35a", screen: "#9b8cff",
	beat: "#5ec4a8", flat: "#f5b453", "peak-off-beat": "#d65f55", "no-build": "#d65f55", cut: "#3a3a42", background: "#16181d",
});
const r2 = (value) => Math.round(value * 100) / 100;

/**
 * @param {object} curve  sequenceIntensity's answer
 * @param {{ width?, height?, frameCount?, components?: string[], beats?: Array, issues?: Array, pad?: number }} [options]
 *   frameCount: the timeline's frame count (default: the curve's last frame + 1); components: the ones drawn beside the combined curve
 * @returns {{ width, height, frameCount, series: Array<{ id, color, points: number[][] }>, beats: Array, flags: Array, cuts: number[] }}
 */
export function stripLayout(curve, { width = STRIP_SIZE.width, height = STRIP_SIZE.height, frameCount = null, components = [], beats = [], issues = [], pad = 6 } = {}) {
	const shots = curve.shots, count = frameCount ?? (shots.length ? shots.at(-1).endFrame + 1 : 1);
	const x = (frame) => r2((count > 1 ? frame / (count - 1) : 0) * width), y = (value) => r2(pad + (1 - value) * (height - 2 * pad));
	const steps = (value) => shots.flatMap((row) => [[x(row.startFrame), y(value(row))], [x(row.endFrame), y(value(row))]]);
	const shown = INTENSITY_COMPONENT_IDS.filter((id) => components.includes(id));
	return {
		width, height, frameCount: count,
		series: [...shown.map((id) => ({ id, color: STRIP_COLORS[id], points: steps((row) => row.components[id]) })), { id: "combined", color: STRIP_COLORS.combined, points: steps((row) => row.combined) }],
		beats: beats.map((beat) => ({ id: beat.id, x: x(beat.frame), frame: beat.frame, kind: beat.kind, label: beat.label })),
		flags: issues.map((issue) => ({ rule: issue.rule, x0: x(issue.frames[0]), x1: x(issue.frames[1]), color: STRIP_COLORS[issue.rule], severity: issue.severity })),
		cuts: shots.slice(1).map((row) => x(row.startFrame)),
	};
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * The strip as an image: { data (RGBA, rows top-down), width, height, layout }. Flag bands under
 * everything, then cut lines, beat ticks, the component lines (1 px) and the combined curve (2 px).
 */
export function stripImage(curve, options = {}) {
	const layout = stripLayout(curve, options), { width, height } = layout, data = new Uint8Array(width * height * 4);
	const put = (px, py, [r, g, b], alpha = 1) => {
		const xi = Math.round(px), yi = Math.round(py);
		if (xi < 0 || yi < 0 || xi >= width || yi >= height) return;
		const i = (yi * width + xi) * 4;
		data[i] = Math.round(data[i] + (r - data[i]) * alpha); data[i + 1] = Math.round(data[i + 1] + (g - data[i + 1]) * alpha); data[i + 2] = Math.round(data[i + 2] + (b - data[i + 2]) * alpha); data[i + 3] = 255;
	};
	const background = rgb(STRIP_COLORS.background);
	for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) put(px, py, background);
	for (const flag of layout.flags) for (let px = Math.floor(flag.x0); px <= Math.ceil(flag.x1); px++) for (let py = 0; py < height; py++) put(px, py, rgb(flag.color), 0.18);
	for (const cut of layout.cuts) for (let py = 0; py < height; py++) put(cut, py, rgb(STRIP_COLORS.cut));
	for (const beat of layout.beats) for (let py = 0; py < height; py++) put(beat.x, py, rgb(STRIP_COLORS.beat), py % 4 < 2 ? 0.9 : 0.35);
	for (const series of layout.series) {
		const color = rgb(series.color), thick = series.id === "combined";
		for (let i = 1; i < series.points.length; i++) {
			const [x0, y0] = series.points[i - 1], [x1, y1] = series.points[i], n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
			for (let k = 0; k <= n; k++) {
				const px = x0 + ((x1 - x0) * k) / n, py = y0 + ((y1 - y0) * k) / n;
				put(px, py, color, thick ? 1 : 0.8);
				if (thick) { put(px, py + 1, color); put(px + 1, py, color); }
			}
		}
	}
	return { data, width, height, layout };
}
