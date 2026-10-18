#!/usr/bin/env node
// C17: objects nobody holds move by keys and fall. A can above a shelf falls onto it (t = sqrt(2h/g)), bounces at most
// once and never sinks; a crate group lifted by keys falls as one onto the floor or a named object; keys after a fall
// take over; an aim key turns the scene pose's +Y onto aim. A carry falls before its grab (the hand takes it where it
// landed, without a jump) and after its release. Every pose reader sees it: object-pose.js, refs, the compiler's
// obstacles, the baked take (vis included). Bad keys and falls are refused with the reason.
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { refPoint } from "../../src/motion3/refs.js";
import { objectPoseAt, objectBoxesAt } from "../../src/motion3/object-pose.js";
import { fallPlans, landingOf, G, BOUNCE_MAX } from "../../src/motion3/free-motion.js";
import { bakeTake } from "../../src/motion3/take.js";
import { validateSpec } from "../../src/motion3/compiler/validate.js";
import { grabGap } from "../../src/motion3/qa/object-checks.js";
import { sdBox } from "../../src/motion3/qa/geometry.js";
import { dist } from "../../src/motion3/compiler/math.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const refusal = run => { try { run(); return ""; } catch (error) { return error.message; } };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const rec = (id, renderer, x, y, z, s, extra = {}) => ({ id, name: id, renderer, x, y, z, rot: 0, rotX: 0, rotZ: 0, scaleX: s[0], scaleY: s[1], scaleZ: s[2], footprint: { width: 1, depth: 1 }, height: 1, ...extra });
// A shelf 0.9 m high right ahead with a can 0.4 m above it, a table to the left, a crate (two parts) on the floor to the right.
const RECORDS = [
	rec("shelf", "cube", 0, 0, 0.45, [0.4, 0.9, 0.3]),
	rec("can", "cylinder", 0, 1.3, 0.45, [0.066, 0.12, 0.066]),
	rec("table", "cube", 1.2, 0, 0.5, [0.6, 0.7, 0.6]),
	rec("crate", "empty", -0.9, 0, 1, [1, 1, 1], { footprint: { width: 0, depth: 0 }, height: 0 }),
	rec("crateBody", "cube", -0.9, 0, 1, [0.3, 0.3, 0.3], { parent: "crate" }),
	rec("crateLid", "cube", -0.9, 0.3, 1, [0.3, 0.02, 0.3], { parent: "crate" }),
];
const sk = skeletonFor("y-bot-tpose"), scene = motionScene(RECORDS), I = sk.index, P = sk.restWorldPos, Q = [0, 0, 0, 1];
const ank = P[I.LeftFoot][1];
const stand = (frames, more = {}) => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames,
	keys: [{ f: 0, set: { root: [0, P[I.Hips][1] - 0.01, 0], yaw: 0, foot_l: [0.09, ank, -0.03], foot_r: [-0.09, ank, 0.03], fyaw_l: 0, fyaw_r: 0 } }], ...more });
const compile = spec => compileSpec(spec, { sk, scene });
const y = (out, id, f) => objectPoseAt(out, id, f).pos[1];
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// 1. a fall onto the shelf: lands at t = sqrt(2h/g), one small bounce, never below the shelf top
{
	const r = compile(stand(60, { objects: { can: { fall: { at: 10 } } } })), out = r.out;
	const [plan] = fallPlans({ spec: out.ctx.spec, scene, timeMap: out.timeMap }, "can");
	expect("the can lands on the shelf (support shelf, top 0.9 m, drop 0.4 m)", plan?.support === "shelf" && near(plan.top, 0.9) && near(plan.h, 0.4), JSON.stringify(plan));
	expect("it lands sqrt(2h/g) after it starts to fall", near(plan.land - 10, Math.sqrt(2 * 0.4 / G) * 24, 1e-9), plan.land);
	expect("it is still where the scene put it up to the fall", range(0, 10).every(f => near(y(out, "can", f), 1.3)), range(0, 10).map(f => y(out, "can", f)));
	expect("it never sinks into the shelf", range(0, 59).every(f => y(out, "can", f) >= 0.9 - 1e-9), Math.min(...range(0, 59).map(f => y(out, "can", f))));
	const bounce = Math.max(...range(Math.ceil(plan.land), 59).map(f => y(out, "can", f))) - 0.9;
	expect(`it bounces once, no higher than ${BOUNCE_MAX} m, then rests on the top`, bounce > 0 && bounce <= BOUNCE_MAX + 1e-9 && near(y(out, "can", 59), 0.9), bounce);
	expect("refs read it where it is (object:can.base)", range(0, 59).every(f => dist(refPoint(out, f, "object:can.base"), objectPoseAt(out, "can", f).pos) < 1e-9));
	const box = out.objectsAt(25).can;
	expect("the compiler's obstacles have it where it is (an obstacle at its pose that frame)", !!box && !box.carried && near(box.pos[1], y(out, "can", 25)), JSON.stringify(box?.pos));
	const dead = compile(stand(60, { objects: { can: { fall: { at: 10, bounce: 0 } } } })).out;
	expect("bounce 0 lands dead", range(18, 59).every(f => near(y(dead, "can", f), 0.9)), range(17, 22).map(f => y(dead, "can", f)));
}

