// General motion checks (every take): scene collisions, ground, IK reach, planted-foot slide,
// bone length, one-frame pops (style.js), knee and elbow flips, knees bending backward, elbows
// folded past their stop (ELBOW: the forearm in the upper arm, compiler/limbs.js), self contact,
// hands and held props entering the head (and the torso, contact-checks.js). Speed, acceleration,
// knee bend and balance are style: style.js measures them and checks them only when the spec
// names their limit (checks.limits).
import { add, sub, scale, apply, len, dist, cross, norm, dot, angle } from "../compiler/math.js";
import { CAPSULES, segPoints, sdBox, segDist, headDepth, solePoints } from "./geometry.js";
import { contactChecks } from "./contact-checks.js";
import { popChecks } from "./style.js";
import { ELBOW_STOP } from "../compiler/limbs.js";

export const QA_LIMITS = { allow: 0.005, groundAllow: 0.01, reach: 0.01, slide: 0.0015, plantH: 0.012,
	speedCore: 0.04, speedLimb: 0.16, accCore: 0.015, accLimb: 0.05, flip: 60, knee: 150, headAllow: 0.003, self: 0,
	body: 0.005, hands: 0.01, object: 0.005, grab: 0.03, balance: 0.08 };
/** FLIP reads a bend plane only where the limb is bent this far (deg) from straight and from folded flat. */
const FLIP_BEND = 20;
/** ELBOW: degrees past ELBOW_STOP that count (the arm IK sits on the stop to rounding). */
const ELBOW_TOL = 0.01;

export const allowance = (allow, part, obj) => {
	for (const a of allow ?? []) if (part.startsWith(a.part) && (a.object === obj || (a.object.endsWith("*") && obj.startsWith(a.object.slice(0, -1))))) return a.depth;
	return null;
};

