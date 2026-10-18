// Generators expand into ordinary keys before baking. "walk" plans footsteps along a curving
// path from the pose the earlier keys leave at f0: weight shift over the stance foot, pelvis
// bob and twist, toe-off, arm swing, feet together at the end. The steps keep a natural rhythm
// (gait-rhythm.js): period, swing, step, lift and armSwing are the averages, vary: 0 makes every
// step exactly those.
//
// { type: "walk", f0, steps: 8, step: 0.5, period: 20, swing: 14, halfWidth: 0.1, lift: 0.08,
//   heading: [h0, h1], turnDistance: 0.4, pelvisHigh: dy, pelvisLow: dy, firstStep: 0.4, armSwing: 14, vary: 1 }
// heading in degrees (yaw convention); pelvis heights are offsets from the standing hips height.
// The feet roll as a person's do, heel first (the three rockers of gait): the heel strikes with the
// toes up and the foot rolls down about the heel to flat; it stays flat while the shin passes over
// it; the heel comes up well before lift-off and the foot rolls over the ball, toes flat, to toe-off;
// in the air the toes trail down, level out at mid-swing and come up again for the next strike.
// The heel strikes at the leg's slant (a person's ankle is near neutral at contact, so the toes come
// up as far as the shin leans back: SHIN of the hip-to-ankle slant, the knee taking the rest, plus
// STRIKE_DF); TOE_OFF is the push-off pitch at a full stride (STRIDE_REF m of foot travel), less for
// a shorter one. A pivot is the very point QA reads (qa/geometry.js solePoints), so a rolling foot
// never counts as sliding.
// The arms swing wider the faster the walk (armSwing, when not given, from the speed against the default
// walk's 0.5 m per 20 frames: about 23 deg front to back there, about 30 at twice the speed); each elbow
// bends with its swing, most with the arm forward and least behind (ELBOW +- ELBOW_SWING, both growing
// with the speed), and the hands hang with the wrists a little flexed (WRIST). All of it fades in over
// the first steps and back out on the closing one.
import { add, sub, scale, len, apply, ry, rx, clamp } from "./math.js";
import { walkRhythm } from "./gait-rhythm.js";

const SHIN = 0.45, STRIKE_DF = 3, TOE_OFF = 50, STRIDE_REF = 1.1, ELBOW = [24, 4], ELBOW_SWING = [6, 3], WRIST = 8;
const fwd = h => apply(ry(h), [0, 0, 1]);
const leftOf = h => apply(ry(h), [1, 0, 0]);
const smoothstep = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Last keyed value of every channel at or before frame f. */
export function stateAt(keys, f) {
	const st = {};
	for (const k of [...keys].sort((a, b) => a.f - b.f)) if (k.f <= f) Object.assign(st, k.set);
	return st;
}

