// Motion spec -> baked frames. Deterministic and pure: the same spec and scene give the same
// frames, so the agent can edit keys and recompile in a loop.
//
// spec = { schema: "cozyclay.motion-spec.v1", fps, frames, keys, anchors, props, fits, objects, generators, checks }
//   keys:       [{ f, set: { channel: value }, step?: [channel] }]   (see pose.js for channel names)
//   hand mix:   hand_<l|r> (world point) blended with w_<anchor>_<l|r> weights (anchors.js)
//   fits:       [{ side, anchor, effector: { prop, point } | { joints: [...] }, offset? }]
//               moves the wrist so the effector lands on the anchor whenever that weight is on
//   objects:    { id: { pivot: [x,y,z], axis: [x,y,z], channel: "door" } }  hinge angle in degrees
//               { id: { prop, grab?, release?, at?, along?, visible?, keys? } }   carried (../object-pose.js);
//               keys lead the holding hand (../object-keys.js, hold.js)
//               { id: { visible?, level? } }   a switch: shown/hidden and dimmed, never moved (C15)
//               { id: { follow, offset?, aim?, visible?, level? } }   rides a point of the body (C16, ../follow.js)
//               { id: { keys?, fall?, visible?, level? } }   moves on its own: keys and gravity falls (C17, ../free-motion.js)
//               id is a body or a group (Empty); a group moves every body under it
//   generators: [{ type: "walk", f0, ... }]  (walk.js)
//   fix:        { reach, slide, penetration, retime }  deterministic auto-fixes (../fix/)
// ctx = { sk, scene: { objects: { id: { pos, R, half, ancestors } } } }; out.ctx.scene keeps the scene (object-pose.js)
import { add, sub, scale, norm, len, dot, apply, axisRot } from "./math.js";
import { isCarried, isFollow, hingePose, movesRecord, compose, relative } from "../carried.js";
import { isFree, freePoseAt } from "../free-motion.js";
import { groupsOf } from "../scene.js";
import { pose, SIDES } from "./pose.js";
import { gripHand } from "./grip.js";
import { bakeChannels, channelsAt } from "./channels.js";
import { resolveAnchor, measureProps } from "./anchors.js";
import { expandGenerators } from "./walk.js";
import { fixOptions, applyFixes } from "../fix/index.js";
import { fitWeight } from "../fix/self.js";
import { holdHook } from "../object-keys.js";
import { HAND_CLEAR, keepOut, wristBody } from "../body.js";
import { objectPoseAt, handOf, restingAt } from "../object-pose.js";

const smooth = x => x * x * (3 - 2 * x);

/**
 * Scene boxes by frame. A body moves with its own spec.objects entry or its nearest group's (a
 * switch entry moves nothing; hinge: turned; free (C17): where its keys and falls put it, under the time map `mapOf()`;
 * carry and follow: left at its scene pose and marked `carried` with the moving id). `obstacles` drops the carried
 * ones: QA, refs and object anchors read a carry where it rides (object-pose.js objectPoseAt, qa/object-checks.js);
 * a follow entry rides the body and is no obstacle.
 */
function objectTracks(spec, scene, baked, mapOf = () => undefined) {
	const cache = new Map(), kept = new Map();
	let map = mapOf();
	const all = f => {
		// a retime maps free keys and falls too: frames read before it are read again
		if (mapOf() !== map) { map = mapOf(); cache.clear(); kept.clear(); }
		if (cache.has(f)) return cache.get(f);
		const out = {};
		for (const [id, o] of Object.entries(scene?.objects ?? {})) {
			const mover = [id, ...(o.ancestors ?? [])].find(k => movesRecord(spec.objects?.[k])), entry = spec.objects?.[mover];
			if (!entry) out[id] = o;
			else if (isCarried(entry) || isFollow(entry)) out[id] = { ...o, carried: mover };
			else if (isFree(entry)) out[id] = { ...o, ...compose(freePoseAt({ spec, scene, timeMap: map }, mover, f), relative(scene.objects[mover] ?? groupsOf(scene)[mover], o)) };
			else out[id] = { ...o, ...hingePose(entry, o, baked, f) };
		}
		cache.set(f, out);
		return out;
	};
	const obstacles = f => {
		if (mapOf() !== map) all(f);
		if (!kept.has(f)) kept.set(f, Object.fromEntries(Object.entries(all(f)).filter(([, box]) => !box.carried)));
		return kept.get(f);
	};
	return { all, obstacles };
}

function effectorPoint(sk, s, diag, eff) {
	if (eff.prop) return diag.props?.[eff.prop]?.[eff.point];
	const js = eff.joints ?? ["RightHandIndex2", "RightHandMiddle2"];
	return scale(js.map(j => s.P[sk.index[j]]).reduce((a, p) => add(a, p), [0, 0, 0]), 1 / js.length);
}

