// motion.describe examples and notes, one per topic (describe.js builds the schemas from
// fields.js and types.js). Each example is a part of a spec that passes validation when merged
// into a spec with standIdle at f0 0 and frames 60 (probes: a motion.compile probes list);
// test/motion3/verify-motion3-describe.mjs checks that. Object ids are examples: use the scene's.
import { CONVENTIONS } from "../compiler/vocab.js";
import { FIX_KEYS } from "../fix/index.js";
import { literal } from "./brief.js";
import { WRIST_LIMITS } from "../compiler/arm-orient.js";
import { KEY_BLEND } from "../object-keys.js";

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
	objects: { props: { cupGrip: GRIP },
		objects: { cup: { prop: "cupGrip", grab: 20, release: 50 }, door: { pivot: [0.9, 0, 0.5], axis: [0, 1, 0], channel: "door" },
			bat: { prop: "cupGrip", grab: 52, keys: [{ f: 54, pos: [0.3, 1.2, 0.2], rot: [0, 0, 0.38268, 0.92388] }, { f: 58, pos: [0.3, 1.1, 0.4], aim: [0, -0.2, 1] }] },
			ember: { visible: "ember_vis", level: "ember" }, puff: { follow: "landmark:mouth", aim: "face", visible: "ember_vis" } },
		keys: [{ f: 0, set: { door: 0, ember_vis: 0, ember: 0.6 } }, { f: 30, set: { ember_vis: 1, ember: 2 }, step: ["ember_vis"] }, { f: 40, set: { door: -60 } }] },
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
	fix: { fix: { reach: true, slide: true, penetration: 0.02, self: true, retime: false } },
};

const UNITS = `World metres, +Y up; ${CONVENTIONS.yaw}; the character's left is +X at yaw 0. Angles in degrees.`;
const NO_JUMP = "Without at/along the object keeps its grab-frame offset to the palm, so it does not jump.";
/** The objects example's carry: a grip prop and the object it holds. */
const CARRY = { props: EXAMPLES.objects.props, objects: { cup: EXAMPLES.objects.objects.cup } };

export const NOTES = {
	essentials: ["types: ? optional, =v default, lo..hi range, A | B one of, [key]: T a map, a|b?: T both fields, x_l|r left and right, (text) the meaning.",
		`A carried object: ${literal(CARRY)}. ${NO_JUMP}`,
		"motion.describe { topic } or { topic: 'skills', name }: the rest, with examples."],
	spec: [UNITS,
		"frames: an integer, or \"auto\" (the last skill end, generator end or key f, plus 1); the stored spec keeps the number.",
		"Any number may be { range: [lo, hi] } (int: true for frames): the compiler searches it, QA 0 first, at most search.budget compiles.",
		"use expands skills (topic skills) into keys, anchors, props, fits and checks first; your own keys win on the same frame and your anchors/props replace a skill's.",
		"Keys ease between values (step jumps); a channel holds its last value. Unknown fields are refused with the field list.",
		"More: topics anchors, props, objects, checks, goals, probes, channels, refs, fix, skills."],
	anchors: ["An anchor is a named point a hand can go to: key w_<anchor>_l / w_<anchor>_r from 0 to 1 with armw_<side> 1 (the IK arm).",
		"An anchor name may not end in _l or _r.", "object anchors (a body or a group; local in its own axes) follow the object where it is (hinges, carries): put the other hand on a carried object with one; the carrying hand's own anchor stays where it took it. prop anchors are a point of a prop the other hand holds.",
		"segment with reach slides from t toward tMin until the arm reaches it."],
	props: ["A prop is a set of points fixed to one hand, [d, l, n] along the palm axes; prop:<prop>.origin is the mean of its origin bones.",
		"fits: the hand target moves so the effector (a prop point or the mean of joints), not the wrist, lands on the anchor.",
		"reachGrip adds props.<anchor>Grip and its fit. Carry a scene object with objects.<id>.prop (topic objects)."],
	objects: ["A hinge turns the object (a body or a group) about pivot/axis by the angle channel your keys set (degrees).",
		"A carry follows the prop's hand: before grab the scene pose, grab..release in the hand, after release frozen where it was let go.",
		`No grab: in hand from frame 0; no release: to the end. ${NO_JUMP}`,
		"A group (Empty) id moves all its parts; at/along pin a group's root to the palm too (an object.createKit kit). A carried object is an obstacle for the body and the scene.",
		"A switch { visible?, level? } (no prop, no hinge field) moves nothing: it shows or hides any record (a part, a light, an effect) and sets its level, 0..4 light, glow and effect strength "
			+ "(an unkeyed level reads 1). Hiding a group hides its parts. A carry takes level too.",
		"keys pose a carried object in the world while it is in hand (grab <= f <= release): pos is its base (a group: its root), rot a quaternion [x, y, z, w], "
			+ "or aim [x, y, z] the direction its +Y points (a bat's barrel), turned from how the hand holds it there, plus roll degrees about aim; no roll: the roll the arm holds most easily. "
			+ `The object leads and the whole arm follows (the elbow swings, the forearm turns, the wrist adds the rest within ${Object.entries(WRIST_LIMITS).map(([k, [lo, hi]]) => `${k} ${lo}..${hi}`).join(", ")} deg; dev + toward the thumb); `
			+ "a left hand on a prop anchor of it turns with it; "
			+ `the hand eases in and out over ${KEY_BLEND} frames. A REACH group "<id>: n cm off its keys" is what the hand could not reach; `
			+ "output.observations.held measures every key as drawn (deg off the asked +Y, cm off pos, the drawn +Y, the rot an aim key used).",
		"A follow { follow: <ref>, offset?, aim?, visible?, level? } puts any record (an effect, a light, a part) on a body point every frame: "
			+ "aim sets its +Y (an effect emits along it): up (default), face (forward), a direction or a ref (toward it); offset is metres along its axes after aim. It is no obstacle.",
		"The editor's motion.keyObject writes one key from a drag (a hinge: its channel key)."],
	checks: ["Each entry adds QA groups: contacts CONTACT, orient ORIENT, below BELOW, clearance CLEARANCE, appear APPEAR; supports mark where a part rests on an object (no FLOAT, no balance there); a foot on an object's top is on the ground without one.",
		"when: a weight channel (active above 0.99) or [f0, f1]; clearance uses frames.", "Check points take joint:, prop: and anchor: only; goals and probes take every ref (topic refs).",
		"allow excuses a body part inside an object up to depth; limits override the QA limits. Unnamed entries are named by place, contacts[0].",
		"Speed, acceleration, knee bend and balance are style: measured in output.observations, not judged. Naming speedCore/speedLimb, accCore/accLimb, knee or balance in limits makes it a check (SPEED, ACC, KNEE, BALANCE). observations.near: each hand's and foot's nearest object and gap (< 0 inside), measured, not judged.",
		"motion.qa { checks } replaces every check for a re-measure."],
	goals: ["Exactly one of near (distance <= tol), above (a.y - b.y >= by) or moved (an object's base moved at least by from the scene pose; any other point ref, e.g. prop:bat.tip, at least by from where it is at at[0], at: [f0, f1]).",
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
		"reach, slide and self are on by default; penetration and retime are opt-in.",
		"self keeps the arms out of the body on its fitted skin (QA BODY measures the same skin): wrist targets inside it go onto it, elbows turn about the shoulder-wrist line, a hand a little inside is pushed out. A fit's target (the mouth) is never moved; what is left is BODY, with checks.allow { part, object: <body part>, depth } for a contact meant to touch (a hand on a knee)."],
};