/** gen -> keys; every key carries src (tag + step number) so QA can name the step it came from. */
export function walk(gen, keys, sk, tag = "walk") {
	let src = `${tag} start`;
	const out = [], at = (f, set) => out.push({ f, set, src });
	const st = stateAt(keys, gen.f0);
	if (!st.foot_l || !st.foot_r || !st.root) throw new Error("MOTION_SPEC_INVALID: walk needs foot_l, foot_r and root keyed before f0");
	if (gen.vary !== undefined && !(Number.isFinite(gen.vary) && gen.vary >= 0 && gen.vary <= 2)) throw new Error(`MOTION_SPEC_INVALID: ${tag} vary must be a number from 0 (every step the same) to 2, got ${JSON.stringify(gen.vary)}`);
	const I = sk.index, P = sk.restWorldPos;
	const ank = P[I.LeftFoot][1], standY = P[I.Hips][1];
	const footRest = { l: sub(P[I.LeftToeBase], P[I.LeftFoot]), r: sub(P[I.RightToeBase], P[I.RightFoot]) };
	// QA's heel point from the ankle of a flat foot at yaw 0; a foot pitched `deg` about a point on the ground
	const heelOff = [0, 0.005 - ank, -0.045];
	const pivot = (p, yw, deg, from) => add(p, apply(ry(yw), apply(rx(deg), apply(ry(-yw), sub(from, p)))));
	const flatAt = { l: -Infinity, r: -Infinity };
	// Pelvis heights from the leg length: straight-ish over the stance foot, low enough at
	// double support that the trailing leg still reaches (2% knee slack).
	const leg = len(sub(P[I.LeftLeg], P[I.LeftUpLeg])) + len(sub(P[I.LeftFoot], P[I.LeftLeg]));
	const hipDrop = P[I.Hips][1] - P[I.LeftUpLeg][1], step0 = gen.step ?? 0.5, hw = gen.halfWidth ?? 0.1;
	const hipsAt = horiz => Math.sqrt(Math.max(0, (0.98 * leg) ** 2 - horiz ** 2)) + ank + hipDrop - standY;
	const W = { steps: 8, step: step0, period: 20, swing: 14, halfWidth: hw, lift: 0.08, turnDistance: 0.4, firstStep: 0.4,
		pelvisHigh: Math.min(-0.005, hipsAt(Math.hypot(0.03, hw - 0.035))), pelvisLow: hipsAt(Math.hypot(step0 / 2, hw)), vary: 1, ...gen };
	const pace = (W.step / W.period) / (0.5 / 20);
	W.armSwing = gen.armSwing ?? clamp(10 + 4.5 * pace, 12, 22);
	const elbow = ELBOW[0] + ELBOW[1] * Math.min(pace, 2.5), elbowSwing = ELBOW_SWING[0] + ELBOW_SWING[1] * Math.min(pace, 2.5);
	const [h0, h1] = W.heading ?? [st.yaw ?? 0, st.yaw ?? 0];
	const hs = s => h0 + (h1 - h0) * smoothstep(s / W.turnDistance);
	const c0 = scale(add(st.foot_l, st.foot_r), 0.5); c0[1] = 0;
	const path = [c0];
	for (let i = 0; i < 4000; i++) path.push(add(path[i], scale(fwd(hs(i * 0.01)), 0.01)));
	const C = s => path[Math.max(0, Math.min(path.length - 1, Math.round(s / 0.01)))];
	const footAt = (s, k) => { const p = add(C(s), scale(leftOf(hs(s)), (k === "l" ? 1 : -1) * W.halfWidth)); p[1] = ank; return p; };
	const stance = { l: -0.07, r: 0.07 }, state = { foot_l: st.foot_l, foot_r: st.foot_r, fyaw_l: st.fyaw_l ?? h0, fyaw_r: st.fyaw_r ?? h0 };
	const holdAll = ["root", "yaw", "foot_l", "foot_r", "fyaw_l", "fyaw_r", "spine_yaw", "aswing_l", "aswing_r", "abend_l", "abend_r", "wflex_l", "wflex_r", "head_yaw"];
	at(gen.f0, Object.fromEntries(holdAll.map(ch => [ch, st[ch] ?? state[ch] ?? (ch === "yaw" ? h0 : 0)])));
	let sLast = stance.r;
	const R = walkRhythm(W, { s0: sLast, turn: (a, b) => hs(b) - hs(a),
		seed: [gen.f0, W.steps, W.step, W.period, W.swing, W.firstStep, h0, h1, c0[0].toFixed(3), c0[2].toFixed(3)].join("|") });
	for (let i = 0; i < W.steps; i++) {
		src = `${tag} step ${i + 1}`;
		const k = i % 2 === 0 ? "l" : "r", other = k === "l" ? "r" : "l", last = i === W.steps - 1;
		const sNew = last ? sLast : sLast + R.inc[i];
		const ts = gen.f0 + 16 + R.lift[i], tl = ts + R.air[i], tm = ts + Math.floor(R.air[i] / 2);
		// gait initiation: move the weight over the stance foot before the first heel comes up
		if (i === 0) {
			const pre = add(C(stance[other]), scale(leftOf(h0), (other === "l" ? 1 : -1) * W.halfWidth * 0.75)); pre[1] = st.root[1];
			at(ts - 4, { root: pre, yaw: h0 });
		}
		// a longer stride pushes off more; the closing step pushes and strikes less
		const size = clamp(Math.abs(sNew - stance[k]) / STRIDE_REF, 0.3, 1.15), toeOff = TOE_OFF * (0.55 + 0.45 * size) * (last ? 0.8 : 1);
		// forefoot rocker: the heel comes up about half a step before lift-off (sooner on the first
		// step, the weight only just over the other foot) and the foot rolls over the ball, slowly
		// while the other foot is still in the air, then fast to toe-off
		const ankle = state[`foot_${k}`], yw = state[`fyaw_${k}`], ball = add(ankle, apply(ry(yw), footRest[k]));
		const tHeel = Math.max(ts - Math.round((i === 0 ? 0.35 : 0.55) * W.period), flatAt[k] + 1, gen.f0 + 1);
		for (let f = tHeel; f <= ts; f++) {
			const d = toeOff * ((f - tHeel) / Math.max(1, ts - tHeel)) ** 1.8;
			at(f, { [`foot_${k}`]: pivot(ball, yw, d, ankle), [`fpitch_${k}`]: d, [`fyaw_${k}`]: yw });
		}
		// swing: the toes trail down after toe-off, level at mid-swing, come up before the strike
		const lead = Math.max(1, Math.round(0.3 * R.air[i]));
		if (ts + lead < tm) at(ts + lead, { [`fpitch_${k}`]: 0.4 * toeOff });
		const mid = footAt((stance[k] + sNew) / 2, k); mid[1] += R.height[i];
		at(tm, { [`foot_${k}`]: mid, [`fyaw_${k}`]: hs((stance[k] + sNew) / 2), [`fpitch_${k}`]: 0 });
		const sMid = stance[other] + 0.03, shift = i === 0 ? 0.015 : 0.035;
		const pm = add(C(sMid), scale(leftOf(hs(sMid)), (other === "l" ? 1 : -1) * shift)); pm[1] = standY + W.pelvisHigh;
		// a stride longer than the nominal one drops the hips a little more at double support, so the trailing leg still reaches
		const low = gen.pelvisLow ?? (R.inc[i] > step0 ? Math.min(W.pelvisLow, hipsAt(Math.hypot(R.inc[i] / 2, hw))) : W.pelvisLow);
		const sLand = (stance[other] + sNew) / 2, pl = C(sLand).slice(); pl[1] = standY + (last ? W.pelvisHigh : low);
		// heel rocker: the toes come up before the strike, then the foot rolls down about the heel to flat
		const land = footAt(sNew, k), lyaw = hs(sNew), heel = add(land, apply(ry(lyaw), heelOff));
		const slant = Math.atan2(Math.abs(sNew - sLand), pl[1] - land[1]) * 180 / Math.PI;
		const strike = -(SHIN * slant + STRIKE_DF) * (last ? 0.5 : 1), nFlat = Math.max(2, Math.round(0.2 * W.period));
		if (tl - lead > tm) at(tl - lead, { [`fpitch_${k}`]: 0.6 * strike });
		for (let j = 0; j <= nFlat; j++) {
			const d = strike * (1 - smoothstep(j / nFlat));
			at(tl + j, { [`foot_${k}`]: pivot(heel, lyaw, d, land), [`fpitch_${k}`]: d, [`fyaw_${k}`]: lyaw });
		}
		flatAt[k] = tl + nFlat;
		state[`foot_${k}`] = land; state[`fyaw_${k}`] = lyaw; stance[k] = sNew;
		const swing = (last ? 0 : i < 3 ? [0, 0.3, 0.7][i] : 1) * R.arm[i], sg = k === "l" ? 1 : -1;
		at(tm, { root: pm, yaw: hs(sMid) });
		// the arm opposite the landing foot is forward: its elbow bends most, the other's least
		at(tl, { root: pl, yaw: hs(sLand) - 3 * sg * swing, spine_yaw: 3 * sg * swing, aswing_l: -0.85 * W.armSwing * sg * swing,
			aswing_r: W.armSwing * sg * swing, abend_l: swing * (elbow - sg * elbowSwing), abend_r: swing * (elbow + sg * elbowSwing),
			wflex_l: WRIST * swing, wflex_r: WRIST * swing, head_yaw: 0 });
		sLast = sNew;
	}
	const tend = gen.f0 + 16 + W.steps * W.period + 18;
	src = `${tag} end`;
	at(tend, stateAt(out, tend));
	return out;
}

export function expandGenerators(spec, sk) {
	let keys = (spec.keys ?? []).map((k, i) => (k.src ? k : { ...k, src: `keys[${i}]` }));
	(spec.generators ?? []).forEach((gen, i) => {
		if (gen.type !== "walk") throw new Error(`MOTION_SPEC_INVALID: generators[${i}] has unknown type "${gen.type}" (only "walk")`);
		keys = keys.concat(walk(gen, keys, sk, `generators[${i}] walk`));
	});
	return keys;
}
