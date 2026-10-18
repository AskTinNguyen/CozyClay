// The walk's hips height (walk.js): as high as the legs on the ground allow with the knee a person keeps
// through stance. The leg reaching for the floor straightens in terminal swing (REACH_IN periods before its
// strike); nearly straight at the heel strike, it gives a little as the weight comes on (loading response)
// and is nearly straight again by mid-stance; a leg whose heel is already up bends its knee more and more for
// the push-off (pre-swing, KNEE_TRAIL at heel-off to KNEE_TOEOFF at lift-off), so it folds into the swing
// instead of snapping from straight. The legs' limits meet in a soft minimum. A limit jumps where a foot leaves
// the floor (the trailing leg reaches far back to its toe-off, then swings free), so a key takes the lowest
// nearby limit plus what the hips can rise or fall in the frames between (ACCEL, m/frame^2): they dip
// through the toe-off and come back up over a few frames.
// The hips are keyed every frame from that curve, smoothed under it. They then rise and fall by themselves.
import { bakeChannels } from "./channels.js";
import { sub, len, apply, ry, rz } from "./math.js";

// knee flexion (deg) the stance schedule keeps: at the strike, the loading peak (LOAD_SPAN periods after it),
// mid-stance, and a heel-up trailing leg's from heel-off to lift-off; a quick walk (period down to FAST frames
// from SLOW) bends them FAST_MORE further, as a person's knees give more the faster they walk
const KNEE_STRIKE = 6, KNEE_LOAD = 10, KNEE_MID = 6, KNEE_TRAIL = 3, KNEE_TOEOFF = 30, LOAD_SPAN = 0.75;
const SLOW = 13, FAST = 9, FAST_MORE = { strike: 4, load: 4, mid: 6, toeOff: 10 };
const SOFT = 0.004, EASE = 8, BELOW_STAND = 0.008, REACH_IN = 0.35, MARGIN = 0.001, PASSES = 6, BLUR = 1.5, ACCEL = 0.008, NEAR = 8;

/**
 * Appends a root key per frame between f0 and end to `out` (the walk's keys). ground: per foot, its spans on
 * the ground, { a, b, strike, heel }: from a (a heel strike, or f0) to b (its lift-off), heel the frame its
 * heel starts up before that lift; start the src of keys before the first step. The keys keep the root's path across the
 * floor; only its height changes.
 */
export function fitPelvis(sk, out, { f0, end, period, ground, start }) {
	const I = sk.index, P = sk.restWorldPos;
	const a = len(sub(P[I.LeftLeg], P[I.LeftUpLeg])), b = len(sub(P[I.LeftFoot], P[I.LeftLeg]));
	const reach = deg => Math.sqrt(a * a + b * b + 2 * a * b * Math.cos((deg * Math.PI) / 180));
	const hipOff = { l: sub(P[I.LeftUpLeg], P[I.Hips]), r: sub(P[I.RightUpLeg], P[I.Hips]) };
	const lead = Math.max(2, Math.round(REACH_IN * period)), q = Math.min(1, Math.max(0, (SLOW - period) / (SLOW - FAST)));
	const strike = KNEE_STRIKE + q * FAST_MORE.strike, load = KNEE_LOAD + q * FAST_MORE.load, mid = KNEE_MID + q * FAST_MORE.mid, toeOff = KNEE_TOEOFF + q * FAST_MORE.toeOff;
	const knee = (g, f) => {
		if (f < g.a) return strike;
		if (g.heel !== undefined && f >= g.heel) return Math.max(mid, KNEE_TRAIL + (toeOff - KNEE_TRAIL) * ((f - g.heel) / Math.max(1, g.b - g.heel)) ** 2);
		const s = (f - g.a) / period;
		return g.strike && s < LOAD_SPAN ? strike + (load - strike) * Math.sin((Math.PI * s) / LOAD_SPAN) : mid;
	};
	const ch = bakeChannels(out, end + 1), top = P[I.Hips][1] - BELOW_STAND;
	// the highest the hips may be at frame f, eased in from the pose before the walk and out into the stand after it
	const limit = f => {
		const root = ch.root[f], yaw = ch.yaw?.[f] ?? 0, roll = ch.roll?.[f] ?? 0, ys = [];
		for (const k of ["l", "r"]) {
			const g = ground[k].find(x => f >= x.a - (x.strike ? lead : 0) && f <= x.b);
			if (!g) continue;
			const ankle = ch[`foot_${k}`][f], off = apply(ry(yaw), apply(rz(roll), hipOff[k]));
			const d = reach(knee(g, f)), dh = Math.hypot(root[0] + off[0] - ankle[0], root[2] + off[2] - ankle[2]);
			if (dh < d) ys.push(ankle[1] + Math.sqrt(d * d - dh * dh) - off[1]);
		}
		if (!ys.length) return root[1];
		const m = Math.min(...ys), fit = Math.min(top, m - SOFT * Math.log(ys.reduce((s, y) => s + Math.exp(-(y - m) / SOFT), 0))) - MARGIN;
		const t = Math.min(1, (f - f0) / EASE, (end - f) / EASE), w = t * t * (3 - 2 * t);
		return root[1] + (fit - root[1]) * w;
	};
	const lim = [], low = [];
	for (let f = f0; f <= end; f++) lim[f] = limit(f);
	for (let f = f0 + 1; f < end; f++) {
		low[f] = lim[f];
		for (let g = Math.max(f0 + 1, f - NEAR); g <= Math.min(end - 1, f + NEAR); g++) low[f] = Math.min(low[f], lim[g] + (ACCEL / 2) * (f - g) ** 2);
	}
	// smoothed under the eroded limit: each pass blurs the curve and clips it back under, so it rounds every kink
	// and never rises past a leg's limit
	let y = low.slice();
	for (let pass = 0; pass < PASSES; pass++) {
		const blur = y.slice();
		for (let f = f0 + 1; f < end; f++) {
			let sum = 0, w = 0;
			for (let d = -Math.ceil(3 * BLUR); d <= Math.ceil(3 * BLUR); d++) { const g = f + d; if (g <= f0 || g >= end) continue; const k = Math.exp(-(d * d) / (2 * BLUR * BLUR)); sum += k * y[g]; w += k; }
			blur[f] = Math.min(low[f], sum / w);
		}
		y = blur;
	}
	// each key names the step it falls in, so QA's causes and hints still point at that step of the walk
	const steps = out.filter(k => / step \d+$/.test(k.src ?? "")).sort((p, q) => p.f - q.f);
	let i = 0, src = start;
	for (let f = f0 + 1; f < end; f++) {
		while (i < steps.length && steps[i].f <= f) src = steps[i++].src;
		out.push({ f, set: { root: [ch.root[f][0], y[f], ch.root[f][2]] }, src });
	}
}
