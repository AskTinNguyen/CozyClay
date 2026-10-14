// Hints for motion-type issues (reach, knees, pole flips, sliding, speed, pops) and for the
// spec's own checks (contacts, orient, below, appear). Orient and below try small changes of
// the wrist or elbow channels on the worst frame and scale the best one to the needed amount.
import { add, sub, scale, norm, len, dist, angle, apply, ry, clamp, dot } from "../compiler/math.js";
import { solveFrame } from "../compiler/compile.js";
import { channelsAt } from "../compiler/channels.js";
import { resolveAnchor } from "../compiler/anchors.js";
import { carried } from "../compiler/limbs.js";
import { pointOf } from "./spec-checks.js";
import { solePoints } from "./geometry.js";
import { vec, m3 } from "./fmt.js";
import { moveHint } from "./hints-contact.js";

const LIMB = { Leg: ["UpLeg", "Leg", "Foot", "knee"], ForeArm: ["Arm", "ForeArm", "Hand", "elbow"] };
const sideOf = s => (s.startsWith("Left") ? "l" : "r");
const weightOf = ch => (/^(w_|armw)/.test(ch) ? 0.5 : /^(root|foot|hand)/.test(ch) ? 1 : /^(knee|elbow)/.test(ch) ? 0.2 : 0.01);

/** Channels that move joint j, ranked by how much each changed into frame f (metres-equivalent). */
function movers(X, j, f) {
	const k = sideOf(j), b = X.out.baked;
	let list = ["root", "yaw", "pitch"];
	if (j === "Head") list = ["head_yaw", "head_pitch", "spine_pitch", "spine_yaw", "root", "yaw"];
	else if (/Hand|ForeArm/.test(j)) list = [`hand_${k}`, `armw_${k}`, `elbow_${k}`, `aswing_${k}`, `abend_${k}`, ...Object.keys(b).filter(ch => new RegExp(`^w_.+_${k}$`).test(ch)), "spine_yaw", "spine_pitch", "root", "yaw"];
	else if (/Foot|Leg/.test(j)) list = [`foot_${k}`, `knee_${k}`, `fpitch_${k}`, "root"];
	const change = ch => {
		const a = b[ch]?.[f - 1], c = b[ch]?.[f];
		if (a === undefined || c === undefined || typeof a === "object" && !Array.isArray(a)) return 0;
		return (Array.isArray(a) ? dist(a, c) : Math.abs(c - a)) * weightOf(ch);
	};
	return list.filter(ch => b[ch]).sort((p, q) => change(q) - change(p));
}

function speedHint(X, g, power) {
	const j = g.subject.split(" ")[0], f = g.worstFrame, ch = movers(X, j, f)[0] ?? "root";
	const { prev, next } = X.bracket(ch, f), stepped = X.keys(ch).find(k => k.step && Math.abs(k.f - f) <= 1);
	if (stepped) return { cause: X.cause(ch, f), hint: `${ch}: a step key jumps at f${Math.round(stepped.f)}; ease it over 4+ frames (key the old value 4 frames earlier, drop the step)` };
	const factor = Math.ceil(Math.pow(g.worst / g.limit, power) * 1.1 * 10) / 10;
	const a = Math.round(prev?.f ?? f - 4), b = Math.round(next?.f ?? f + 4), extra = Math.ceil((b - a) * (factor - 1));
	const anchor = /^w_(.+)_[lr]$/.exec(ch);
	return { cause: X.cause(ch, f), hint: `retime: stretch f${a}-f${b} by ${factor}x (+${extra} frames, move the keys from f${b} on later)${anchor ? ` - the hand switches to anchor ${anchor[1]} too fast` : ""}; or fix.retime: true`,
		fix: X.spec.fix === false ? undefined : { path: "/fix/retime", value: true } };
}

/** A check point (joint:/prop:/anchor:) on a freshly solved frame. */
function pointOn(X, fr, ref) {
	const [kind, rest] = ref.split(/:(.*)/s);
	if (kind === "joint") return fr.s.P[X.I[rest]];
	if (kind === "prop") { const [p, pt] = rest.split("."); return fr.diag.props?.[p]?.[pt]; }
	return resolveAnchor(X.out.ctx, rest, fr.s, fr.diag, fr.c);
}

