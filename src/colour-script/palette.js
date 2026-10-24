// The measured palette (colour-script A2, D2): a pure function of an RGBA
// buffer, like studio-contact-sheet.js, so the same pixels always give the same
// palette. Pixels are sampled on a fixed grid, binned at 4 bits a channel, and
// the most common bins that sit apart from each other become the swatches;
// every bin then joins its nearest swatch, whose colour is the mean of its
// pixels and whose share is their fraction. Alongside: the mean luminance
// (Rec. 709 luma of the sRGB values), the warmth (mean (R - B) / 255, -1 cold
// to 1 warm) and the saturation (mean HSV saturation). Row order does not
// matter, so a WebGL read-back (rows bottom-up) measures as it is.
// No DOM, no three.js.

const PALETTE_VERSION = 1;
const MAX_SAMPLES = 40000;
const SEPARATION = 56; // two swatches sit at least this far apart in sRGB (0-255 a channel)
const r3 = (value) => Math.round(value * 1000) / 1000 + 0;
const hexOf = (r, g, b) => `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("")}`;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * @param {Uint8Array|Uint8ClampedArray} rgba  width * height * 4 bytes
 * @param {number} width
 * @param {number} height
 * @param {{ count?: number }} [options]  count: the most swatches to return (default 5)
 * @returns {{ version, swatches: Array<{ hex, share }>, dominant, meanLuminance, warmth, saturation, samples }}
 */
export function measurePalette(rgba, width, height, { count = 5 } = {}) {
	const pixels = Math.max(0, Math.floor(width) * Math.floor(height));
	if (!rgba || pixels === 0 || rgba.length < pixels * 4) return { version: PALETTE_VERSION, swatches: [], dominant: null, meanLuminance: 0, warmth: 0, saturation: 0, samples: 0 };
	const step = Math.max(1, Math.floor(Math.sqrt(pixels / MAX_SAMPLES)));
	const bins = new Map();
	let samples = 0, luma = 0, warm = 0, sat = 0;
	for (let y = 0; y < height; y += step) {
		for (let x = 0; x < width; x += step) {
			const i = (y * width + x) * 4, r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
			const max = Math.max(r, g, b), min = Math.min(r, g, b);
			samples += 1;
			luma += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
			warm += (r - b) / 255;
			sat += max ? (max - min) / max : 0;
			const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4), bin = bins.get(key);
			if (bin) { bin.n += 1; bin.r += r; bin.g += g; bin.b += b; } else bins.set(key, { key, n: 1, r, g, b });
		}
	}
	// Most common first; equal counts by bin index, so the order never depends on the Map.
	const ranked = [...bins.values()].map((bin) => ({ ...bin, mean: [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n] })).sort((a, b) => b.n - a.n || a.key - b.key);
	const seeds = [];
	for (const bin of ranked) {
		if (seeds.length >= count) break;
		if (seeds.every((seed) => distance(seed.mean, bin.mean) >= SEPARATION)) seeds.push(bin);
	}
	const groups = seeds.map(() => ({ n: 0, r: 0, g: 0, b: 0 }));
	for (const bin of ranked) {
		let best = 0;
		for (let k = 1; k < seeds.length; k++) if (distance(seeds[k].mean, bin.mean) < distance(seeds[best].mean, bin.mean)) best = k;
		const group = groups[best];
		group.n += bin.n; group.r += bin.r; group.g += bin.g; group.b += bin.b;
	}
	const swatches = groups.map((group) => ({ hex: hexOf(group.r / group.n, group.g / group.n, group.b / group.n), share: r3(group.n / samples) }))
		.sort((a, b) => b.share - a.share || a.hex.localeCompare(b.hex));
	return { version: PALETTE_VERSION, swatches, dominant: swatches[0]?.hex ?? null, meanLuminance: r3(luma / samples), warmth: r3(warm / samples), saturation: r3(sat / samples), samples };
}
