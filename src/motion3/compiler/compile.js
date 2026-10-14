// Motion spec -> baked frames. Deterministic and pure: the same spec and scene give the same
// frames, so the agent can edit keys and recompile in a loop.
//
// spec = { schema: "cozyclay.motion-spec.v1", fps, frames, keys, anchors, props, fits, objects, generators, checks }
//   keys:       [{ f, set: { channel: value }, step?: [channel] }]   (see pose.js for channel names)
//   hand mix:   hand_<l|r> (world point) blended with w_<anchor>_<l|r> weights (anchors.js)
//   fits:       [{ side, anchor, effector: { prop, point } | { joints: [...] }, offset? }]
//               moves the wrist so the effector lands on the anchor whenever that weight is on
//   objects:    { id: { pivot: [x,y,z], axis: [x,y,z], channel: "door" } }  hinge angle in degrees
//   generators: [{ type: "walk", f0, ... }]  (walk.js)
//   fix:        { reach, slide, penetration, retime }  deterministic auto-fixes (../fix/)
// ctx = { sk, scene: { objects: { id: { pos, R, half, ancestors } } } }; out.ctx.scene keeps the scene (object-pose.js)
import { add, sub, scale, norm, len, dot, apply, mul, axisRot, I3 } from "./math.js";
import { pose } from "./pose.js";
import { bakeChannels, channelsAt } from "./channels.js";
import { resolveAnchor, measureProps } from "./anchors.js";
import { expandGenerators } from "./walk.js";
import { fixOptions, applyFixes } from "../fix/index.js";

const smooth = x => x * x * (3 - 2 * x);

function objectTracks(spec, scene, baked) {
	const cache = new Map();
	return f => {
		if (cache.has(f)) return cache.get(f);
		const out = {};
		for (const [id, o] of Object.entries(scene?.objects ?? {})) {
			const hinge = spec.objects?.[id];
			if (hinge?.prop !== undefined) continue; // carried by a hand: not an obstacle (carried.js)
			if (!hinge) { out[id] = o; continue; }
			const ang = baked[hinge.channel]?.[f] ?? 0, R = axisRot(hinge.axis ?? [0, 1, 0], ang);
			out[id] = { ...o, pos: add(hinge.pivot, apply(R, sub(o.pos, hinge.pivot))), R: mul(R, o.R ?? I3()), angle: ang };
		}
		cache.set(f, out);
		return out;
	};
}

function effectorPoint(sk, s, diag, eff) {
	if (eff.prop) return diag.props?.[eff.prop]?.[eff.point];
	const js = eff.joints ?? ["RightHandIndex2", "RightHandMiddle2"];
	return scale(js.map(j => s.P[sk.index[j]]).reduce((a, p) => add(a, p), [0, 0, 0]), 1 / js.length);
}

function hooksFor(ctx, c, f, inFit = false) {
	const { sk } = ctx;
	return {
		softReach: ctx.softReach,
		// auto-fix offsets ride on the final pose only, so a fit never cancels them
		push: inFit ? undefined : k => ctx.push?.[k]?.get(f),
		handTarget(k, s, diag) {
			diag.frame = f;
			const fkHand = s.P[sk.index[k === "l" ? "LeftHand" : "RightHand"]];
			const terms = [];
			for (const [ch, w] of Object.entries(c)) {
				const m = /^w_(.+)_([lr])$/.exec(ch);
				if (!m || m[2] !== k || !(w > 1e-6)) continue;
				terms.push([w, add(resolveAnchor(ctx, m[1], s, diag, c), c[`fit_${m[1]}_${k}`] ?? [0, 0, 0])]);
			}
			let tot = terms.reduce((a, [w]) => a + w, 0);
			if (tot > 1) { for (const t of terms) t[0] /= tot; tot = 1; }
			let target = scale(c[`hand_${k}`] ?? fkHand, 1 - tot);
			for (const [w, p] of terms) target = add(target, scale(p, w));
			// Between targets, arc around the torso instead of cutting through it.
			const trans = Math.max(0, ...terms.map(([w]) => smooth(Math.min(1, Math.min(w, 1 - w) * 3))));
			if (trans > 0) {
				const a = s.P[sk.index.Spine], b = s.P[sk.index.Neck], u = sub(b, a);
				const t = Math.min(1, Math.max(0, dot(sub(target, a), u) / dot(u, u))), q = add(a, scale(u, t));
				const r = ctx.spec.detourRadius ?? 0.25, dv = sub(target, q), d = len(dv);
				if (d < r) {
					const fwd = apply(axisRot([0, 1, 0], c.yaw ?? 0), [0, 0, 1]);
					const dir = norm(add(d > 1e-6 ? scale(dv, 1 / d) : fwd, scale(fwd, 0.6)));
					target = add(target, scale(sub(add(q, scale(dir, r)), target), trans));
				}
			}
			return target;
		},
		afterArm: (k, s, diag) => measureProps(ctx, k, s, diag),
	};
}

