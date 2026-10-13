// Generators expand into ordinary keys before baking. "walk" plans footsteps along a curving
// path from the pose the earlier keys leave at f0: weight shift over the stance foot, pelvis
// bob and twist, toe-off, arm swing, feet together at the end.
//
// { type: "walk", f0, steps: 8, step: 0.5, period: 20, swing: 14, halfWidth: 0.1, lift: 0.08,
//   heading: [h0, h1], turnDistance: 0.4, pelvisHigh: dy, pelvisLow: dy, firstStep: 0.4, armSwing: 14 }
// heading in degrees (yaw convention); pelvis heights are offsets from the standing hips height.
import { add, sub, scale, len, apply, ry, rx } from "./math.js";

const fwd = h => apply(ry(h), [0, 0, 1]);
const leftOf = h => apply(ry(h), [1, 0, 0]);
const smoothstep = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Last keyed value of every channel at or before frame f. */
function stateAt(keys, f) {
	const st = {};
	for (const k of [...keys].sort((a, b) => a.f - b.f)) if (k.f <= f) Object.assign(st, k.set);
	return st;
}

function walk(gen, keys, sk) {
	const out = [], at = (f, set) => out.push({ f, set });
	const st = stateAt(keys, gen.f0);
	if (!st.foot_l || !st.foot_r || !st.root) throw new Error("MOTION_SPEC_INVALID: walk needs foot_l, foot_r and root keyed before f0");
	const I = sk.index, P = sk.restWorldPos;
	const ank = P[I.LeftFoot][1], standY = P[I.Hips][1];
	const footRest = { l: sub(P[I.LeftToeBase], P[I.LeftFoot]), r: sub(P[I.RightToeBase], P[I.RightFoot]) };
	// Pelvis heights from the leg length: straight-ish over the stance foot, low enough at
	// double support that the trailing leg still reaches (2% knee slack).
	const leg = len(sub(P[I.LeftLeg], P[I.LeftUpLeg])) + len(sub(P[I.LeftFoot], P[I.LeftLeg]));
	const hipDrop = P[I.Hips][1] - P[I.LeftUpLeg][1], step0 = gen.step ?? 0.5, hw = gen.halfWidth ?? 0.1;
	const hipsAt = horiz => Math.sqrt(Math.max(0, (0.98 * leg) ** 2 - horiz ** 2)) + ank + hipDrop - standY;
	const W = { steps: 8, step: step0, period: 20, swing: 14, halfWidth: hw, lift: 0.08, turnDistance: 0.4, firstStep: 0.4,
		pelvisHigh: Math.min(-0.005, hipsAt(Math.hypot(0.03, hw - 0.035))), pelvisLow: hipsAt(Math.hypot(step0 / 2, hw)), armSwing: 14, ...gen };
	const [h0, h1] = W.heading ?? [st.yaw ?? 0, st.yaw ?? 0];
	const hs = s => h0 + (h1 - h0) * smoothstep(s / W.turnDistance);
	const c0 = scale(add(st.foot_l, st.foot_r), 0.5); c0[1] = 0;
	const path = [c0];
	for (let i = 0; i < 4000; i++) path.push(add(path[i], scale(fwd(hs(i * 0.01)), 0.01)));
	const C = s => path[Math.max(0, Math.min(path.length - 1, Math.round(s / 0.01)))];
	const footAt = (s, k) => { const p = add(C(s), scale(leftOf(hs(s)), (k === "l" ? 1 : -1) * W.halfWidth)); p[1] = ank; return p; };
	const stance = { l: -0.07, r: 0.07 }, state = { foot_l: st.foot_l, foot_r: st.foot_r, fyaw_l: st.fyaw_l ?? h0, fyaw_r: st.fyaw_r ?? h0 };
	const holdAll = ["root", "yaw", "foot_l", "foot_r", "fyaw_l", "fyaw_r", "spine_yaw", "aswing_l", "aswing_r", "abend_l", "abend_r", "head_yaw"];
	at(gen.f0, Object.fromEntries(holdAll.map(ch => [ch, st[ch] ?? state[ch] ?? (ch === "yaw" ? h0 : 0)])));
	let sLast = stance.r;
	for (let i = 0; i < W.steps; i++) {
		const k = i % 2 === 0 ? "l" : "r", other = k === "l" ? "r" : "l", last = i === W.steps - 1;
		const sNew = last ? sLast : sLast + (i === 0 ? W.firstStep : W.step);
		const ts = gen.f0 + 16 + i * W.period, tl = ts + W.swing, tm = ts + Math.floor(W.swing / 2);
		// gait initiation: move the weight over the stance foot before the first heel comes up
		if (i === 0) {
			const pre = add(C(stance[other]), scale(leftOf(h0), (other === "l" ? 1 : -1) * W.halfWidth * 0.75)); pre[1] = st.root[1];
			at(ts - 4, { root: pre, yaw: h0 });
		}
		// toe-off: flat until just before lift, then roll the heel up about the toe
		const ankle = state[`foot_${k}`], yw = state[`fyaw_${k}`];
		const v = apply(ry(yw), footRest[k]), toe = add(ankle, v);
		const roll = deg => add(toe, apply(ry(yw), apply(rx(deg), apply(ry(-yw), scale(v, -1)))));
		at(ts - 5, { [`foot_${k}`]: ankle, [`fyaw_${k}`]: yw, [`fpitch_${k}`]: 0 });
		for (const [df, d] of [[-3, 8], [-1, 18], [0, 28]]) at(ts + df, { [`foot_${k}`]: roll(d), [`fpitch_${k}`]: d, [`fyaw_${k}`]: yw });
		const mid = footAt((stance[k] + sNew) / 2, k); mid[1] += W.lift;
		at(tm, { [`foot_${k}`]: mid, [`fyaw_${k}`]: hs((stance[k] + sNew) / 2), [`fpitch_${k}`]: 0 });
		const land = footAt(sNew, k);
		at(tl, { [`foot_${k}`]: land, [`fyaw_${k}`]: hs(sNew) });
		state[`foot_${k}`] = land; state[`fyaw_${k}`] = hs(sNew); stance[k] = sNew;
		const sMid = stance[other] + 0.03, shift = i === 0 ? 0.015 : 0.035;
		const pm = add(C(sMid), scale(leftOf(hs(sMid)), (other === "l" ? 1 : -1) * shift)); pm[1] = standY + W.pelvisHigh;
		const sLand = (stance[other] + sNew) / 2, pl = C(sLand).slice(); pl[1] = standY + (last ? W.pelvisHigh : W.pelvisLow);
		const swing = last ? 0 : i < 3 ? [0, 0.3, 0.7][i] : 1, sg = k === "l" ? 1 : -1;
		at(tm, { root: pm, yaw: hs(sMid) });
		at(tl, { root: pl, yaw: hs(sLand) - 3 * sg * swing, spine_yaw: 3 * sg * swing, aswing_l: -0.85 * W.armSwing * sg * swing,
			aswing_r: W.armSwing * sg * swing, abend_l: 10 * swing, abend_r: 10 * swing, head_yaw: 0 });
		sLast = sNew;
	}
	const tend = gen.f0 + 16 + W.steps * W.period + 18;
	at(tend, stateAt(out, tend));
	return out;
}

export function expandGenerators(spec, sk) {
	let keys = [...(spec.keys ?? [])];
	for (const gen of spec.generators ?? []) {
		if (gen.type !== "walk") throw new Error(`MOTION_SPEC_INVALID: unknown generator "${gen.type}"`);
		keys = keys.concat(walk(gen, keys, sk));
	}
	return keys;
}
