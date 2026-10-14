#!/usr/bin/env node
// The agent loop helpers: every QA group carries a cause and a hint, applying a hint removes the
// issue, the auto-fixes (reach, slide, penetration, retime) report what they changed and leave
// QA clean, and the strict validator answers exact messages.
import { EXITCAR_SPEC, SCENE_OBJECTS } from "./fixtures/exitcar-scene.mjs";
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { I3 } from "../../src/motion3/compiler/math.js";
import { createStudioAppActions } from "../../src/commands/index.js";
import { SCENE_OBJECTS as CUP_OBJECTS, CHARACTER as CUP_CHARACTER } from "./fixtures/cup-scene.mjs";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const sk = skeletonFor("x-bot-tpose"), I = sk.index, car = motionScene(SCENE_OBJECTS), empty = { objects: {} };
const compile = (spec, scene = car) => compileSpec(spec, { sk, scene });
const show = (label, r) => {
	console.log(`  ${label}: ${r.qa.total} issues, fixed ${JSON.stringify(r.fixed)}, ${JSON.stringify(r.ms)}`);
	for (const g of r.qa.groups.slice(0, 3)) console.log(`    [${g.count}] ${g.kind} ${g.subject} f${g.first}-${g.last}\n      cause: ${g.cause}\n      hint:  ${g.hint}`);
};
const broken = edit => { const s = structuredClone(EXITCAR_SPEC); edit(s); return s; };

// 1. Hints: a seat set 7 cm too low; the hint names keys[0] and says how far to raise the root.
const low = broken(s => { s.keys[0].set.root = [0.48, 0.85, -0.052]; });
let r = compile(low);
show("hips sunk into the seat", r);
const hit = r.qa.groups.find(g => g.kind === "COLLIDE" && g.subject === "hips x Car_Seat_Driver");
expect("every group has a cause and a hint", r.qa.groups.every(g => typeof g.cause === "string" && typeof g.hint === "string"), JSON.stringify(r.qa.groups.map(g => [g.kind, g.cause])));
expect("the seat hit is caused by keys[0] f0 root", hit?.cause === "keys[0] f0 root", hit?.cause);
const move = /^root: move \[([^\]]+)\] m at f(\d+)/.exec(hit?.hint ?? "");
expect("the hint is a world move of the root, upward", move && Number(move[1].split(",")[1]) > 0.02, hit?.hint);
const fixedLow = broken(s => { s.keys[0].set.root = [0.48, 0.85, -0.052].map((v, i) => v + Number(move[1].split(",")[i])); });
r = compile(fixedLow);
expect("applying the hint clears the seat collision", !r.qa.groups.some(g => g.kind === "COLLIDE" && /hips x Car_Seat_Driver/.test(g.subject)), JSON.stringify(r.qa.groups.map(g => g.subject)));

// 2. Hints: the cigarette appears 14 frames early, away from the pocket; the hint names the frame.
const early = broken(s => { const k = s.keys.find(kk => kk.step?.includes("cig_vis")), was = k.f; k.f -= 14; s.keys.find(kk => kk.set.cig_vis === 0 && kk.f === was - 1).f = k.f - 1; });
r = compile(early);
show("cigarette appears early", r);
const appear = r.qa.groups.find(g => g.kind === "APPEAR"), to = /move the step from f(\d+) to f(\d+)/.exec(appear?.hint ?? "");
expect("the APPEAR hint moves the step to a frame where the hand is at the pocket", Boolean(to), appear?.hint);
const moved = broken(s => { const k = s.keys.find(kk => kk.step?.includes("cig_vis")), was = k.f; k.f = Number(to[2]); s.keys.find(kk => kk.set.cig_vis === 0 && kk.f === was - 1).f = k.f - 1; });
expect("applying it clears the APPEAR issue", !compile(moved).qa.groups.some(g => g.kind === "APPEAR"));

// 3. Hints: elbow pole flipped up while smoking -> the chicken-wing check proposes a pole; a pole
//    interpolated through zero is named as such.
const wing = broken(s => { for (const k of s.keys) if (JSON.stringify(k.set.elbow_r) === "[0.4,-1,0.6]") k.set.elbow_r = [0.4, 1, 0.6]; });
r = compile(wing);
show("elbow pole up", r);
const below = r.qa.groups.find(g => g.kind === "BELOW"), flip = r.qa.groups.find(g => g.kind === "FLIP");
expect("BELOW: the hint keys an elbow_r pole pointing down", /^elbow_r: key \[[^\]]*-1[^\]]*\] \(body frame/.test(below?.hint ?? ""), below?.hint);
expect("FLIP: the pole passing through zero is the named cause", /passes near zero/.test(flip?.hint ?? ""), flip?.hint);

