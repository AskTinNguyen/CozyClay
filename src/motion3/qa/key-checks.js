// QA of held-object keys (C14, ../object-keys.js). From the first to the last key the object
// leads the hand; the object is drawn in the hand, so what the arm or the wrist could not reach
// leaves the object off the pose its keys ask for. That residual is measured on the object, as the
// farthest corner of its part boxes from where the keys put it:
//   REACH  "<id>: 6.2 cm off its keys", value metres, limit checks.limits.reach (default 0.01)
// The hint names the key and why the hand fell short (diag.hold_<side>, compiler/hold.js): the
// arm out of reach, or a wrist turn past its limit.
import { keyedEntries, curveIn, keyedPose } from "../object-keys.js";
import { rootPoseAt, partsOf } from "../object-pose.js";
import { relative } from "../carried.js";
import { groupsOf } from "../scene.js";
import { WRIST_LIMITS } from "../compiler/hold.js";
import { add, apply, dist } from "../compiler/math.js";

const SUBJECT = /^(.+): [\d.]+ cm off its keys$/;
const WRIST_WORDS = { twist: "twist about the forearm", flex: "flex", dev: "deviation (+ toward the thumb)" };

/** The corners of id's part boxes in its root frame (the box spans y 0..2 half on its base pivot). */
function cornersOf(scene, id) {
	const root = scene.objects[id] ?? groupsOf(scene)[id];
	return partsOf(scene, id).flatMap(p => {
		const box = scene.objects[p], rel = relative(root, box), [x, y, z] = box.half;
		return [-x, x].flatMap(a => [0, 2 * y].flatMap(b => [-z, z].map(c => add(rel.pos, apply(rel.R, [a, b, c])))));
	});
}

/** REACH issues of every keyed carry, frames as out.frames indexes. */
export function keyIssues(out, L, push) {
	const { scene } = out.ctx, f0 = out.f0 ?? 0;
	for (const [id] of keyedEntries(out.ctx.spec)) {
		const curve = curveIn(out, id), corners = cornersOf(scene, id);
		if (!corners.length) continue;
		for (let f = Math.max(f0, Math.ceil(curve.t[0])); f <= Math.min(f0 + out.frames.length - 1, Math.floor(curve.t[curve.t.length - 1])); f++) {
			const want = keyedPose(curve, f), got = rootPoseAt(out, id, f);
			const off = Math.max(...corners.map(c => dist(add(want.pos, apply(want.R, c)), add(got.pos, apply(got.R, c)))));
			if (off > L.reach) push("REACH", `${id}: ${(off * 100).toFixed(1)} cm off its keys`, f - f0, off, L.reach);
		}
	}
}

/** REACH for a keyed object ("<id>: 6.2 cm off its keys") -> { cause, hint }, else null. */
export function keyHint(X, g) {
	const id = SUBJECT.exec(g.subject)?.[1], o = X.spec?.objects?.[id];
	if (!o?.keys?.length) return null;
	const f = g.worstFrame, k = X.spec.props?.[o.prop]?.hand, h = X.fr(f).diag[`hold_${k}`] ?? {};
	const near = o.keys.reduce((best, key, i) => (Math.abs(key.f - f) < Math.abs(o.keys[best].f - f) ? i : best), 0);
	const why = [...(h.miss > 0.005 ? [`the arm is ${(h.miss * 100).toFixed(1)} cm short`] : []),
		...Object.entries(WRIST_LIMITS).filter(([n, [lo, hi]]) => h[n] < lo || h[n] > hi).map(([n, [lo, hi]]) => `the wrist ${WRIST_WORDS[n]} needs ${Math.round(h[n])}deg (limit ${lo}..${hi})`)];
	return { cause: `objects.${id}.keys[${near}] f${o.keys[near].f}`,
		hint: `${id} at f${f}: ${why.length ? why.join(", ") : "the hand cannot hold it there"}; key a pose nearer the hand (turned back toward the forearm), or bring the body to it (root, yaw, spine_yaw)` };
}
