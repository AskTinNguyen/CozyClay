// motion.describe examples and notes, one per topic (describe.js builds the schemas from
// fields.js and types.js). Each example is a part of a spec that passes validation when merged
// into a spec with standIdle at f0 0 and frames 60 (probes: a motion.compile probes list);
// test/motion3/verify-motion3-describe.mjs checks that. Object ids are examples: use the scene's.
import { CONVENTIONS } from "../compiler/vocab.js";
import { FIX_KEYS } from "../fix/index.js";
import { literal } from "./brief.js";

const SPOT = { kind: "world", p: [-0.2, 1.1, 0.35] };
const GRIP = { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: { fingers: [0, 0, 0] } };

export const EXAMPLES = {
	spec: { schema: "cozyclay.motion-spec.v1", fps: 24, frames: "auto", label: "walk up and grip the bar",
		use: [{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } }, { skill: "walkTo", f0: 10, args: { to: [0, 1.2] } },
			{ skill: "reachGrip", f0: 140, args: { anchor: "bar", side: "r", define: { kind: "world", p: [-0.2, 1.2, 1.6] } } }],
		keys: [{ f: 150, set: { head_pitch: 10 } }] },
	anchors: { anchors: { spot: SPOT, pocket: { kind: "body", p: [0.13, -0.035, 0.08] }, knee: { kind: "segment", from: "LeftUpLeg", to: "LeftLeg", t: 0.45, reach: "l" },
		handle: { kind: "object", object: "cup", local: [0.07, 0, 0] }, mouth: { kind: "landmark", name: "mouth" } },
	keys: [{ f: 10, set: { armw_r: 1, w_spot_r: 0 } }, { f: 30, set: { w_spot_r: 1 } }] },
	props: { props: { cupGrip: GRIP }, anchors: { spot: SPOT }, fits: [{ side: "r", anchor: "spot", effector: { prop: "cupGrip", point: "fingers" } }] },
	objects: { props: { cupGrip: GRIP }, objects: { cup: { prop: "cupGrip", grab: 20, release: 50 }, door: { pivot: [0.9, 0, 0.5], axis: [0, 1, 0], channel: "door" } },
		keys: [{ f: 0, set: { door: 0 } }, { f: 40, set: { door: -60 } }] },
	checks: { anchors: { spot: SPOT }, checks: {
		contacts: [{ name: "right hand on the spot", point: "joint:RightHand", target: "anchor:spot", tol: 0.05, when: [30, 40] }],
		clearance: [{ name: "hand off the cup", part: "hand_r", object: "cup", min: 0.01, frames: [0, 20] }],
		allow: [{ part: "hand", object: "cup", depth: 0.03 }], limits: { object: 0.01 } } },
	goals: { anchors: { spot: SPOT }, goals: [
		{ name: "hand at the spot", near: ["joint:RightHand", "anchor:spot"], tol: 0.06, at: [30, 40] },
		{ name: "hand over the table", above: ["joint:RightHand", "object:table.top"], by: 0.05, at: 35, mode: "any" },
		{ name: "cup lifted", moved: "object:cup", by: 0.1, at: [50, 59] }] },
	probes: [{ name: "handToCup", distance: ["joint:RightHand", "object:cup"], frames: [0, 59] }, { name: "cupTop", position: "object:cup.top", frames: [0, 59], every: 10 }],
	channels: { anchors: { spot: SPOT }, channels: ["lid"], keys: [
		{ f: 0, set: { armw_r: 1, hand_r: [-0.25, 1.0, 0.2], elbow_r: [-0.5, -1, -0.3], fingers_r: { grip: 0 }, lid: 0 } },
		{ f: 20, set: { w_spot_r: 1, fingers_r: { grip: 1 }, head_yaw: -15, spine_pitch: 8 } },
		{ f: 30, set: { lid: 1 }, step: ["lid"] }] },
	refs: { props: { cupGrip: GRIP }, anchors: { spot: SPOT }, goals: [
		{ name: "fingers at the spot", near: ["prop:cupGrip.fingers", "anchor:spot"], at: 30 },
		{ name: "cup at the mouth", near: ["object:cup.top", "landmark:mouth"], tol: 0.06, at: [40, 50] },
		{ name: "hand above the hips", above: ["joint:RightHand", "bone:Hips"], at: 30 }] },
	fix: { fix: { reach: true, slide: true, penetration: 0.02, retime: false } },
};