/** One frame with every active fit solved (fits run in spec order). */
export function solveFrame(ctx, c0, f) {
	const c = { ...c0 };
	for (const fit of ctx.spec.fits ?? []) {
		const wch = `w_${fit.anchor}_${fit.side}`;
		if (!(c[wch] > 1e-4)) continue;
		const full = { ...c, [wch]: 1, [`armw_${fit.side}`]: 1 };
		for (const ch of Object.keys(full)) if (ch !== wch && new RegExp(`^w_.+_${fit.side}$`).test(ch)) full[ch] = 0;
		let corr = [0, 0, 0];
		for (let i = 0; i < 6; i++) {
			full[`fit_${fit.anchor}_${fit.side}`] = corr;
			const { s, diag } = pose(ctx.sk, full, hooksFor(ctx, full, f, true));
			const eff = effectorPoint(ctx.sk, s, diag, fit.effector);
			const goal = add(resolveAnchor(ctx, fit.anchor, s, diag, full), fit.offset ?? [0, 0, 0]);
			if (!eff) break;
			corr = add(corr, sub(goal, eff));
		}
		c[`fit_${fit.anchor}_${fit.side}`] = corr;
	}
	const { s, diag } = pose(ctx.sk, c, hooksFor(ctx, c, f));
	return { s, diag, c };
}

/**
 * opts.window = [a, b] solves only frames a..b (out.f0 = a, out.frames[i] is frame a + i);
 * opts.keys replaces the generator expansion; opts.fixes = false skips the auto-fix pass.
 */
export function compileMotion(spec, { sk, scene }, opts = {}) {
	if (spec?.schema !== "cozyclay.motion-spec.v1") throw new Error("MOTION_SPEC_INVALID: schema must be cozyclay.motion-spec.v1");
	const frameCount = Math.round(spec.frames);
	if (!(frameCount >= 1 && frameCount <= 20000)) throw new Error("MOTION_SPEC_INVALID: frames must be 1..20000");
	const fix = fixOptions(spec.fix);
	const [a, b] = opts.window ? [Math.max(0, opts.window[0]), Math.min(frameCount - 1, opts.window[1])] : [0, frameCount - 1];
	const ctx = { sk, spec, scene, softReach: fix.reach, push: { l: new Map(), r: new Map() } };
	const out = { ctx, fps: spec.fps ?? 30, frameCount, f0: a, frames: [] };
	const engine = {
		rebake(keys) {
			out.keys = keys;
			out.baked = bakeChannels(keys, frameCount);
			ctx.objectsAt = objectTracks(spec, scene, out.baked);
			out.objectsAt = a ? f => ctx.objectsAt(f + a) : ctx.objectsAt;
		},
		solve(frames) { for (const f of frames) if (f >= a && f <= b) out.frames[f - a] = solveFrame(ctx, channelsAt(out.baked, f), f); },
		all: () => Array.from({ length: b - a + 1 }, (_, i) => a + i),
	};
	engine.rebake(opts.keys ?? expandGenerators(spec, sk));
	engine.solve(engine.all());
	out.fixed = opts.fixes === false ? {} : applyFixes(out, fix, engine, { whole: !opts.window });
	return out;
}