/** `lead` false solves without the object keys; a fit's own hand is solved without them (the keys override it). */
function hooksFor(ctx, c, f, inFit = false, lead = true, fitSide = null) {
	const { sk } = ctx;
	return {
		softReach: ctx.softReach,
		// a fit's passes find where the wrist must go with the elbow unstopped; the final pose stops its fold (limbs.js) and leaves the residual
		foldFree: inFit,
		hold: lead && ctx.hold ? (k, s) => (k === fitSide ? null : ctx.hold.lead(k, f, s, c)) : undefined,
		// auto-fix offsets ride on the final pose only, so a fit never cancels them
		push: inFit ? undefined : k => ctx.push?.[k]?.get(f),
		swivel: k => ctx.swivel?.[k]?.get(f), // in a fit's passes too: a turn that stops at the wrist's limit moves the fit's point (wrist-clamp.js)
		skinPush: inFit ? undefined : k => ctx.skinPush?.[k]?.get(f),
		handTarget(k, s, diag) {
			diag.frame = f;
			const fkHand = s.P[sk.index[k === "l" ? "LeftHand" : "RightHand"]];
			const terms = [];
			for (const [ch, w] of Object.entries(c)) {
				const m = /^w_(.+)_([lr])$/.exec(ch);
				if (!m || m[2] !== k || !(w > 1e-6)) continue;
				terms.push([w, add(resolveAnchor(ctx, m[1], s, diag, c, k), c[`fit_${m[1]}_${k}`] ?? [0, 0, 0])]);
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
			// a wrist target inside the body (a pocket on a squatting thigh, a path through the chest) goes out onto its skin
			return target;
		},
		// the wrist target, blended with the FK hand, inside the body goes out onto its skin, twice at most (out of
		// one bone, then the next): a pocket the squat moved into the thigh, a path through the chest, a hand leaving
		// a thigh for its FK rest. A measured target (a fit's anchor: the mouth; or a prop another hand's fit is on:
		// the cigarette under the flame) stays where its goal needs it, and the move fades in and out with its weight;
		// an arm coming in from FK moves it no more than its IK weight.
		keepOut: ctx.keepOut && !inFit ? (k, s, target) => {
			const free = (1 - fitWeight(ctx.spec, c, k)) * Math.min(1, Math.max(0, c[`armw_${k}`] ?? 0));
			for (let i = 0; i < 2 && free > 1e-3; i++) {
				const moved = keepOut(ctx.keepOut.body, sk, s, target, HAND_CLEAR, ctx.keepOut.skip);
				if (moved === target) break;
				target = add(target, scale(sub(moved, target), free));
			}
			return target;
		} : undefined,
		afterArm: (k, s, diag) => measureProps(ctx, k, s, diag),
		// a fit's passes only place the wrist; the final pose (and a plain one) turns the hand onto the body
		grip: inFit ? undefined : (k, s, diag) => gripHand(ctx, sk, s, SIDES[k], k, c, f, diag),
	};
}

/** One frame with every active fit solved (fits run in spec order); lead false leaves the object keys out. */
export function solveFrame(ctx, c0, f, lead = true) {
	const c = { ...c0 };
	for (const fit of ctx.spec.fits ?? []) {
		const wch = `w_${fit.anchor}_${fit.side}`;
		if (!(c[wch] > 1e-4)) continue;
		const full = { ...c, [wch]: 1, [`armw_${fit.side}`]: 1 };
		for (const ch of Object.keys(full)) if (ch !== wch && new RegExp(`^w_.+_${fit.side}$`).test(ch)) full[ch] = 0;
		let corr = [0, 0, 0];
		for (let i = 0; i < 6; i++) {
			full[`fit_${fit.anchor}_${fit.side}`] = corr;
			const { s, diag } = pose(ctx.sk, full, hooksFor(ctx, full, f, true, lead, fit.side));
			const eff = effectorPoint(ctx.sk, s, diag, fit.effector);
			const goal = add(resolveAnchor(ctx, fit.anchor, s, diag, full, fit.side), fit.offset ?? [0, 0, 0]);
			if (!eff) break;
			corr = add(corr, sub(goal, eff));
		}
		c[`fit_${fit.anchor}_${fit.side}`] = corr;
	}
	const { s, diag } = pose(ctx.sk, c, hooksFor(ctx, c, f, false, lead));
	// readers of the solved frame (refs, checks, hints) resolve its anchors at f, IK arms or not
	diag.frame = f;
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
	const ctx = { sk, spec, scene, softReach: fix.reach, push: { l: new Map(), r: new Map() }, swivel: { l: new Map(), r: new Map() }, skinPush: { l: new Map(), r: new Map() }, keepOut: fix.self ? wristBody(sk) : null };
	const out = { ctx, fps: spec.fps ?? 30, frameCount, f0: a, frames: [] };
	// object anchors read the pose refs read (object-pose.js), on the frame being solved
	ctx.objectPose = (id, f, now) => objectPoseAt(out, id, f, now);
	ctx.objectHand = (id, f) => handOf(out, id, f);
	// a keyed carry's grab offset is taken where it rests at grab (object-keys.js; a fall before grab: where it landed)
	ctx.restingAt = (id, f) => restingAt(out, id, f);
	const engine = {
		rebake(keys) {
			out.keys = keys;
			out.baked = bakeChannels(keys, frameCount);
			const tracks = objectTracks(spec, scene, out.baked, () => out.timeMap);
			ctx.objectsAt = tracks.all;
			out.objectsAt = a ? f => tracks.obstacles(f + a) : tracks.obstacles;
		},
		solve(frames) { for (const f of frames) if (f >= a && f <= b) out.frames[f - a] = solveFrame(ctx, channelsAt(out.baked, f), f); },
		all: () => Array.from({ length: b - a + 1 }, (_, i) => a + i),
	};
	ctx.hold = holdHook(ctx, out, f => solveFrame(ctx, channelsAt(out.baked, f), f, false), f => solveFrame(ctx, channelsAt(out.baked, f), f));
	engine.rebake(opts.keys ?? expandGenerators(spec, sk));
	engine.solve(engine.all());
	out.fixed = opts.fixes === false ? {} : applyFixes(out, fix, engine, { whole: !opts.window });
	// a retime maps the key frames only once it is done: solve the keyed frames again on the final map
	if (ctx.hold && out.timeMap) engine.solve(engine.all());
	return out;
}
