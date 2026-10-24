// The colour script as a picture (colour-script A3): one column per shot, in
// time order. The top band stacks the measured swatches by their share (or, for
// a shot not measured, its planned key colour dimmed); the middle band is the
// intended palette, one slice a swatch; the bottom band is the tone, grey at
// the shot's luminance with its warmth as a warm or cold edge. A hard colour
// cut is a red rule between columns, a soft one amber; story beats are dashed
// ticks at their frame within the shot. stripLayout-style: one layout the
// dialog draws and stripImage-style RGBA rows top-down that an encoder turns
// into packet/colour-script.png. No DOM, no three.js.
import { mixHex } from "../stage-shot-look.js";

const COLOUR_SCRIPT_SIZE = Object.freeze({ width: 960, height: 200 });
const COLOUR_SCRIPT_COLORS = Object.freeze({ background: "#16181d", hard: "#ff5a4a", soft: "#f5b453", beat: "#5ec4a8", warm: "#ff9a4a", cold: "#6aa0ff", empty: "#24262d" });
const BANDS = Object.freeze({ measured: [0, 0.56], intended: [0.6, 0.84], tone: [0.88, 1] });
const r2 = (value) => Math.round(value * 100) / 100;
const grey = (value) => { const c = Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, "0"); return `#${c}${c}${c}`; };

/**
 * @param {object} script  colourScript's answer
 * @param {{ width?, height?, gap? }} [options]
 * @returns {{ width, height, columns: Array<{ shotId, x0, x1, rects: Array<{ x0, y0, x1, y1, color }> }>, cuts: Array<{ x, kind, color }>, beats: Array<{ x, id }> }}
 */
function colourScriptLayout(script, { width = COLOUR_SCRIPT_SIZE.width, height = COLOUR_SCRIPT_SIZE.height, gap = 3 } = {}) {
	const n = Math.max(1, script.shots.length), colW = width / n, y = (band, k) => r2(BANDS[band][k] * height);
	const columns = script.shots.map((row, i) => {
		const x0 = r2(i * colW + (i ? gap / 2 : 0)), x1 = r2((i + 1) * colW - (i < n - 1 ? gap / 2 : 0)), rects = [];
		if (row.measured?.swatches?.length) {
			let top = y("measured", 0);
			const total = row.measured.swatches.reduce((sum, swatch) => sum + swatch.share, 0) || 1;
			row.measured.swatches.forEach((swatch, k, all) => {
				const bottom = k === all.length - 1 ? y("measured", 1) : r2(top + ((y("measured", 1) - y("measured", 0)) * swatch.share) / total);
				rects.push({ x0, y0: top, x1, y1: bottom, color: swatch.hex });
				top = bottom;
			});
		} else rects.push({ x0, y0: y("measured", 0), x1, y1: y("measured", 1), color: mixHex(row.key, COLOUR_SCRIPT_COLORS.background, 0.55) });
		const intended = row.intended?.swatches ?? [];
		if (intended.length) intended.forEach((swatch, k) => rects.push({ x0: r2(x0 + ((x1 - x0) * k) / intended.length), y0: y("intended", 0), x1: r2(x0 + ((x1 - x0) * (k + 1)) / intended.length), y1: y("intended", 1), color: swatch }));
		else rects.push({ x0, y0: y("intended", 0), x1, y1: y("intended", 1), color: COLOUR_SCRIPT_COLORS.empty });
		const tone = row.measured ? { luminance: row.measured.meanLuminance, warmth: row.measured.warmth } : row.planned;
		rects.push({ x0, y0: y("tone", 0), x1, y1: y("tone", 1), color: grey(tone.luminance) });
		const edge = Math.min(x1 - x0, Math.abs(tone.warmth) * (x1 - x0));
		if (edge >= 1) rects.push({ x0, y0: y("tone", 0), x1: r2(x0 + edge), y1: r2(y("tone", 0) + 4), color: tone.warmth >= 0 ? COLOUR_SCRIPT_COLORS.warm : COLOUR_SCRIPT_COLORS.cold });
		return { shotId: row.shotId, x0, x1, rects };
	});
	const cuts = script.cuts.filter((cut) => COLOUR_SCRIPT_COLORS[cut.kind]).map((cut) => ({ x: r2((cut.index - 1) * colW), kind: cut.kind, color: COLOUR_SCRIPT_COLORS[cut.kind] }));
	const beats = script.beats.map((beat) => {
		const i = script.shots.findIndex((row) => beat.frame >= row.startFrame && beat.frame <= row.endFrame), row = script.shots[i];
		return row ? { id: beat.id, x: r2(i * colW + ((beat.frame - row.startFrame + 0.5) / (row.endFrame - row.startFrame + 1)) * colW) } : null;
	}).filter(Boolean);
	return { width, height, columns, cuts, beats };
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The colour script as { data (RGBA rows top-down), width, height, layout }. */
export function colourScriptImage(script, options = {}) {
	const layout = colourScriptLayout(script, options), { width, height } = layout, data = new Uint8Array(width * height * 4);
	const fill = (x0, y0, x1, y1, color, alpha = 1) => {
		const [r, g, b] = rgb(color);
		for (let py = Math.max(0, Math.round(y0)); py < Math.min(height, Math.round(y1)); py++) {
			for (let px = Math.max(0, Math.round(x0)); px < Math.min(width, Math.round(x1)); px++) {
				const i = (py * width + px) * 4;
				data[i] = Math.round(data[i] + (r - data[i]) * alpha); data[i + 1] = Math.round(data[i + 1] + (g - data[i + 1]) * alpha); data[i + 2] = Math.round(data[i + 2] + (b - data[i + 2]) * alpha); data[i + 3] = 255;
			}
		}
	};
	fill(0, 0, width, height, COLOUR_SCRIPT_COLORS.background);
	for (const column of layout.columns) for (const rect of column.rects) fill(rect.x0, rect.y0, rect.x1, rect.y1, rect.color);
	for (const cut of layout.cuts) fill(cut.x - 2, 0, cut.x + 2, height, cut.color);
	for (const beat of layout.beats) for (let py = 0; py < height; py += 6) fill(beat.x - 1, py, beat.x + 1, py + 3, COLOUR_SCRIPT_COLORS.beat, 0.9);
	return { data, width, height, layout };
}