// 2. a group lifted by keys falls as one, onto the floor or a named object; keys after a fall take over
{
	const up = { f: 15, pos: [-0.9, 1.0, 1], rot: Q }, keys = [{ f: 5, pos: [-0.9, 0, 1], rot: Q }, up];
	const out = compile(stand(80, { objects: { crate: { keys, fall: { at: 20, bounce: 0 } } } })).out;
	const lid = f => objectBoxesAt(out, "crateLid", f)[0].pos, body = f => objectBoxesAt(out, "crateBody", f)[0].pos;
	expect("before its first key it is at its scene pose, at a key where the key puts it", near(objectPoseAt(out, "crate", 3).pos[1], 0) && near(objectPoseAt(out, "crate", 15).pos[1], 1.0));
	expect("between keys it moves on the key curve (rising, inside the keys)", y(out, "crate", 10) > 0 && y(out, "crate", 10) < 1.0, y(out, "crate", 10));
	expect("the group falls as one: the lid stays on the body every frame", range(0, 79).every(f => near(lid(f)[1] - body(f)[1], 0.3, 1e-9)));
	expect("it lands on the floor (nothing below), the drop is its height", near(y(out, "crate", 79), 0) && fallPlans({ spec: out.ctx.spec, scene, timeMap: out.timeMap }, "crate")[0].support === null);
	const over = { f: 15, pos: [1.2, 1.2, 0.5], rot: Q };
	const onTable = compile(stand(80, { objects: { crate: { keys: [keys[0], over], fall: { at: 20, bounce: 0 } } } })).out;
	expect("from over the table it lands on the table top (0.7 m)", near(y(onTable, "crate", 79), 0.7), y(onTable, "crate", 79));
	const onShelf = compile(stand(80, { objects: { crate: { keys: [keys[0], over], fall: { at: 20, onto: "shelf", bounce: 0 } } } })).out;
	expect("onto names what it lands on: the shelf top (0.9 m) though the table is below", near(y(onShelf, "crate", 79), 0.9) && near(landingOf(onShelf.ctx.spec, scene, "crate", { pos: [1.2, 1.2, 0.5], R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }, "shelf").top, 0.9), y(onShelf, "crate", 79));
	const chain = compile(stand(90, { objects: { crate: { keys: [...keys, { f: 60, pos: [-0.9, 0, 1], rot: Q }, { f: 70, pos: [-0.9, 0.5, 1], rot: Q }], fall: { at: 20, bounce: 0 } } } })).out;
	expect("keys after a fall take over at their first key and hold the last", near(y(chain, "crate", 50), 0) && y(chain, "crate", 65) > 0 && near(y(chain, "crate", 89), 0.5), [50, 65, 89].map(f => y(chain, "crate", f)));
	const aimed = compile(stand(40, { objects: { crate: { keys: [{ f: 5, pos: [-0.9, 0, 1], aim: [0, 1, 0] }, { f: 15, pos: [-0.9, 0.5, 1], aim: [1, 0, 0] }] } } })).out;
	const R = objectPoseAt(aimed, "crate", 30).R;
	expect("an aim key turns the scene pose's +Y onto aim", near(R[0][1], 1, 1e-4) && near(R[1][1], 0, 1e-4), JSON.stringify(R));
}

