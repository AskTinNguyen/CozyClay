// Measured, not judged (output.observations.wrist, lane wrist): how far each wrist bends while its hand
// holds something. A hand holds on the frames a fit's weight is on (reachGrip, any fit), a keyed carry
// leads it (diag.hold_<k>), a grip turns it (diag.grip_<k>) or it carries a body. On those frames the
// hand's turn relative to its forearm is read the way compiler/hold.js turns it (arm-orient.js
// wristNeed): flex (+ toward the palm), deviation (+ toward the thumb, radial; - ulnar) and the twist the
// wrist joint shows (the forearm bone takes FOREARM_SHARE of a turn, so the joint's comfortable twist
// is that share of the forearm's). Frames past the comfortable ranges (arm-orient.js WRIST_COMFORT) and
// at the anatomical limits (WRIST_LIMITS) are counted.
// Why: a hand drawn by keys bent 70 deg (the limit) with 33 deg of ulnar deviation for frames while QA
// stayed clean (bench S6), and no answer said so.
import { wristNeed, WRIST_LIMITS, WRIST_COMFORT, FOREARM_SHARE } from "../compiler/arm-orient.js";
import { palmAxes } from "../compiler/limbs.js";
import { apply, len, mul, scale, sub, T } from "../compiler/math.js";
import { handOf } from "../object-pose.js";

const HOLD = 0.5, AT = 1;
const JOINT = { twist: 1 - FOREARM_SHARE, flex: 1, dev: 1 };
const range = (k, table) => table[k].map(v => v * JOINT[k]);

export const WRIST_UNITS = "wrist: deg on the frames a hand holds (a fit, a carry or a grip on); flex + toward the palm, dev + radial / - ulnar, twist at the wrist joint; [min, f, max, f], frames past the comfortable range and at the limit";

/** True when the hand of side k holds something on frame i of out (absolute frame f). */
function holding(out, k, i, f) {
	const { diag } = out.frames[i], baked = out.baked ?? {};
	if ((diag[`hold_${k}`]?.w ?? 0) > HOLD || (diag[`grip_${k}`]?.w ?? 0) > HOLD) return true;
	for (const fit of out.ctx.spec.fits ?? []) if (fit.side === k && (baked[`w_${fit.anchor}_${k}`]?.[f] ?? 0) > HOLD) return true;
	return Object.keys(out.ctx.spec.objects ?? {}).some(id => out.ctx.spec.objects[id]?.prop && handOf(out, id, f) === k);
}

/** observeWrist(sk, out) -> { hand_l?, hand_r? } or null when no hand holds anything. Frames are absolute. */
export function observeWrist(sk, out) {
	const I = sk.index, rw = sk.restWorldRot, f0 = out.f0 ?? 0, res = {};
	for (const [S, k] of [["Left", "l"], ["Right", "r"]]) {
		const h = I[`${S}Hand`], fa = I[`${S}ForeArm`], row = { frames: 0, past: 0, limit: 0 };
		out.frames.forEach(({ s }, i) => {
			const f = i + f0;
			if (!holding(out, k, i, f)) return;
			const axT = scale(sub(s.P[h], s.P[fa]), 1 / Math.max(1e-9, len(sub(s.P[h], s.P[fa])))), neutral = mul(s.R[fa], mul(T(rw[fa]), rw[h]));
			const need = wristNeed(neutral, s.R[h], axT, apply(mul(neutral, T(s.R[h])), palmAxes(sk, s, S).l));
			row.frames++;
			for (const n of ["flex", "dev", "twist"]) {
				const v = Math.round(need[n]), cur = row[n];
				row[n] = cur ? [Math.min(cur[0], v), v < cur[0] ? f : cur[1], Math.max(cur[2], v), v > cur[2] ? f : cur[3]] : [v, f, v, f];
			}
			// past the comfortable range by more than a degree; at a limit within a degree of it
			const outside = (table, by) => ["flex", "dev", "twist"].some(n => { const [lo, hi] = range(n, table); return need[n] < lo + by || need[n] > hi - by; });
			if (outside(WRIST_COMFORT, -AT)) row.past++;
			if (outside(WRIST_LIMITS, AT)) row.limit++;
		});
		if (row.frames) res[`hand_${k}`] = row;
	}
	return Object.keys(res).length ? res : null;
}