export function generalChecks(sk, out, opts = {}) {
	const L = { ...QA_LIMITS, ...opts.limits }, issues = [], I = sk.index, F = out.frames, n = F.length;
	const push = (kind, msg, f, value, limit) => issues.push({ kind, msg, frame: f, value: +value.toFixed(4), limit });
	for (let f = 0; f < n; f++) {
		const { s, diag } = F[f], objs = out.objectsAt(f);
		// bounding spheres of the boxes: a capsule farther away than its own reach cannot touch one
		const spheres = Object.entries(objs).filter(([, box]) => box.half && !box.ignore)
			.map(([id, box]) => [id, box, add(box.pos, apply(box.R, [0, box.half[1], 0])), len(box.half)]);
		for (const [part, a, b, r] of CAPSULES) {
			const A = s.P[I[a]], B = s.P[I[b]], mid = scale(add(A, B), 0.5), reach = r + dist(A, B) / 2;
			let pts = null;
			for (const [id, box, c, rb] of spheres) {
				const lim = allowance(opts.allow, part, id) ?? L.allow;
				if (reach - (dist(mid, c) - rb) <= lim) continue;
				pts ??= segPoints(A, B);
				const pen = r - Math.min(...pts.map(p => sdBox(p, box)));
				if (pen > lim) push("COLLIDE", `${part} x ${id}`, f, pen, lim);
			}
		}
		for (const side of ["Left", "Right"]) {
			const sp = solePoints(sk, s, side), low = Math.min(sp.heel[1], sp.ball[1], sp.tip[1]);
			if (low < -L.groundAllow) push("GROUND", `${side} sole below floor`, f, -low, L.groundAllow);
		}
		for (const [k, v] of Object.entries(diag)) if (/miss_[lr]$/.test(k) && v > L.reach) push("REACH", k, f, v, L.reach);
		// hands, forearms and held props must stay out of the head
		const probes = [];
		for (const S of ["Left", "Right"]) probes.push(...segPoints(s.P[I[`${S}Hand`]], s.P[I[`${S}HandMiddle3`]], 5).map(p => [`hand_${S[0].toLowerCase()}`, p, 0.022]));
		for (const [pn, pts] of Object.entries(diag.props ?? {})) for (const [k, p] of Object.entries(pts)) if (Array.isArray(p) && k !== "origin" && !(opts.mouthPoints ?? []).includes(`${pn}.${k}`)) probes.push([`prop_${pn}`, p, 0.004]);
		for (const [nm, p, r] of probes) { const d = headDepth(sk, s, p) + r; if (d > L.headAllow) push("FACE", `${nm} into head`, f, d, L.headAllow); }
		if (segDist(s.P[I.LeftLeg], s.P[I.LeftFoot], s.P[I.RightLeg], s.P[I.RightFoot]) < 0.1 + L.self) push("SELF", "shins touch", f, 0.1, 0.1);
		if (segDist(s.P[I.LeftUpLeg], s.P[I.LeftLeg], s.P[I.RightUpLeg], s.P[I.RightLeg]) < 0.135 + L.self) push("SELF", "thighs overlap", f, 0.135, 0.135);
		for (const S of ["Left", "Right"]) {
			const th = s.P[I[`${S}UpLeg`]], kn = s.P[I[`${S}Leg`]], an = s.P[I[`${S}Foot`]];
			const bend = angle(sub(kn, th), sub(an, kn));
			// the foot's heading on the ground; the toe sits below the ankle, which must not count
			const toeDir = sub(s.P[I[`${S}ToeBase`]], an); toeDir[1] = 0;
			const mid = sub(kn, [(th[0] + an[0]) / 2, (th[1] + an[1]) / 2, (th[2] + an[2]) / 2]);
			if (bend > 3 && dot(mid, toeDir) < -0.002) push("KNEE", `${S} knee bends backward`, f, bend, 0);
			// an elbow folded past its stop puts the forearm in the upper arm (the solver stops at ELBOW_STOP)
			const fold = angle(sub(s.P[I[`${S}ForeArm`]], s.P[I[`${S}Arm`]]), sub(s.P[I[`${S}Hand`]], s.P[I[`${S}ForeArm`]]));
			if (fold > ELBOW_STOP + ELBOW_TOL) push("ELBOW", `${S} elbow folds ${fold.toFixed(0)}deg`, f, fold, ELBOW_STOP);
		}
	}
	contactChecks(sk, out, L, push);
	// temporal checks
	for (const S of ["Left", "Right"]) {
		for (let f = 1; f < n; f++) {
			const a = solePoints(sk, F[f - 1].s, S), b = solePoints(sk, F[f].s, S);
			for (const key of ["heel", "ball"]) {
				const planted = b[key][1] < L.plantH && a[key][1] < L.plantH && Math.abs(b[key][1] - a[key][1]) < 0.0005;
				const hv = Math.hypot(b[key][0] - a[key][0], b[key][2] - a[key][2]);
				if (planted && hv > L.slide) push("SLIDE", `${S} ${key} slides`, f, hv, L.slide);
			}
		}
	}
	for (let j = 0; j < sk.names.length; j++) {
		const p = sk.parent[j]; if (p < 0) continue;
		const L0 = dist(sk.restWorldPos[j], sk.restWorldPos[p]);
		const drift = Math.max(...F.map(fr => Math.abs(dist(fr.s.P[j], fr.s.P[p]) - L0)));
		if (drift > 0.001) push("LENGTH", `${sk.names[p]}-${sk.names[j]}`, 0, drift, 0.001);
	}
	popChecks(sk, out, L, push);
	flipChecks(sk, F, L, push);
	return issues;
}

/**
 * FLIP: a knee's or elbow's bend plane turns more than L.flip degrees a frame. The plane is read
 * only on frames the limb is bent FLIP_BEND or more from straight and from folded flat: near
 * either end a few millimetres set it, so the hand or foot moving a few centimetres turns it any
 * way (session df6acdcc: the right elbow folded to 171 deg as the wrist passed the shoulder, and
 * its plane turned 71 deg in a frame while the elbow moved 3 cm). Across the frames between, the
 * turn is shared out per frame, so a pole that flips while the limb is straight still shows.
 */
function flipChecks(sk, F, L, push) {
	const I = sk.index, bent = Math.sin(FLIP_BEND * Math.PI / 180);
	for (const S of ["Left", "Right"]) for (const [a, b, c] of [[`${S}UpLeg`, `${S}Leg`, `${S}Foot`], [`${S}Arm`, `${S}ForeArm`, `${S}Hand`]]) {
		let prev = null, at = 0;
		for (let f = 0; f < F.length; f++) {
			const P = F[f].s.P, up = sub(P[I[b]], P[I[a]]), down = sub(P[I[c]], P[I[b]]), nv = cross(up, down);
			if (len(nv) < bent * len(up) * len(down)) continue;
			const u = norm(nv), turn = prev ? angle(u, prev) : 0, gap = f - at;
			if (turn / gap > L.flip) push("FLIP", `${b} bend plane jumps ${turn.toFixed(0)}deg${gap > 1 ? ` over ${gap} frames` : ""}`, f, turn / gap, L.flip);
			prev = u; at = f;
		}
	}
}
