// Retime (spec.fix.retime): where a joint moves faster than QA's speed or acceleration limit,
// the key intervals around it get longer, borrowing the frames from the neighbouring key
// intervals of the same window (slower or held stretches get shorter). Interpolation between
// keys scales with their spacing, so each interval is stretched by its own peak excess. The
// frame count and every key outside the windows stay where they are; the time map is kept on
// out.timeMap so frame-range checks follow.
import { dist, sub, len } from "../compiler/math.js";
import { QA_LIMITS, SPEED_JOINTS } from "../qa/checks.js";

const HEADROOM = 1.1, MIN_RATE = 0.35, PASSES = 3;

/** e[i] = how many times too fast frame i is (speed ratio, or sqrt of the acceleration ratio). */
function excess(out) {
	const I = out.ctx.sk.index, F = out.frames, e = new Float64Array(F.length);
	for (const j of SPEED_JOINTS) {
		const core = j === "Hips" || j === "Head", vl = core ? QA_LIMITS.speedCore : QA_LIMITS.speedLimb, al = core ? QA_LIMITS.accCore : QA_LIMITS.accLimb;
		const X = F.map(fr => fr.s.P[I[j]]);
		for (let i = 1; i < F.length; i++) {
			e[i] = Math.max(e[i], dist(X[i], X[i - 1]) / vl);
			if (i > 1) e[i] = Math.max(e[i], Math.sqrt(len(sub(sub(X[i], X[i - 1]), sub(X[i - 1], X[i - 2]))) / al));
		}
	}
	return e;
}

/** Windows [a, b] (key frames) around each run of too-fast frames, merged where they overlap. */
function windows(e, keyFrames, n) {
	const out = [];
	for (let i = 1; i < n; i++) {
		if (e[i] <= 1) continue;
		let j = i;
		while (j + 1 < n && e[j + 1] > 1) j++;
		const w = Math.max(6, 2 * (j - i + 1));
		const a = Math.max(0, ...keyFrames.filter(f => f <= i - 1 - w)), b = Math.min(n - 1, ...keyFrames.filter(f => f >= j + w));
		if (out.length && a <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
		else out.push([a, b]);
		i = j;
	}
	return out;
}

/** New times for the breakpoints of window [a, b]: each interval scaled by max(peak excess, alpha). */
function spread(e, cuts) {
	const total = cuts[cuts.length - 1] - cuts[0];
	const segs = cuts.slice(1).map((k, i) => { let m = 0; for (let f = Math.floor(cuts[i]) + 1; f <= Math.ceil(k); f++) m = Math.max(m, e[f] ?? 0); return { len: k - cuts[i], need: HEADROOM * m }; });
	const sum = alpha => segs.reduce((acc, s) => acc + s.len * Math.max(s.need, alpha), 0);
	let lo = MIN_RATE, hi = 1;
	for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (sum(mid) > total) hi = mid; else lo = mid; }
	const dur = segs.map(s => s.len * Math.max(s.need, lo)), scale = total / dur.reduce((acc, d) => acc + d, 0);
	const T = [cuts[0]];
	dur.forEach((d, i) => T.push(T[i] + d * scale));
	T[T.length - 1] = cuts[cuts.length - 1];
	return { T, stretch: Math.max(...dur.map((d, i) => (d * scale) / segs[i].len)) };
}

export function retime(out, engine) {
	const n = out.frames.length, maps = [];
	let segments = 0, stretch = 1;
	for (let pass = 0; pass < PASSES; pass++) {
		const e = excess(out), keyFrames = [...new Set(out.keys.map(k => k.f))].sort((p, q) => p - q);
		const wins = windows(e, keyFrames, n);
		if (!wins.length) break;
		const pieces = wins.map(([a, b]) => {
			const cuts = [...new Set([a, ...keyFrames.filter(f => f > a && f < b), b])].sort((p, q) => p - q), r = spread(e, cuts);
			stretch = Math.max(stretch, r.stretch);
			return { cuts, T: r.T };
		});
		segments += wins.length;
		const map = f => {
			for (const { cuts, T } of pieces) {
				if (f < cuts[0] || f > cuts[cuts.length - 1]) continue;
				let i = 0;
				while (i < cuts.length - 2 && f > cuts[i + 1]) i++;
				return T[i] + (T[i + 1] - T[i]) * (f - cuts[i]) / (cuts[i + 1] - cuts[i]);
			}
			return f;
		};
		maps.push(map);
		engine.rebake(out.keys.map(k => ({ ...k, f: map(k.f) })));
		engine.solve(engine.all());
	}
	if (!maps.length) return null;
	out.timeMap = f => maps.reduce((x, m) => m(x), f);
	const left = excess(out).filter(x => x > 1).length;
	return { windows: segments, maxStretch: Math.round(stretch * 100) / 100, stillFast: left, how: "key intervals around speed spikes stretched" };
}
