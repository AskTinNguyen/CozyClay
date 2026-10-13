// Task checks the agent declares in spec.checks, plus balance.
//   contacts:  [{ name, point, target, tol, when }]       point on target (e.g. filter on lips)
//   orient:    [{ name, from, to, along, minCos, when }]  direction from->to against "face" | "up" | [x,y,z]
//   below:     [{ name, joint, ref, min, when }]          joint at least `min` m below ref (no chicken wing)
//   clearance: [{ name, part, object, min, frames }]      body part keeps `min` m from an object
//   appear:    [{ name, channel, joint, anchor, tol }]    a visibility switch happens with joint at anchor
//   supports:  [{ object, part, tol }]                     frames where `part` rests on `object` skip balance
// point/from/to: "joint:Name" | "prop:name.point" | "anchor:name"; when: weight channel (> 0.99) or [f0, f1].
// f below indexes out.frames (frame out.f0 + f when the compile was windowed).
import { add, sub, scale, dot, norm, len } from "../compiler/math.js";
import { carried } from "../compiler/limbs.js";
import { resolveAnchor } from "../compiler/anchors.js";
import { CAPSULES, segPoints, sdBox, solePoints } from "./geometry.js";

export function pointOf(out, f, ref) {
	const { s, diag, c } = out.frames[f], [kind, rest] = ref.split(/:(.*)/s);
	if (kind === "joint") return s.P[out.ctx.sk.index[rest]];
	if (kind === "prop") { const [p, pt] = rest.split("."); return diag.props?.[p]?.[pt] ?? null; }
	if (kind === "anchor") return resolveAnchor(out.ctx, rest, s, diag, c);
	throw new Error(`MOTION_SPEC_INVALID: check point "${ref}"`);
}

const active = (out, f, when) => (Array.isArray(when) ? f + (out.f0 ?? 0) >= when[0] && f + (out.f0 ?? 0) <= when[1] : when ? (out.frames[f].c[when] ?? 0) > 0.99 : true);

function alongDir(out, f, along) {
	if (along === "up") return [0, 1, 0];
	if (along === "face") return carried(out.ctx.sk, out.frames[f].s, out.ctx.sk.index.Head, [0, 0, 1]);
	return norm(along);
}

export function specChecks(out, checks = {}) {
	const issues = [], n = out.frames.length, sk = out.ctx.sk, I = sk.index;
	const push = (kind, msg, f, value, limit) => issues.push({ kind, msg, frame: f, value: +value.toFixed(4), limit });
	for (let f = 0; f < n; f++) {
		for (const k of checks.contacts ?? []) if (active(out, f, k.when)) {
			const a = pointOf(out, f, k.point), b = pointOf(out, f, k.target);
			if (!a || !b) continue;
			const e = len(sub(a, b));
			if (e > (k.tol ?? 0.01)) push("CONTACT", `${k.name}: ${(e * 100).toFixed(1)} cm apart`, f, e, k.tol ?? 0.01);
		}
		for (const k of checks.orient ?? []) if (active(out, f, k.when)) {
			const a = pointOf(out, f, k.from), b = pointOf(out, f, k.to);
			if (!a || !b) continue;
			const cosv = dot(norm(sub(b, a)), alongDir(out, f, k.along));
			if (cosv < (k.minCos ?? 0.64)) push("ORIENT", `${k.name}: cos ${cosv.toFixed(2)}`, f, cosv, k.minCos ?? 0.64);
		}
		for (const k of checks.below ?? []) if (active(out, f, k.when)) {
			const { P } = out.frames[f].s, drop = P[I[k.ref]][1] - P[I[k.joint]][1];
			if (drop < (k.min ?? 0.08)) push("BELOW", `${k.name}: ${k.joint} only ${(drop * 100).toFixed(1)} cm below ${k.ref}`, f, drop, k.min ?? 0.08);
		}
		for (const k of checks.clearance ?? []) if (active(out, f, k.frames)) {
			const box = out.objectsAt(f)[k.object], cap = CAPSULES.find(c => c[0] === k.part);
			if (!box || !cap) continue;
			const { P } = out.frames[f].s, d = Math.min(...segPoints(P[I[cap[1]]], P[I[cap[2]]]).map(p => sdBox(p, box))) - cap[3];
			if (d < k.min) push("CLEARANCE", `${k.name}: ${(d * 100).toFixed(1)} cm`, f, d, k.min);
		}
	}
	for (const k of checks.appear ?? []) for (let f = 1; f < n; f++) {
		const was = (out.frames[f - 1].c[k.channel] ?? 0) > 0.5, is = (out.frames[f].c[k.channel] ?? 0) > 0.5;
		if (was === is) continue;
		const e = len(sub(pointOf(out, f, `joint:${k.joint}`), pointOf(out, f, `anchor:${k.anchor}`)));
		if (e > (k.tol ?? 0.035)) push("APPEAR", `${k.name}: switches with the hand ${(e * 100).toFixed(1)} cm from ${k.anchor}`, f, e, k.tol ?? 0.035);
	}
	issues.push(...balance(out, checks.supports ?? []));
	return issues;
}

function balance(out, supports) {
	const issues = [], sk = out.ctx.sk, I = sk.index, F = out.frames;
	for (let f = 0; f < F.length; f++) {
		const { P } = F[f].s;
		const supported = supports.some(sp => {
			const box = out.objectsAt(f)[sp.object], cap = CAPSULES.find(c => c[0] === (sp.part ?? "hips"));
			return box && cap && Math.min(...segPoints(P[I[cap[1]]], P[I[cap[2]]]).map(p => sdBox(p, box))) - cap[3] < (sp.tol ?? 0.04);
		});
		if (supported) continue;
		const moving = f > 0 && f < F.length - 1 && Math.hypot(F[f + 1].s.P[I.Hips][0] - F[f - 1].s.P[I.Hips][0], F[f + 1].s.P[I.Hips][2] - F[f - 1].s.P[I.Hips][2]) / 2 > 0.006;
		const feet = [];
		for (const S of ["Left", "Right"]) {
			const sp = solePoints(sk, F[f].s, S);
			if (moving || Math.min(sp.heel[1], sp.ball[1]) < 0.02) feet.push(sp.heel, sp.ball, sp.tip);
		}
		if (!feet.length) { issues.push({ kind: "BALANCE", msg: "no foot on the ground", frame: f, value: 0, limit: 0 }); continue; }
		const com = scale(["Hips", "Spine1", "Spine2", "Head"].reduce((a, j) => add(a, P[I[j]]), [0, 0, 0]), 0.25);
		const xs = feet.map(p => p[0]), zs = feet.map(p => p[2]), m = 0.08;
		if (com[0] < Math.min(...xs) - m || com[0] > Math.max(...xs) + m || com[2] < Math.min(...zs) - m || com[2] > Math.max(...zs) + m)
			issues.push({ kind: "BALANCE", msg: `centre of mass ${com[0].toFixed(2)},${com[2].toFixed(2)} outside the feet`, frame: f, value: 0, limit: 0 });
	}
	return issues;
}