/** Try channel changes on frame f; returns the best { ch, value, gain } for measure() (higher is better). */
function probe(X, f, tries, measure) {
	const c0 = channelsAt(X.out.baked, f), base = measure(X.fr(f));
	let best = null;
	for (const [ch, value, unit] of tries) {
		const gain = measure(solveFrame(X.out.ctx, { ...c0, [ch]: value }, f)) - base;
		if (gain > 1e-6 && (!best || gain / unit > best.gain / best.unit)) best = { ch, value, gain, unit };
	}
	return { best, base, c0 };
}

const hipOrShoulder = (X, k, f, limb) => X.fr(f).s.P[X.I[`${k === "l" ? "Left" : "Right"}${LIMB[limb][0]}`]];

export const motionHints = {
	REACH(X, g) {
		const [, limb, k] = /^(leg|arm)_miss_([lr])$/.exec(g.subject) ?? [], f = g.worstFrame, need = g.worst + 0.002;
		if (limb === "leg") {
			const T = X.fr(f).c[`foot_${k}`] ?? [0, 0, 0], H = hipOrShoulder(X, k, f, "Leg"), v = sub(T, H), R = dist(H, T) - g.worst;
			const disc = v[1] * v[1] - dot(v, v) + R * R, side = [v[0], 0, v[2]];
			const alt = disc >= 0 ? `or root down ${m3(-v[1] - Math.sqrt(disc) + 0.002)} m${g.worst <= 0.05 ? " (fix.reach does this when on)" : ""}`
				: `or root ${vec(scale(norm(side), len(side) - R * 0.95))} m toward the foot (the foot is ${m3(len(side))} m sideways of the hip: the root and foot keys disagree)`;
			return { cause: X.cause(`foot_${k}`, f), hint: `foot_${k}: move ${vec(scale(norm(sub(H, T)), need))} m toward the hip at f${f}, ${alt}`, fix: { channel: `foot_${k}`, f, delta: scale(norm(sub(H, T)), need) } };
		}
		const S = k === "l" ? "Left" : "Right", { s } = X.fr(f), dir = norm(sub(s.P[X.I[`${S}Hand`]], s.P[X.I[`${S}Arm`]]));
		const r = moveHint(X, `hand_${k}`, f, scale(dir, -need), "");
		return { cause: r.cause, hint: `${r.hint} (out of reach by ${m3(g.worst)} m), or bring root ${vec(scale([dir[0], 0, dir[2]], need))} m closer`, fix: r.fix };
	},
	KNEE(X, g) {
		const k = sideOf(g.subject), S = k === "l" ? "Left" : "Right", f = g.worstFrame, { s, c } = X.fr(f), P = s.P, I = X.I;
		if (/backward/.test(g.subject)) {
			const toe = sub(P[I[`${S}ToeBase`]], P[I[`${S}Foot`]]); toe[1] = 0;
			const pole = add(norm(apply(ry(-(c.yaw ?? 0)), toe)), [0, 0.3, 0]);
			return { cause: X.cause(`knee_${k}`, f), hint: `knee_${k}: key ${vec(norm(pole))} (body frame, along the foot) at f${f}; a knee pole is +z forward, +x the character's left`, fix: { channel: `knee_${k}`, f, value: norm(pole) } };
		}
		const H = P[I[`${S}UpLeg`]], K = P[I[`${S}Leg`]], A = P[I[`${S}Foot`]], a = dist(H, K), b = dist(K, A);
		const inner = (180 - (g.limit - 5)) * Math.PI / 180, want = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(inner));
		return { cause: X.cause(`foot_${k}`, f), hint: `foot_${k}: move ${vec(scale(norm(sub(A, H)), want - dist(H, A)))} m away from the hip at f${f} (the knee folds ${m3(g.worst)} deg, limit ${g.limit})`,
			fix: { channel: `foot_${k}`, f, delta: scale(norm(sub(A, H)), want - dist(H, A)) } };
	},
	FLIP(X, g) {
		const [, S, limb] = /^(Left|Right)(Leg|ForeArm) /.exec(g.subject) ?? [], f = g.worstFrame;
		if (!limb) return null;
		const k = sideOf(S), [r, m, e, pole] = LIMB[limb], { s } = X.fr(f), P = s.P, I = X.I;
		const bend = angle(sub(P[I[`${S}${m}`]], P[I[`${S}${r}`]]), sub(P[I[`${S}${e}`]], P[I[`${S}${m}`]]));
		const ch = `${pole}_${k}`, prevPole = X.out.baked[ch]?.[Math.max(0, f - 1)];
		if (prevPole && len(prevPole) < 0.5) return { cause: X.cause(ch, f), hint: `${ch}: the pole passes near zero (length ${m3(len(prevPole))}) at f${f} while it turns between opposite keys; add an in-between pole key (e.g. the average direction, normalised) so it turns, not shrinks` };
		const straight = bend < 12 ? `the limb is almost straight at f${f} (bend ${m3(bend)} deg), so the pole cannot hold it: bring the ${limb === "Leg" ? "foot" : "hand"} target ~0.02 m toward the ${limb === "Leg" ? "hip" : "shoulder"}, or ` : "";
		return { cause: X.cause(ch, f), hint: `${ch}: ${straight}keep the pole on one side through f${f}${prevPole ? ` (key ${vec(prevPole)} there)` : ""}`, fix: prevPole && { channel: ch, f, value: prevPole } };
	},
	SLIDE(X, g) {
		const k = sideOf(g.subject), S = k === "l" ? "Left" : "Right", key = g.subject.includes("heel") ? "heel" : "ball";
		const f0 = Math.max(0, g.first - 1), at = f => solePoints(X.sk, X.fr(f).s, S)[key];
		const slid = Math.hypot(at(g.last)[0] - at(f0)[0], at(g.last)[2] - at(f0)[2]), hold = X.out.baked[`foot_${k}`]?.[f0];
		return { cause: X.cause(`foot_${k}`, g.worstFrame), hint: `foot_${k}: hold it still over f${f0}-f${g.last}${hold ? ` (key ${vec(hold)} at both ends)` : ""}; the ${key} slides ${m3(slid)} m${slid < 0.01 ? "; fix.slide locks this when on" : ""}`,
			fix: hold && { channel: `foot_${k}`, f: g.last, value: hold } };
	},
	SPEED: (X, g) => speedHint(X, g, 1),
	POP: (X, g) => speedHint(X, g, 0.5),
	LENGTH: () => ({ cause: "compiler", hint: "a bone changed length: report the spec, this is a compiler fault" }),
	CONTACT(X, g) {
		const ck = (X.spec.checks?.contacts ?? []).find(c => g.subject.startsWith(`${c.name}:`)), f = g.worstFrame, i = X.rel(f);
		if (!ck) return null;
		const a = pointOf(X.out, i, ck.point), b = pointOf(X.out, i, ck.target), delta = sub(b, a);
		const prop = /^prop:([^.]+)/.exec(ck.point), k = prop ? X.spec.props?.[prop[1]]?.hand : sideOf(ck.point.slice(6));
		const { diag } = X.fr(f), over = Math.max(diag[`reach_over_${k}`] ?? 0, diag[`arm_miss_${k}`] ?? 0);
		const anchor = /^anchor:(.+)$/.exec(ck.target)?.[1], fit = (X.spec.fits ?? []).findIndex(ft => ft.side === k && ft.anchor === anchor);
		const cause = fit >= 0 ? `fits[${fit}] (${k} -> anchor ${anchor})` : moveHint(X, `hand_${k}`, f, delta).cause;
		const toRoot = scale(norm([delta[0], 0, delta[2]]), over + 0.01);
		if (over > 0.002) return { cause, hint: `out of reach by ${m3(over)} m at f${f}: bring root ${vec(toRoot)} m toward ${anchor ?? "the target"}, or move the target`, fix: { channel: "root", f, delta: toRoot } };
		const r = moveHint(X, `hand_${k}`, f, delta);
		return { cause, hint: `${r.hint}${fit < 0 && anchor ? `; or add fits: [{ side: "${k}", anchor: "${anchor}", effector: ${prop ? `{ prop: "${prop[1]}", point: "${ck.point.split(".")[1]}" }` : "{ joints: [...] }"} }]` : ""}`, fix: r.fix };
	},
	ORIENT(X, g) {
		const ck = (X.spec.checks?.orient ?? []).find(c => g.subject.startsWith(`${c.name}:`)), f = g.worstFrame;
		if (!ck) return null;
		const prop = /^prop:([^.]+)/.exec(ck.from), k = prop ? X.spec.props?.[prop[1]]?.hand : sideOf(ck.from.slice(6)), minCos = ck.minCos ?? 0.64;
		const along = fr => (ck.along === "up" ? [0, 1, 0] : ck.along === "face" ? carried(X.sk, fr.s, X.I.Head, [0, 0, 1]) : norm(ck.along));
		const cos = fr => dot(norm(sub(pointOn(X, fr, ck.to), pointOn(X, fr, ck.from))), along(fr));
		const c = channelsAt(X.out.baked, f), tw = c[`wtwist_${k}`] ?? 0, fx = c[`wflex_${k}`] ?? 0;
		const { best, base } = probe(X, f, [[`wtwist_${k}`, clamp(tw + 15, -85, 85), 15], [`wtwist_${k}`, clamp(tw - 15, -85, 85), 15], [`wflex_${k}`, clamp(fx + 15, -70, 70), 15], [`wflex_${k}`, clamp(fx - 15, -70, 70), 15]], cos);
		if (!best) return { cause: X.cause(`wtwist_${k}`, f), hint: `turn the prop another way: wrist twist/flex do not help at f${f} (cos ${m3(base)}, needs ${minCos}); change elbow_${k} or the prop points` };
		const from = best.ch.startsWith("wtwist") ? tw : fx, lim = best.ch.startsWith("wtwist") ? 85 : 70;
		const want = clamp(from + (best.value - from) * Math.min(4, (minCos - base + 0.03) / best.gain), -lim, lim);
		return { cause: X.cause(best.ch, f), hint: `${best.ch}: key ${m3(want)} deg at f${f} (now ${m3(from)}; cos ${m3(base)}, needs ${minCos})`, fix: { channel: best.ch, f, value: want } };
	},
	BELOW(X, g) {
		const ck = (X.spec.checks?.below ?? []).find(c => g.subject.startsWith(`${c.name}:`)), f = g.worstFrame;
		if (!ck) return null;
		const k = sideOf(ck.joint), ch = `${/Leg/.test(ck.joint) ? "knee" : "elbow"}_${k}`, pole = channelsAt(X.out.baked, f)[ch] ?? [0, -1, -0.3];
		const drop = fr => fr.s.P[X.I[ck.ref]][1] - fr.s.P[X.I[ck.joint]][1];
		// candidate poles (body frame), nearest to the current one first among those that are enough
		const need = (ck.min ?? 0.08) + 0.01, c0 = channelsAt(X.out.baked, f), base = drop(X.fr(f));
		const tries = [[0, -1, 0], [0.5, -1, 0], [-0.5, -1, 0], [0, -1, -0.4], [0, -1, 0.4], [0.5, -1, 0.5], [-0.5, -1, 0.5], [0.5, -1, -0.4], [-0.5, -1, -0.4]]
			.map(p => ({ p, d: drop(solveFrame(X.out.ctx, { ...c0, [ch]: p }, f)), turn: angle(p, pole) }));
		const ok = tries.filter(t => t.d >= need).sort((p, q) => p.turn - q.turn)[0], best = ok ?? tries.sort((p, q) => q.d - p.d)[0];
		if (!(best.d > base)) return { cause: X.cause(ch, f), hint: `${ch}: no pole change lowers ${ck.joint} at f${f}; lower the hand target instead` };
		return { cause: X.cause(ch, f), hint: `${ch}: key ${vec(best.p)} (body frame: +y up, +z forward) at f${f} (${ck.joint} ${m3(base)} m below ${ck.ref} -> ${m3(best.d)}, needs ${ck.min ?? 0.08})`, fix: { channel: ch, f, value: best.p } };
	},
	APPEAR(X, g) {
		const ck = (X.spec.checks?.appear ?? []).find(c => g.subject.startsWith(`${c.name}:`)), f = g.worstFrame;
		if (!ck) return null;
		let best = null;
		for (let q = Math.max(X.out.f0 ?? 0, f - 24); q <= Math.min((X.out.f0 ?? 0) + X.out.frames.length - 1, f + 24); q++) {
			const d = len(sub(pointOf(X.out, X.rel(q), `joint:${ck.joint}`), pointOf(X.out, X.rel(q), `anchor:${ck.anchor}`)));
			if (!best || d < best.d) best = { q, d };
		}
		const tol = ck.tol ?? 0.035;
		return { cause: X.cause(ck.channel, f), hint: best.d <= tol ? `${ck.channel}: move the step from f${f} to f${best.q} (${ck.joint} ${m3(best.d)} m from ${ck.anchor} there)`
			: `${ck.joint} never gets within ${tol} m of ${ck.anchor} near f${f} (closest ${m3(best.d)} m at f${best.q}): hold its weight w_${ck.anchor}_${sideOf(ck.joint)} at 1 around the switch` };
	},
};