// 4. Hints: walk-generated keys point at the walk (change heading/turnDistance), not a key.
r = compile(broken(s => { s.generators[0].heading = [125, 80]; }));
const walkHit = r.qa.groups.find(g => g.kind === "COLLIDE" && /Car_Door_L/.test(g.subject));
expect("a walk into the open door names the walk step and suggests changing the walk", /generators\[0\] walk step \d/.test(walkHit?.cause ?? "") && /^walk path: /.test(walkHit?.hint ?? ""), `${walkHit?.cause} | ${walkHit?.hint}`);

// 5. Auto-fixes.
const stand = (extra = {}) => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 60, use: [{ skill: "standIdle", f0: 0, args: { at: [0, 0] } }], ...extra });
// reach: the hips keyed 4 cm up with the feet planted -> the legs miss; the fix lowers the hips, eased
const P = sk.restWorldPos, ank = P[I.LeftFoot][1], hipY = P[I.Hips][1] - 0.01;
const deep = fix => stand({ fix, keys: [{ f: 20, set: { root: [0, hipY, 0] } }, { f: 30, set: { root: [0, hipY + 0.04, 0] } }, { f: 40, set: { root: [0, hipY, 0] } }] });
const reachOff = compile(deep({ reach: false }), empty), reachOn = compile(deep(undefined), empty);
show("hips 4 cm too high, fix off", reachOff);
show("hips 4 cm too high, fix on", reachOn);
expect("reach fix off: QA reports REACH", reachOff.qa.groups.some(g => g.kind === "REACH"));
expect("reach fix on (default): hips lowered, reported, QA has no REACH", reachOn.fixed.reachLegs?.frames > 0 && !reachOn.qa.groups.some(g => g.kind === "REACH"), JSON.stringify(reachOn.fixed));
// slide: a planted foot creeping 6 mm -> locked
const creep = fix => stand({ fix, frames: 40, keys: [{ f: 5, set: { foot_l: [0.09, ank, -0.03] } }, { f: 35, set: { foot_l: [0.096, ank, -0.03] } }] });
const slideOff = compile(creep({ slide: false }), empty), slideOn = compile(creep(undefined), empty);
const drift = rr => Math.abs(rr.out.frames[35].s.P[I.LeftToeBase][0] - rr.out.frames[5].s.P[I.LeftToeBase][0]);
console.log(`  creeping foot: ball drifts ${(drift(slideOff) * 1000).toFixed(1)} mm without the lock, ${(drift(slideOn) * 1000).toFixed(2)} mm with it; fixed ${JSON.stringify(slideOn.fixed)}`);
expect("slide fix (default): the planted ball stays within 0.5 mm and the lock is reported", drift(slideOff) > 0.005 && drift(slideOn) < 5e-4 && slideOn.fixed.slide?.plants >= 1, JSON.stringify(slideOn.fixed));
// penetration: a held IK hand 1.5 cm into a board
const held = fix => stand({ fix, keys: [{ f: 0, set: { armw_r: 1, hand_r: [-0.22, 1.1, 0.32], elbow_r: [-0.5, -1, -0.3] } }, { f: 30, set: { hand_r: [-0.22, 1.1, 0.36] } }, { f: 59, set: { hand_r: [-0.22, 1.1, 0.32] } }] });
const free = compile(held(undefined), empty).out.frames[30].s.P, front = Math.max(free[I.RightHand][2], free[I.RightHandMiddle3][2]) + 0.022;
const board = { objects: { Board: { pos: [-0.2, 0, front - 0.015 + 0.05], R: I3(), half: [0.3, 0.8, 0.05] } } };
const penOff = compile(held(undefined), board), penOn = compile(held({ penetration: 0.02 }), board);
show("hand 1.5 cm into a board, fix off", penOff);
show("hand 1.5 cm into a board, penetration 0.02", penOn);
expect("penetration fix: the board hit is gone, pushes reported", penOff.qa.groups.some(g => g.kind === "COLLIDE") && penOn.qa.ok && penOn.fixed.penetration?.frames > 0, JSON.stringify(penOn.fixed));
// retime: a hand thrown 0.5 m in 4 frames
const throwHand = fix => ({ ...stand({ fix, frames: 120 }), keys: [{ f: 30, set: { armw_r: 0 } }, { f: 36, set: { armw_r: 1, hand_r: [-0.25, 1.1, 0.25] } }, { f: 50, set: { hand_r: [-0.25, 1.1, 0.25] } }, { f: 54, set: { hand_r: [0.1, 1.45, 0.3] } }, { f: 90, set: { hand_r: [0.1, 1.45, 0.3] } }] });
const fastOff = compile(throwHand(undefined), empty), fastOn = compile(throwHand({ retime: true }), empty);
show("hand thrown, no retime", fastOff);
show("hand thrown, retime", fastOn);
expect("retime: speed/pop issues gone, stretch reported", fastOff.qa.groups.some(g => g.kind === "POP" || g.kind === "SPEED") && fastOn.qa.ok && fastOn.fixed.retime?.maxStretch > 1, JSON.stringify(fastOn.fixed));
// the exitcar fixture itself stays clean with the default fixes on
r = compile(EXITCAR_SPEC);
expect("exitcar: QA 0 with the default fixes, and the fixes report their counts", r.qa.ok && typeof r.fixed === "object", JSON.stringify(r.qa.groups.slice(0, 2)));
console.log(`  exitcar default fixes: ${JSON.stringify(r.fixed)}; ${JSON.stringify(r.ms)}`);

