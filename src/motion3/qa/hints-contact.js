// Hints for contact-type issues: a body part inside a box, the floor, the head, the torso or the
// other limb. Each answers a world move (direction x amount) for whatever drives that part.
import { add, sub, scale, norm, dot, len, clamp, apply, ry, T } from "../compiler/math.js";
import { bonePoint } from "../compiler/skeleton.js";
import { CAPSULES, segPoints, sdBox, boxNormal, headDepth, segDist, solePoints, ankleY } from "./geometry.js";
import { vec, m3 } from "./fmt.js";
import { kneeFoldHint, kneeWhy } from "./hints-knee.js";

const MARGIN = 0.003;
const sideOf = name => (/(^|_)l$|^Left/.test(name) ? "l" : /(^|_)r$|^Right/.test(name) ? "r" : null);

/** fix (qa/patch.js) moving anchor `name` by a world delta at f: its own point, in the frame that point is written in. */
function anchorFix(X, name, f, delta) {
	const a = X.spec.anchors?.[name], path = field => `/anchors/${name}/${field}`;
	if (a?.kind === "world") return { path: path("p"), delta };
	if (a?.kind === "body") return { path: path("p"), delta: apply(ry(-(X.fr(f).c.yaw ?? 0)), delta) };
	if (["bone", "segment", "prop"].includes(a?.kind)) return { path: path("offset"), delta };
	const o = a?.kind === "object" && X.out.objectsAt(X.rel(f))[a.object];
	return o ? { path: path("local"), delta: apply(T(o.R), delta) } : undefined;
}

/** cause + hint (+ fix, qa/patch.js) for moving a body part (capsule name, prop_<name>, hand_<k>) by `delta` at frame f. */
export function moveHint(X, part, f, delta, why = "") {
	const prop = /^prop_(.+)$/.exec(part);
	const k = prop ? X.spec.props?.[prop[1]]?.hand : sideOf(part);
	let label, cause, fix;
	if (/^(hand|farm|uarm)_/.test(part) || prop) {
		const d = X.hand(k, f);
		label = d.label;
		fix = d.anchor ? anchorFix(X, d.anchor, f, delta) : d.ch === `hand_${k}` ? { channel: d.ch, f, delta } : undefined;
		cause = d.anchor ? `anchor ${d.anchor}${d.fit !== null ? ` (fits[${d.fit}])` : ""} via ${X.cause(d.ch, f)}` : X.cause(d.ch, f);
	} else if (/^(shin|foot|sole)_/.test(part)) { label = `foot_${k}`; cause = X.cause(label, f); fix = { channel: label, f, delta }; }
	else { label = "root"; cause = X.cause("root", f); fix = { channel: "root", f, delta }; }
	// a key the walk generator wrote: the agent changes the walk, not the key
	const walk = / (walk|walkTo) /.test(` ${cause}`) && /step|start|end/.test(cause);
	if (walk && !/^anchor/.test(label)) return { cause, hint: `walk path: ${label} needs ${vec(delta)} m at f${f}${why}; change that walk's heading/turnDistance/step (or give one a { range: [lo, hi] })` };
	return { cause, hint: `${label}: move ${vec(delta)} m at f${f}${why}`, fix };
}

const capsule = name => CAPSULES.find(c => c[0] === name);

/** Deepest point of a capsule in a box at frame f and the box's outward normal there. */
function deepest(X, f, part, box) {
	const [, a, b] = capsule(part), { s } = X.fr(f);
	const pts = segPoints(s.P[X.I[a]], s.P[X.I[b]]), ds = pts.map(p => sdBox(p, box)), m = Math.min(...ds);
	return { p: pts[ds.indexOf(m)], n: boxNormal(pts[ds.indexOf(m)], box), d: m };
}

function boxHint(X, g, part, id, need) {
	const f = g.worstFrame, box = X.out.objectsAt(X.rel(f))[id];
	if (!box || !capsule(part)) return null;
	const { n } = deepest(X, f, part, box);
	return moveHint(X, part, f, scale(n, need), ` (out of ${id})`);
}

function towardFrom(X, g, part, from, need, what) {
	return moveHint(X, part, g.worstFrame, scale(norm(from), need), ` (away from the ${what})`);
}

/** Probe points of a hand or prop at frame f (as the FACE/BODY checks probe them). */
function probes(X, f, nm) {
	const { s, diag } = X.fr(f), I = X.I;
	if (nm.startsWith("hand_")) { const S = nm.endsWith("l") ? "Left" : "Right"; return segPoints(s.P[I[`${S}Hand`]], s.P[I[`${S}HandMiddle3`]], 5); }
	return Object.entries(diag.props?.[nm.slice(5)] ?? {}).filter(([k, p]) => Array.isArray(p) && k !== "origin").map(([, p]) => p);
}