// 3. a carry falls before its grab (taken where it landed, no jump) and after its release
{
	const spec = stand(110, {
		anchors: { canHold: { kind: "object", object: "can", local: [0, 0.06, 0] } },
		use: [{ skill: "reachGrip", f0: 30, args: { anchor: "canHold", side: "r", reach: 12, hold: 30 } }],
		// in hand, keys lift it off the shelf and to the right; it is let go there and falls to the floor
		objects: { can: { prop: "canHoldGrip", grab: 42, release: 72, fall: [{ at: 5, bounce: 0 }, { at: 74 }],
			keys: [{ f: 50, pos: [-0.35, 1.1, 0.35], rot: Q }, { f: 72, pos: [-0.35, 1.1, 0.35], rot: Q }] } } });
	const r = compile(spec), out = r.out;
	expect("before its grab the can lies where it fell (on the shelf)", near(y(out, "can", 40), 0.9), y(out, "can", 40));
	expect("at the grab it is where it landed (no jump into the hand)", dist(objectPoseAt(out, "can", 42).pos, objectPoseAt(out, "can", 41).pos) < 1e-6, dist(objectPoseAt(out, "can", 42).pos, objectPoseAt(out, "can", 41).pos));
	const landed = { pos: [0, 0.9, 0.45], R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: scene.objects.can.half };
	expect("GRAB measures the hand against where it landed", grabGap(out, "can", 42) !== null && near(grabGap(out, "can", 42), Math.max(0, sdBox(refPoint(out, 42, "prop:canHoldGrip.origin"), landed)), 1e-9), grabGap(out, "can", 42));
	const released = objectPoseAt(out, "can", 73), end = objectPoseAt(out, "can", 109), plan = landingOf(out.ctx.spec, scene, "can", released);
	expect("after its release it falls from the release pose straight down onto what is below", released.pos[1] - end.pos[1] > 0.5 && near(end.pos[1], released.pos[1] - plan.h, 1e-9)
		&& near(end.pos[0], released.pos[0], 1e-9) && near(end.pos[2], released.pos[2], 1e-9), `${released.pos} -> ${end.pos} (support ${plan.support}, drop ${plan.h})`);
}

// 4. the take bakes it (world pose, vis when it names a channel)
{
	const spec = stand(40, { keys: [...stand(40).keys, { f: 0, set: { canVis: 0 } }, { f: 12, set: { canVis: 1 }, step: ["canVis"] }], objects: { can: { fall: { at: 10 }, visible: "canVis" } } });
	const r = compile(spec), take = bakeTake(sk, r.out), track = take.objects.can;
	expect("the take bakes its world pose every frame", !!track?.pos && near(track.pos[39 * 3 + 1], y(r.out, "can", 39), 1e-6) && !track.hold, JSON.stringify(Object.keys(track ?? {})));
	expect("and its visible channel", !!track?.vis && track.vis[5] === 0 && track.vis[20] === 1, track?.vis && [track.vis[5], track.vis[20]]);
}

// 5. validation says what is wrong
{
	const v = objects => refusal(() => validateSpec(stand(40, { objects }), { sk, scene }));
	expect("a free key outside the take is refused", /objects\.can\.keys\[0\]\.f = 50 is outside the take \(0\.\.39\)/.test(v({ can: { keys: [{ f: 50, pos: [0, 1, 0], rot: Q }] } })), v({ can: { keys: [{ f: 50, pos: [0, 1, 0], rot: Q }] } }));
	const inHand = v({ can: { prop: "p", grab: 10, release: 30, fall: { at: 20 } } });
	expect("a carried object falling while in hand is refused", /fall\.at = 20 is while it is in hand/.test(inHand), inHand);
	expect("bounce outside 0..0.6 is refused", /bounce must be 0\.\.0\.6/.test(v({ can: { fall: { at: 5, bounce: 0.9 } } })));
	expect("onto an unknown object is refused", /fall\.onto/.test(v({ can: { fall: { at: 5, onto: "nope" } } })), v({ can: { fall: { at: 5, onto: "nope" } } }));
	expect("an unknown fall field is refused with the fields", /unknown field "speed".*a fall is \{ at, onto\?, bounce\? \}/.test(v({ can: { fall: { at: 5, speed: 2 } } })), v({ can: { fall: { at: 5, speed: 2 } } }));
	expect("a fall needs its frame", /fall\.at must be the whole frame/.test(v({ can: { fall: {} } })));
	const hinge = v({ can: { pivot: [0, 0, 0], channel: "door", keys: [] } });
	expect("a hinge with keys says where keys belong", /keys and fall move an object with no pivot, axis or channel/.test(hinge), hinge);
	expect("a free entry with keys and a fall is valid", v({ can: { keys: [{ f: 2, pos: [0, 1.3, 0.45], rot: Q }], fall: [{ at: 5 }, { at: 30, onto: "shelf", bounce: 0 }], visible: "canVis" } }) === "");
}

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("PASS free objects (keys and falls)");
