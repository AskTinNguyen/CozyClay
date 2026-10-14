// Hints for GOAL groups (C8, C6). The hint moves whatever drives the goal's moving side at the
// worst frame by the shortfall (+3 mm): a hand (a hand joint, a prop point, an object in hand),
// else a foot or the root, through moveHint (hints-contact.js, read only). The fix is
// { channel: "hand_l", f, delta } when the hand target drives that hand (qa/patch.js turns it into
// a patch), { path: "/anchors/<a>/p", delta } when a world anchor does, and none for an FK arm.
import { resolveBone } from "../bones.js";
import { inHandAt } from "../object-pose.js";
import { refPoint } from "../refs.js";
import { scale, norm, sub, len } from "../compiler/math.js";
import { moveHint } from "./hints-contact.js";
import { goalKinds, goalName, goalNeed, scenePoint } from "./goals.js";
import { m3 } from "./fmt.js";

const MARGIN = 0.003;

/** The goal a GOAL group reports: the longest name its subject starts with. */
function goalOf(X, g) {
	let best = null;
	(X.spec?.goals ?? []).forEach((goal, i) => {
		const name = goalName(goal, i);
		if (g.subject.startsWith(`${name}:`) && (!best || name.length > best.name.length)) best = { goal, name };
	});
	return best;
}

/** The record that carries object `id` at frame f (the id itself or a group above it), or null. */
function carrierOf(X, id, f) {
	const ids = [id, ...(X.out.ctx.scene?.objects?.[id]?.ancestors ?? [])];
	const key = ids.find(k => inHandAt(X.spec.objects?.[k], f));
	return key ? X.spec.objects[key] : null;
}

/** The body part (moveHint name) that moves ref at frame f: hand_<k>, foot_<k>, root, or null for a still point. */
function partOf(X, ref, f) {
	const [, kind, rest] = /^([a-z]+):(.+)$/s.exec(ref) ?? [];
	if (kind === "prop") return X.spec.props?.[rest.split(".")[0]]?.hand ? `hand_${X.spec.props[rest.split(".")[0]].hand}` : null;
	if (kind === "object") {
		const o = carrierOf(X, rest.replace(/\.(center|top|base)$/, ""), f), k = o && X.spec.props?.[o.prop]?.hand;
		return k ? `hand_${k}` : null;
	}
	if (kind === "landmark") return "root";
	if (kind !== "joint" && kind !== "bone") return null;
	const bone = resolveBone(X.sk, rest).bone ?? "", side = /^Left/.test(bone) ? "l" : /^Right/.test(bone) ? "r" : null;
	if (side && /^(Left|Right)(Hand|ForeArm)/.test(bone)) return `hand_${side}`;
	if (side && /^(Left|Right)(Foot|Toe|Leg)/.test(bone)) return `foot_${side}`;
	return "root";
}

/** fix for moving `part` by delta at f, when it applies to a channel or a world anchor. */
function fixFor(X, part, f, delta) {
	const k = part.slice(-1);
	if (!part.startsWith("hand_")) return { channel: part, f, delta };
	const d = X.hand(k, f);
	if (d.ch === `hand_${k}`) return { channel: d.ch, f, delta };
	if (d.anchor && X.spec.anchors?.[d.anchor]?.kind === "world") return { path: `/anchors/${d.anchor}/p`, delta };
	return null;
}

/** The side to move and its delta: [part, delta], hands first, then a body part, a to b. */
function plan(X, goal, kind, f, amount) {
	if (kind === "moved") {
		const part = partOf(X, goal.moved, f), home = scenePoint(X.out.ctx.scene, goal.moved);
		const p = refPoint(X.out, f, /\.(center|top|base)$/.test(goal.moved) ? goal.moved : `${goal.moved}.base`);
		const away = p && home && len(sub(p, home)) > 1e-3 ? norm(sub(p, home)) : [0, 1, 0];
		return part ? [part, scale(away, amount)] : null;
	}
	const [a, b] = goal[kind], pa = partOf(X, a, f), pb = partOf(X, b, f);
	const rank = p => (p?.startsWith("hand_") ? 2 : p ? 1 : 0), moveA = rank(pa) >= rank(pb);
	const part = moveA ? pa : pb, sign = moveA ? 1 : -1;
	if (!part) return null;
	if (kind === "above") return [part, [0, sign * amount, 0]];
	const qa = refPoint(X.out, f, a), qb = refPoint(X.out, f, b);
	return qa && qb ? [part, scale(norm(sub(qb, qa)), sign * amount)] : null;
}

export const goalHints = {
	/** GOAL(X, g) -> { cause, hint, fix? } | null */
	GOAL(X, g) {
		const found = X.spec && goalOf(X, g), f = g.worstFrame;
		if (!found) return { cause: `goal ${g.subject.split(":")[0]}`, hint: `change the keys around f${f} until the goal holds` };
		const { goal, name } = found, kind = goalKinds(goal)[0], amount = g.worst + MARGIN;
		const why = ` (goal "${name}" is ${m3(g.worst)} m short; needs ${kind === "near" ? "<=" : ">="} ${goalNeed(goal, kind)})`;
		const move = plan(X, goal, kind, f, amount);
		if (!move) {
			if (kind === "moved") {
				const id = goal.moved.slice(7).replace(/\.(center|top|base)$/, "");
				return { cause: `objects.${id}`, hint: `${id} is not in a hand at f${f}, so nothing moves it: carry it (objects.${id} = { prop, grab }) or hinge it` };
			}
			return { cause: `goal ${name}`, hint: `neither ${goal[kind][0]} nor ${goal[kind][1]} moves with the body at f${f}; name a joint, prop point or held object` };
		}
		const [part, delta] = move, r = moveHint(X, part, f, delta, why), fix = fixFor(X, part, f, delta);
		return { cause: r.cause, hint: r.hint, ...(fix ? { fix } : {}) };
	},
};
