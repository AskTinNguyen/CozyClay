// Keyed channels -> per-frame values. A channel is interpolated only through the keys that
// set it; before its first key and after its last it holds. Numbers, number arrays and
// {preset: weight} objects are supported. `step` keys jump at that frame (visibility switches
// and the like).
// Flow (spec.flow): the channels that place the body against the world or a target (feet,
// root, yaw, hand targets and weights, poles, fingers, objects) are monotone cubic / PCHIP and on
// time, so a held value never overshoots and a contact lands on its key. The body's own swing
// (FLOW_SMOOTH: spine, head, arm swing and bend, wrist) carries its speed through a key instead of
// stopping on it (Catmull-Rom, the overshoot past a key bounded), and trails the body
// (FLOW_LAG frames: the head behind the body, the arms behind both), the trail easing out over the
// take's last frames so every value is reached. An arm on its IK (armw) reaches for a target, so
// flow is gone by the time the arm is a quarter of the way onto it: an arm's swing and bend by its
// own armw, the spine (which carries the shoulders) and the head (the hands work near it) by the
// larger of the two; a reach or a held prop lands as keyed. A hold (two equal keys in a row) stays
// exactly flat either way.

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

const FLOW_SMOOTH = /^(spine|head)_(yaw|pitch|roll)$|^(aswing|abend)_[lr]$/;
const FLOW_LAG = { spine: 0, head: 2, arms: 3 };
const OVER_FRAC = 0.15, OVER_MAX = 6; // a smooth segment's overshoot: at most this share of its change, and degrees
const ikSides = ch => (/^(spine|head)_/.test(ch) ? ["l", "r"] : /^(aswing|abend)_([lr])$/.test(ch) ? [ch.slice(-1)] : []);
const lagFamily = ch => (/^spine_/.test(ch) ? "spine" : /^head_/.test(ch) ? "head" : /^(aswing|abend)_[lr]$/.test(ch) ? "arms" : null);

/** spec.flow -> { smooth, lag: { spine, head, arms } }: undefined is the default, false turns both off. */
export function flowOptions(flow) {
	if (flow === false) return { smooth: false, lag: { spine: 0, head: 0, arms: 0 } };
	const f = flow ?? {}, lag = f.lag === false ? 0 : f.lag;
	const each = typeof lag === "number" ? { spine: lag, head: lag, arms: lag } : { ...FLOW_LAG, ...(lag ?? {}) };
	return { smooth: f.smooth !== false, lag: each };
}

/** Catmull-Rom slopes, flat at a hold and at the ends, each segment's overshoot bounded. */
function smoothSlopes(x, y) {
	const n = y.length, m = new Array(n).fill(0);
	for (let i = 1; i < n - 1; i++) if (y[i] !== y[i - 1] && y[i] !== y[i + 1]) m[i] = (y[i + 1] - y[i - 1]) / (x[i + 1] - x[i - 1]);
	for (let i = 0; i < n - 1; i++) {
		const h = x[i + 1] - x[i], lo = Math.min(y[i], y[i + 1]), hi = Math.max(y[i], y[i + 1]), limit = Math.min(OVER_MAX, OVER_FRAC * (hi - lo));
		for (let tries = 0; tries < 12; tries++) {
			let over = 0;
			for (let k = 1; k < 16; k++) {
				const v = pchipEval([x[i], x[i + 1]], [y[i], y[i + 1]], [m[i], m[i + 1]], x[i] + (h * k) / 16);
				over = Math.max(over, v - hi, lo - v);
			}
			if (over <= limit + 1e-9) break;
			m[i] *= 0.7; m[i + 1] *= 0.7;
		}
	}
	return m;
}

const shapeOf = v => (Array.isArray(v) ? "vec" : v && typeof v === "object" ? "map" : "num");

/** keys: [{ f, set: { channel: value }, step?: [channel...] }] -> { channel: Array(frameCount) }; flow: flowOptions(spec.flow). */
export function bakeChannels(keys, frameCount, flow = flowOptions()) {
	const byChannel = new Map();
	for (const key of [...keys].sort((a, b) => a.f - b.f)) {
		for (const [ch, value] of Object.entries(key.set ?? {})) {
			if (!byChannel.has(ch)) byChannel.set(ch, []);
			byChannel.get(ch).push({ f: key.f, value, step: key.step?.includes(ch) });
		}
	}
	const out = {}, plain = {};
	for (const [ch, list] of byChannel) {
		// later keys at the same frame win
		const pts = [...new Map(list.map(k => [k.f, k])).values()];
		const shape = shapeOf(pts[0].value);
		const comps = shape === "vec" ? pts[0].value.length : 0;
		const series = shape === "num" ? [pts.map(p => p.value)]
			: shape === "vec" ? Array.from({ length: comps }, (_, i) => pts.map(p => p.value[i]))
				: [...new Set(pts.flatMap(p => Object.keys(p.value)))].map(name => ({ name, y: pts.map(p => p.value[name] ?? 0) }));
		const x = pts.map(p => p.f), smooth = flow.smooth && FLOW_SMOOTH.test(ch), lag = flow.lag[lagFamily(ch)] ?? 0;
		// the trail eases out over the last 2 * lag frames, so the take ends on the last value
		const at = f => (lag > 0 ? f - lag * Math.min(1, (frameCount - 1 - f) / (2 * lag)) : f);
		const evalSeries = (y, flowing = true) => {
			const m = smooth && flowing ? smoothSlopes(x, y) : pchipSlopes(x, y);
			return q => {
				const f = flowing ? at(q) : q;
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
		if (shape === "num" && (smooth || lag > 0) && ikSides(ch).length) { const e = evalSeries(series[0], false); plain[ch] = Array.from({ length: frameCount }, (_, f) => e(f)); }
	}
	// flow fades out as the arm goes onto its IK (the spine with either arm)
	for (const [ch, keyed] of Object.entries(plain)) {
		const ws = ikSides(ch).map(k => out[`armw_${k}`]).filter(Boolean);
		if (!ws.length) continue;
		out[ch] = out[ch].map((v, f) => { const w = Math.min(1, 4 * Math.max(0, ...ws.map(a => a[f]))); return v + (keyed[f] - v) * w * (2 - w); });
	}
	return out;
}

/** Frame f's channel dict. */
export const channelsAt = (baked, f) => Object.fromEntries(Object.entries(baked).map(([k, v]) => [k, v[f]]));
