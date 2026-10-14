// C16. Aim keys: a held-object key (C14) may give aim [x, y, z], the world direction the object's
// +Y points (a bat: knob to barrel), with an optional roll (degrees about that direction,
// right-handed), in place of the quaternion rot. An aim key turns the object the shortest way
// from where the plain carry (no keys) holds it at that key's frame onto aim, then by roll.
// (Turning from the key before instead piles the roll up over a swing: the bat fixture's keys as
// aims, so chained, missed by 45.5 cm.)
// Without roll (lane K8) the key takes the roll the arm holds most easily: ROLLS candidate rolls
// about aim are scored by the strain of the arm that holds them (compiler/hold.js holdCost), a
// pass over the keys in order picks one per key with a light price on how far the object turns
// from the key before (so equally easy rolls do not alternate), and a golden-section search
// settles each pick within its step. roll given (0 included) and rot keys are used exactly.
// The quaternion is rounded to 1e-5 (the grid motion.keyObject writes) and kept on the hemisphere
// of the key before it.
import { qmul, qrot, qdot, qnorm, arcQuat, axisQuat } from "./compiler/quat.js";
import { norm } from "./compiler/math.js";

const ROLLS = 24, STEP = 360 / ROLLS, TURN = 0.2, GOLDEN = 12;
const round5 = v => Math.round(v * 1e5) / 1e5;
/** The turn between two unit quaternions, radians. */
const turn = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(qdot(a, b))));

/** The pick per key: DP over candidates [{ q, cost }] per key, a TURN price on the squared turn between neighbours. */
function chain(cands) {
	let best = cands[0].map(c => ({ total: c.cost, from: -1 }));
	const back = [best];
	for (let i = 1; i < cands.length; i++) {
		best = cands[i].map(c => {
			let pick = { total: Infinity, from: -1 };
			cands[i - 1].forEach((p, j) => { const t = back[i - 1][j].total + TURN * turn(p.q, c.q) ** 2; if (t < pick.total) pick = { total: t, from: j }; });
			return { total: pick.total + c.cost, from: pick.from };
		});
		back.push(best);
	}
	const picks = [];
	for (let i = cands.length - 1, j = best.reduce((m, b, k) => (b.total < best[m].total ? k : m), 0); i >= 0; j = back[i][j].from, i--) picks[i] = j;
	return picks;
}

/** Golden-section search of f on [lo, hi]. */
function golden(f, lo, hi) {
	const g = (Math.sqrt(5) - 1) / 2;
	let a = lo, b = hi, c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
	for (let i = 0; i < GOLDEN; i++) {
		if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
	}
	return (a + b) / 2;
}

/**
 * The rot of each key (keys sorted by f): a rot key's own, an aim key's resolved quaternion
 * [x, y, z, w]. plain(i) is the rotation (a quaternion) the plain carry gives the object at key
 * i's frame; it is asked for aim keys only. strain(i, q), when given, is the arm's cost of
 * holding key i at rotation q; it picks the roll of aim keys that give none.
 */
export function keyRots(keys, plain, strain) {
	const at = keys.map((k, i) => {
		if (k.aim === undefined) return { fixed: qnorm(k.rot) };
		const from = qnorm(plain(i)), d = norm(k.aim), q0 = qmul(arcQuat(norm(qrot(from, [0, 1, 0])), d), from);
		const rolled = r => qmul(axisQuat(d, r), q0);
		return k.roll !== undefined || !strain ? { fixed: k.roll ? rolled(k.roll) : q0 } : { rolled };
	});
	const cands = at.map((a, i) => (a.fixed ? [{ q: a.fixed, cost: 0, r: 0 }]
		: Array.from({ length: ROLLS }, (_, j) => { const r = j * STEP - 180, q = a.rolled(r); return { q, cost: strain(i, q), r }; })));
	const picks = chain(cands), chosen = cands.map((c, i) => c[picks[i]]);
	const rots = [];
	let prev = null;
	for (const [i, a] of at.entries()) {
		if (keys[i].aim === undefined) { rots.push(keys[i].rot); prev = a.fixed; continue; }
		let q = (a.fixed ?? a.rolled(golden(r => {
			const qr = a.rolled(r), near = [chosen[i - 1], chosen[i + 1]].filter(Boolean);
			return strain(i, qr) + near.reduce((sum, n) => sum + TURN * turn(n.q, qr) ** 2, 0);
		}, chosen[i].r - STEP / 2, chosen[i].r + STEP / 2))).map(round5);
		if (prev && qdot(q, prev) < 0) q = q.map(v => -v);
		rots.push(q);
		prev = qnorm(q);
	}
	return rots;
}