// 6. Strict validation, exact messages.
const reject = (edit, scene = car) => { try { compile(broken(edit), scene); return ""; } catch (error) { return error.message; } };
const msg = reject(s => {
	s.fps = 30; s.keys[3].set.fpitch_left = 10; s.keys[4].set.root = [1, 2]; s.keys[5].f = 800; s.keys[6].set.knee_l = [0, 0, -1]; s.keys[7].set.w_handel_l = 1;
	s.anchors.grip_l = { kind: "world", p: [0, 1, 0] }; s.generators[0].heading = [125]; s.keys[8].set.fpitch_r = 95;
});
console.log(msg.split("\n").map(l => `  | ${l}`).join("\n"));
for (const line of [
	"spec.fps must be 24, the timeline rate, got 30",
	"keys[3] (f32) sets unknown channel \"fpitch_left\"; did you mean \"fpitch_l\"?",
	"keys[4] (f38) root must be [x, y, z] (3 finite numbers), got [1,2]",
	"keys[5].f = 800 is outside 0..729 (spec.frames 730); set frames >= 801 or frames: \"auto\"",
	"keys[6] (f54) knee_l = [0,0,-1] points backward; knees bend toward +z.",
	"keys[7] (f66) sets w_handel_l, but there is no anchor \"handel\"; did you mean \"w_handle_l\"?",
	"anchors.grip_l: an anchor name may not end in _l or _r",
	"generators[0].heading must be [h0, h1] in degrees (yaw 0 faces +Z and + turns toward +X), got [125]",
	"fpitch_r = 95 is outside -60..90 (toe-down pitch in degrees: + lifts the heel (the toes stay flat), - lifts the toes)",
]) expect(`validator: ${line.slice(0, 60)}`, msg.includes(line), msg);
expect("validator: a foot target at the floor names the ankle convention", reject(s => { s.keys[0].set.foot_l = [0.65, 0, 0.4]; }).includes("foot_l y = 0 puts the ankle into the floor; foot_* is the ANKLE target"));
expect("validator: checks.zzz is named, not a crash, with skills present", /checks\.zzz is not a check \(checks: /.test(reject(s => { s.use = [{ skill: "sitInSeat", f0: 0, args: { car: "Car" } }]; s.checks.zzz = 1; })));
expect("validator: a frame word in a check entry points at when", reject(s => { s.checks.contacts[0].frames = [0, 9]; }).includes('checks.contacts[0] has unknown field "frames"; did you mean "when"? (fields: name, point, target, tol, when)'));
expect("validator: an unknown skill arg lists the skill's args", reject(s => { s.use = [{ skill: "sitInSeat", f0: 0, args: { car: "Car", zzz: 1 } }]; }).includes("use[0].args.zzz is not an arg of sitInSeat (args: car, seat, seatBack, wheel, offset, floor)"));
expect("validator: an unknown skill gets a suggestion", /use\[0\]\.skill "exitcar" is not a skill; did you mean "exitCar"\?/.test(reject(s => { s.use = [{ skill: "exitcar", f0: 0 }]; })));

// 7. Frames past the end (G3). The run2 session: a pick-up compiled from frames: "auto" (195
//    frames), installed, then base + patch appended drink keys up to f296 and a goal at
//    [218, 250]. The store keeps the "auto" intent, so the patch re-resolves the length; the take
//    keeps the number. A numeric base answers the length that fits and frames: "auto".
const RUN2_SPEC = {"schema": "cozyclay.motion-spec.v1", "fps": 24, "frames": "auto", "label": "step to table and pick up cup", "use": [{"skill": "standIdle", "f0": 0, "args": {"at": [0, 0], "heading": 0}}, {"skill": "walkTo", "f0": 10, "args": {"to": [0, 0.4], "steps": 2, "firstStep": 0.3, "step": 0.3, "heading": [0, 0]}}], "anchors": {"handle": {"kind": "world", "p": [0.268, 0.8, 0.85]}, "lift": {"kind": "world", "p": [0.24, 1.1, 0.66]}}, "props": {"handleGrip": {"hand": "l", "origin": ["LeftHandIndex2", "LeftHandMiddle2"], "points": {"fingers": [0, 0, 0]}}}, "fits": [{"side": "l", "anchor": "handle", "effector": {"prop": "handleGrip", "point": "fingers"}}, {"side": "l", "anchor": "lift", "effector": {"prop": "handleGrip", "point": "fingers"}}], "objects": {"empty-2": {"prop": "handleGrip", "grab": 122}}, "fix": {"penetration": 0.02}, "keys": [{"f": 86, "set": {"armw_l": 0, "w_handle_l": 0, "w_lift_l": 0, "pitch": 0, "spine_pitch": 0, "head_pitch": 0, "fingers_l": {"grip": 0}, "elbow_l": [1, -1, -0.3], "aswing_r": 0}}, {"f": 116, "set": {"armw_l": 1, "w_handle_l": 1, "pitch": 20, "spine_pitch": 35, "head_pitch": 15, "fingers_l": {"grip": 0.3}, "aswing_r": 35}}, {"f": 122, "set": {"w_handle_l": 1, "w_lift_l": 0, "pitch": 20, "spine_pitch": 35, "fingers_l": {"grip": 1}}}, {"f": 170, "set": {"w_handle_l": 0, "w_lift_l": 1, "pitch": 0, "spine_pitch": 4, "head_pitch": 12, "aswing_r": 0}}, {"f": 194, "set": {"w_lift_l": 1}}], "goals": [{"name": "fingers on the cup handle", "near": ["prop:handleGrip.fingers", "anchor:handle"], "tol": 0.05, "at": [116, 122]}, {"name": "cup lifted off the table", "moved": "object:empty-2", "by": 0.2, "at": [170, 194]}, {"name": "cup held above table", "above": ["object:empty-2.base", "object:cube.top"], "by": 0.15, "at": [170, 194]}]};
const RUN2_PATCH = [{"op": "replace", "path": "/label", "value": "pick up cup and drink coffee"}, {"op": "add", "path": "/anchors/sip", "value": {"kind": "landmark", "name": "mouth"}}, {"op": "add", "path": "/fits/-", "value": {"side": "l", "anchor": "sip", "effector": {"prop": "handleGrip", "point": "fingers"}, "offset": [0.07, -0.06, 0.06]}}, {"op": "add", "path": "/keys/0/set/w_sip_l", "value": 0}, {"op": "replace", "path": "/keys/4", "value": {"f": 182, "set": {"w_lift_l": 1, "w_sip_l": 0, "head_pitch": 12}}}, {"op": "add", "path": "/keys/-", "value": {"f": 208, "set": {"w_lift_l": 0, "w_sip_l": 1, "head_pitch": 0, "spine_pitch": 0}}}, {"op": "add", "path": "/keys/-", "value": {"f": 218, "set": {"head_pitch": -15, "spine_pitch": -4}}}, {"op": "add", "path": "/keys/-", "value": {"f": 250, "set": {"w_sip_l": 1, "head_pitch": -15, "spine_pitch": -4}}}, {"op": "add", "path": "/keys/-", "value": {"f": 276, "set": {"w_sip_l": 0, "w_lift_l": 1, "head_pitch": 10, "spine_pitch": 4}}}, {"op": "add", "path": "/keys/-", "value": {"f": 296, "set": {"w_lift_l": 1}}}, {"op": "add", "path": "/goals/-", "value": {"name": "cup at the mouth", "near": ["object:empty-2.top", "landmark:mouth"], "tol": 0.08, "at": [218, 250]}}];
const takes = new Map(), owner = { replace: (id, take) => takes.set(id, take), motionFor: id => takes.get(id) ?? null };
const registry = createStudioAppActions({ state: () => ({ characters: [CUP_CHARACTER], objects: CUP_OBJECTS, frameCount: 300 }), storeDomain: n => (n === "motion" ? owner : null) });
const act = (id, args) => { const out = registry.run(id, args); return out?.output ?? out; };
const refused = run => { try { run(); return ""; } catch (error) { return error.message; } };
const pickUp = act("motion.compile", { characterId: CUP_CHARACTER.id, spec: RUN2_SPEC, install: false });
const installedPickUp = act("motion.compile", { characterId: CUP_CHARACTER.id, base: pickUp.specId, install: true });
expect("frames auto: the pick-up resolves to 195 frames, and the installed take keeps the number", pickUp.frames === 195 && installedPickUp.specId === pickUp.specId
	&& takes.get(CUP_CHARACTER.id)?.spec?.frames === 195, JSON.stringify({ frames: pickUp.frames, take: takes.get(CUP_CHARACTER.id)?.spec?.frames }));
let drink = null;
const appendRefusal = refused(() => { drink = act("motion.compile", { characterId: CUP_CHARACTER.id, base: installedPickUp.specId, patch: RUN2_PATCH, install: false }); });
expect("frames auto: base + patch appending keys to f296 re-resolves to 297 frames", appendRefusal === "" && drink?.frames === 297 && drink.specId !== pickUp.specId && drink.delta?.base === pickUp.specId,
	appendRefusal || JSON.stringify({ frames: drink?.frames }));
const numeric = act("motion.compile", { characterId: CUP_CHARACTER.id, spec: { ...RUN2_SPEC, frames: 196 }, install: false });
const pastEnd = refused(() => act("motion.compile", { characterId: CUP_CHARACTER.id, base: numeric.specId, patch: RUN2_PATCH, install: false }));
for (const line of [
	"keys[5].f = 208 is outside 0..195 (spec.frames 196); set frames >= 297 or frames: \"auto\"",
	"keys[9].f = 296 is outside 0..195 (spec.frames 196); set frames >= 297 or frames: \"auto\"",
	"goals[3].at = [218,250] is outside 0..195 (spec.frames 196); set frames >= 297 or frames: \"auto\"",
]) expect(`frames number: ${line.slice(0, 40)}`, pastEnd.split("\n").includes(line), pastEnd);
const autoAgain = refused(() => act("motion.compile", { characterId: CUP_CHARACTER.id, base: numeric.specId, patch: [{ op: "replace", path: "/frames", value: "auto" }, ...RUN2_PATCH], install: false }));
expect("frames number: following the advice (frames: \"auto\") compiles", autoAgain === "", autoAgain);
// a goal past the last key: "auto" counts keys, not goals, so the advice is the number alone
const lateGoal = reject(s => { s.goals = [{ name: "late", near: ["joint:LeftHand", "joint:RightHand"], at: [700, 760] }]; });
expect("frames: a goal past the end that \"auto\" would not cover gets the number alone",
	lateGoal.replace(/^MOTION_SPEC_INVALID: /, "").split("\n").includes("goals[0].at = [700,760] is outside 0..729 (spec.frames 730); set frames >= 761"), lateGoal);
const overview = refused(() => act("motion.describe", { topic: "overview" }));
expect("describe: an unknown topic names the allowed ones", overview === "$.args.topic: \"overview\" is not one of: essentials, spec, skills, anchors, props, objects, checks, goals, probes, channels, refs, fix.", overview);

if (failures) { console.error(`${failures} motion3 agent-loop check(s) failed`); process.exit(1); }
console.log("motion3 agent loop: all checks passed");