const UNITS = `World metres, +Y up; ${CONVENTIONS.yaw}; the character's left is +X at yaw 0. Angles in degrees.`;
const NO_JUMP = "Without at/along the object keeps its grab-frame offset to the palm, so it does not jump.";
const RE_MEASURE = "base alone or patch: [] re-measures (new probes); install: 'never' = false; spec.probes are measured, not stored.";
/** The objects example's carry: a grip prop and the object it holds. */
const CARRY = { props: EXAMPLES.objects.props, objects: { cup: EXAMPLES.objects.objects.cup } };

export const NOTES = {
	essentials: ["types: ? optional, =v default, lo..hi range, A | B one of, [key]: T a map, a|b?: T both fields, x_l|r left and right, (text) the meaning.",
		`A carried object: ${literal(CARRY)}. ${NO_JUMP}`, `motion.compile: ${RE_MEASURE}`,
		"motion.describe { topic } or { topic: 'skills', name } has the rest: meanings, a valid example, notes."],
	spec: [UNITS,
		"frames: an integer, or \"auto\" (the last skill end, generator end or key f, plus 1); the stored spec keeps the number.",
		"Any number may be { range: [lo, hi] } (int: true for frames): the compiler searches it, QA 0 first, at most search.budget compiles.",
		"use expands skills (topic skills) into keys, anchors, props, fits and checks first; your own keys win on the same frame and your anchors/props replace a skill's.",
		"Keys ease between values (step jumps); a channel holds its last value. Unknown fields are refused with the field list.",
		"More: topics anchors, props, objects, checks, goals, probes, channels, refs, fix, skills."],
	anchors: ["An anchor is a named point a hand can go to: key w_<anchor>_l / w_<anchor>_r from 0 to 1 with armw_<side> 1 (the IK arm).",
		"An anchor name may not end in _l or _r.", "object anchors follow the object (hinges, carries); prop anchors are a point of a prop the other hand holds.",
		"segment with reach slides from t toward tMin until the arm reaches it."],
	props: ["A prop is a set of points fixed to one hand, [d, l, n] along the palm axes; prop:<prop>.origin is the mean of its origin bones.",
		"fits: the hand target moves so the effector (a prop point or the mean of joints), not the wrist, lands on the anchor.",
		"reachGrip adds props.<anchor>Grip and its fit. Carry a scene object with objects.<id>.prop (topic objects)."],
	objects: ["A hinge turns the object (a body or a group) about pivot/axis by the angle channel your keys set (degrees).",
		"A carry follows the prop's hand: before grab the scene pose, grab..release in the hand, after release frozen where it was let go.",
		`No grab: in hand from frame 0; no release: to the end. ${NO_JUMP}`,
		"A group (Empty) id moves all its parts; at/along are for bodies only. A carried object is an obstacle for the body and the scene."],
	checks: ["Each entry adds QA groups: contacts CONTACT, orient ORIENT, below BELOW, clearance CLEARANCE, appear APPEAR; supports skip BALANCE where a part rests on an object.",
		"when: a weight channel (active above 0.99) or [f0, f1]; clearance uses frames.", "Check points take joint:, prop: and anchor: only; goals and probes take every ref (topic refs).",
		"allow excuses a body part inside an object up to depth; limits override the QA limits. Unnamed entries are named by place, contacts[0].",
		"motion.qa { checks } replaces every check for a re-measure."],
	goals: ["Exactly one of near (distance <= tol), above (a.y - b.y >= by) or moved (the object base moved at least by).",
		"at is an absolute frame or [f0, f1]; mode all (every frame) or any (one frame). A failed goal is a GOAL group first in qa.groups and makes qa.ok false."],
	probes: ["motion.compile { probes } (at most 16); spec.probes are measured too, not stored; answered whether or not it installs.",
		"distance [a, b] -> { min, minAt, max, maxAt, mean, first, last } in m; a bare object:<id> measures to its surface. position -> { at: [{ f, p }] }, at most 16 rows."],
	channels: ["key.set names channels; values ease between keys and hold after the last key. step: [channel] jumps at f instead.",
		"w_<anchor>_<side> (0..1) weights a hand onto an anchor; the weights of one hand add up to at most 1.",
		"Any other numeric channel must come from spec.channels, a hinge (objects.<id>.channel), a check's when or a visible switch; names ending _vis are visibility switches (shown above 0.5)."],
	refs: ["A ref names a point: joint:/bone:<Bone>, prop:<prop>.<point>, anchor:<name>, landmark:mouth, object:<id>[.center|.top|.base].",
		"object:<id> takes a body or a group (the box around its parts); in a distance a bare object:<id> means its surface.",
		"Goals and probes take every kind; spec.checks keep joint:, prop: and anchor:."],
	fix: [`spec.fix keys: ${FIX_KEYS.join(", ")}; false turns all off. output.fixed reports what each one changed.`,
		"reach and slide are on by default; penetration and retime are opt-in."],
};