export const contactHints = {
	COLLIDE(X, g) {
		const [, part, id] = /^(\S+) x (.+)$/.exec(g.subject) ?? [];
		const r = boxHint(X, g, part, id, g.worst - g.limit + MARGIN);
		if (r && /^(hand|farm)_/.test(part) && !X.spec.fix?.penetration && g.worst - g.limit <= 0.05) {
			r.hint += "; or fix.penetration: 0.02 pushes shallow hand hits out";
			if (X.spec.fix !== false) r.fix = { path: "/fix/penetration", value: 0.02 };
		}
		return r;
	},
	CLEARANCE(X, g) {
		const k = (X.spec.checks?.clearance ?? []).find(c => g.subject.startsWith(`${c.name}:`));
		return k && boxHint(X, g, k.part, k.object, k.min - g.worst + MARGIN);
	},
	GROUND(X, g) {
		const k = g.subject.startsWith("Left") ? "l" : "r", f = g.worstFrame, c = X.fr(f).c, fold = X.fr(f).diag[`leg_fold_${k}`];
		// the knee on its stop left the ankle under its target (compiler/limbs.js): raising the foot folds it further, the root comes up
		if (fold) return kneeFoldHint(X, k, f, kneeWhy("the sole is in the floor because the knee is on its stop: ", fold), c[`foot_${k}`]);
		const pitch = c[`fpitch_${k}`] ? `, or less fpitch_${k} (now ${m3(c[`fpitch_${k}`])} deg; + lifts the heel)` : "";
		return { cause: X.cause(`foot_${k}`, f), hint: `foot_${k}: raise ${m3(g.worst + 0.001)} m at f${f} (foot_* is the ankle; it stands ${ankleY(X.sk)} m above the floor)${pitch}`,
			fix: { channel: `foot_${k}`, f, delta: [0, g.worst + 0.001, 0] } };
	},
	FACE(X, g) {
		const nm = g.subject.replace(/ into head$/, ""), f = g.worstFrame, { s } = X.fr(f);
		const c = bonePoint(s, X.I.Head, X.sk.landmarks.headCentre);
		const p = probes(X, f, nm).reduce((best, q) => (headDepth(X.sk, s, q) > headDepth(X.sk, s, best) ? q : best));
		return towardFrom(X, g, nm, sub(p, c), g.worst - g.limit + MARGIN, "head");
	},
	BODY(X, g) {
		const [, nm, part] = /^(\S+) into (\S+)$/.exec(g.subject) ?? [];
		const cap = capsule(part), f = g.worstFrame, { s } = X.fr(f);
		if (!cap) return null;
		const A = s.P[X.I[cap[1]]], B = s.P[X.I[cap[2]]], ab = sub(B, A);
		const axis = p => add(A, scale(ab, clamp(dot(sub(p, A), ab) / dot(ab, ab), 0, 1)));
		const p = probes(X, f, nm).reduce((best, q) => (len(sub(q, axis(q))) < len(sub(best, axis(best))) ? q : best));
		return towardFrom(X, g, nm, sub(p, axis(p)), g.worst - g.limit + MARGIN, "torso");
	},
	SELF(X, g) {
		const f = g.worstFrame, { s } = X.fr(f), P = s.P, I = X.I;
		if (g.subject === "hands overlap") {
			const d = norm(sub(P[I.LeftHand], P[I.RightHand])), need = (g.worst - g.limit + MARGIN) / 2;
			const r = moveHint(X, "hand_l", f, scale(d, need));
			return { cause: r.cause, hint: `${r.hint}; and ${moveHint(X, "hand_r", f, scale(d, -need)).hint}`, fix: moveHint(X, "hand_l", f, scale(d, 2 * need)).fix };
		}
		const shins = g.subject === "shins touch", min = shins ? 0.1 : 0.135;
		const [a, b] = shins ? ["Leg", "Foot"] : ["UpLeg", "Leg"];
		const gap = segDist(P[I[`Left${a}`]], P[I[`Left${b}`]], P[I[`Right${a}`]], P[I[`Right${b}`]]);
		const d = sub(P[I[`Left${b}`]], P[I[`Right${b}`]]); d[1] = 0;
		const need = (min - gap + MARGIN) / 2, dir = norm(d);
		return { cause: X.cause("foot_l", f), hint: `foot_l: move ${vec(scale(dir, need))} m and foot_r ${vec(scale(dir, -need))} m at f${f} (${shins ? "shins" : "thighs"} ${m3(gap)} m apart, need ${min}); or spread knee_l/knee_r`,
			fix: { channel: "foot_l", f, delta: scale(dir, 2 * need) } };
	},
	OBJECT(X, g) {
		const [, id, oid] = /^(\S+) into (.+)$/.exec(g.subject) ?? [];
		const ch = X.spec.objects?.[id]?.channel;
		if (!ch) return null;
		const at = f => X.out.baked[ch]?.[f] ?? 0, clean = g.first > 0 ? at(g.first - 1) : at(0);
		return { cause: X.cause(ch, g.worstFrame), hint: `${ch}: keep it within ${m3(clean)} deg (it reaches ${m3(at(g.worstFrame))} at f${g.worstFrame}, ${m3(g.worst)} m into ${oid}), or move ${oid}`,
			fix: { channel: ch, f: g.worstFrame, value: clean } };
	},
	BALANCE(X, g) {
		const f = g.worstFrame, { s } = X.fr(f), P = s.P, I = X.I;
		if (g.subject === "no foot on the ground") return { cause: X.cause("root", f), hint: `at f${f} lower foot_l or foot_r to the floor (ankle y ${ankleY(X.sk)}), or declare checks.supports for the seat the hips rest on` };
		const com = scale(["Hips", "Spine1", "Spine2", "Head"].reduce((acc, j) => add(acc, P[I[j]]), [0, 0, 0]), 0.25);
		const feet = ["Left", "Right"].flatMap(S => Object.values(solePoints(X.sk, s, S)));
		const xs = feet.map(p => p[0]), zs = feet.map(p => p[2]), mg = 0.08 - 0.01;
		const to = [clamp(com[0], Math.min(...xs) - mg, Math.max(...xs) + mg), com[1], clamp(com[2], Math.min(...zs) - mg, Math.max(...zs) + mg)];
		return { cause: X.cause("root", f), hint: `root: move ${vec(sub(to, com))} m at f${f} (centre of mass over the feet), or step a foot under it`, fix: { channel: "root", f, delta: sub(to, com) } };
	},
};
