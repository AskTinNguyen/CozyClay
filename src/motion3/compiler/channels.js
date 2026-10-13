// Keyed channels -> per-frame values. A channel is interpolated only through the keys that
// set it (monotone cubic / PCHIP, so a held value never overshoots); before its first key and
// after its last it holds. Numbers, number arrays and {preset: weight} objects are supported.
// `step` keys jump at that frame (visibility switches and the like).

function pchipSlopes(x, y) {
	const n = y.length, m = new Array(n).fill(0);
	for (let i = 1; i < n - 1; i++) {
		const h0 = x[i] - x[i - 1], h1 = x[i + 1] - x[i];
		const d0 = (y[i] - y[i - 1]) / h0, d1 = (y[i + 1] - y[i]) / h1;
		if (d0 * d1 > 0) {
			const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
			m[i] = (w1 + w2) / (w1 / d0 + w2 / d1);
		}
	}
	return m;
}

function pchipEval(x, y, m, q) {
	if (x.length === 1 || q <= x[0]) return y[0];
	if (q >= x[x.length - 1]) return y[y.length - 1];
	let i = 0;
	while (q > x[i + 1]) i++;
	const h = x[i + 1] - x[i], t = (q - x[i]) / h;
	const t2 = t * t, t3 = t2 * t;
	return (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h * m[i + 1];
}

const shapeOf = v => (Array.isArray(v) ? "vec" : v && typeof v === "object" ? "map" : "num");

/** keys: [{ f, set: { channel: value }, step?: [channel...] }] -> { channel: Array(frameCount) } */
export function bakeChannels(keys, frameCount) {
	const byChannel = new Map();
	for (const key of [...keys].sort((a, b) => a.f - b.f)) {
		for (const [ch, value] of Object.entries(key.set ?? {})) {
			if (!byChannel.has(ch)) byChannel.set(ch, []);
			byChannel.get(ch).push({ f: key.f, value, step: key.step?.includes(ch) });
		}
	}
	const out = {};
	for (const [ch, list] of byChannel) {
		// later keys at the same frame win
		const pts = [...new Map(list.map(k => [k.f, k])).values()];
		const shape = shapeOf(pts[0].value);
		const comps = shape === "vec" ? pts[0].value.length : 0;
		const series = shape === "num" ? [pts.map(p => p.value)]
			: shape === "vec" ? Array.from({ length: comps }, (_, i) => pts.map(p => p.value[i]))
				: [...new Set(pts.flatMap(p => Object.keys(p.value)))].map(name => ({ name, y: pts.map(p => p.value[name] ?? 0) }));
		const x = pts.map(p => p.f);
		const evalSeries = y => {
			const m = pchipSlopes(x, y);
			return f => {
				// a step key holds the previous value right up to its frame
				for (let i = 1; i < pts.length; i++) if (pts[i].step && f >= x[i - 1] && f < x[i]) return y[i - 1];
				return pchipEval(x, y, m, f);
			};
		};
		const frames = new Array(frameCount);
		if (shape === "num") { const e = evalSeries(series[0]); for (let f = 0; f < frameCount; f++) frames[f] = e(f); }
		else if (shape === "vec") { const es = series.map(evalSeries); for (let f = 0; f < frameCount; f++) frames[f] = es.map(e => e(f)); }
		else {
			const es = series.map(({ name, y }) => [name, evalSeries(y)]);
			for (let f = 0; f < frameCount; f++) frames[f] = Object.fromEntries(es.map(([n, e]) => [n, e(f)]));
		}
		out[ch] = frames;
	}
	return out;
}

/** Frame f's channel dict. */
export const channelsAt = (baked, f) => Object.fromEntries(Object.entries(baked).map(([k, v]) => [k, v[f]]));
