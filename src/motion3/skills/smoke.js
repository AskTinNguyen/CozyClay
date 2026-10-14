// smokeCigarette, extracted from the car-exit fixture: the right hand takes a cigarette from the
// right pocket to the lips, the left hand brings a lighter from the left pocket under the tip,
// lights it, puts it back; exhale, look around, a second drag, hold until `until`. Everything is
// body-relative (pockets, holding point) or measured (mouth), so it works wherever the character
// stands, and from any pose keyed before f0 (a squat): the head turns from its own pitch, the
// right arm's poles lean with the torso (pitch + spine_pitch), and a squat rests the hand over
// the knee (smoke-kit.js). Channels exhale (1 while breathing out) and ember (the tip's level:
// 0.6 idle, 2 on a drag) drive kits; args.kit binds them (smoke-kit.js). Needs 265 frames after f0.
import { keyBook, skillError } from "./book.js";
import { kitObjects, squatAnchors } from "./smoke-kit.js";
import { apply, rx } from "../compiler/math.js";

// Wrist twist / flex per hand pose (degrees), found by sweeping them against the QA checks.
const WR = { TW_M: 40, FX_M: 0, TW_H: 0, FX_H: 10, TW_L: -80, FX_L: -50 };
const EL_MOUTH_R = [0.4, -1, 0.6], EL_HOLD_R = [-0.4, -1, -0.3], EL_LIGHT_L = [0.9, -0.6, 0.3];
const ALL = ["armw_r", "armw_l", "w_rpocket_r", "w_lpocket_l", "w_hold_r", "w_mouth_r", "w_flame_l", "elbow_r", "elbow_l",
	"wtwist_r", "wflex_r", "wtwist_l", "wflex_l", "head_pitch", "head_yaw", "spine_pitch", "root", "fingers_l", "fingers_r",
	"cig_vis", "lit_vis", "flame_vis", "ember_vis", "exhale", "ember"];
const DEFAULTS = { armw_r: 0, armw_l: 0, w_rpocket_r: 0, w_lpocket_l: 0, w_hold_r: 0, w_mouth_r: 0, w_flame_l: 0, elbow_r: [-0.5, -0.4, -1], elbow_l: [0.5, -0.4, -1],
	wtwist_r: 0, wflex_r: 0, wtwist_l: 0, wflex_l: 0, head_pitch: 0, head_yaw: 0, spine_pitch: 0, fingers_l: { grip: 0, fist: 0 }, fingers_r: { cigarette: 0 },
	cig_vis: 0, lit_vis: 0, flame_vis: 0, ember_vis: 0, exhale: 0, ember: 0 };

export function smokeCigarette(ctx) {
	// by default it holds to the last frame (or ends with its own motion while frames is "auto"); too
	// few frames are named by the expander
	const until = ctx.args.until ?? (ctx.auto ? ctx.f0 + 264 : Math.max(ctx.frames - 1, ctx.f0 + 264));
	if (until < ctx.f0 + 264) skillError(ctx.tag, `needs frames f${ctx.f0}..f${ctx.f0 + 264} at least (args.until ${until})`);
	if (!Array.isArray(ctx.state.root)) skillError(ctx.tag, "needs a pose keyed before f0 (root): standing or squatting");
	const fresh = Object.fromEntries(Object.entries(DEFAULTS).filter(([c]) => ctx.state[c] === undefined));
	if (Object.keys(fresh).length) Object.assign(ctx.state, structuredClone(fresh));
	ctx.state.head_yaw = 0;
	// the pose before f0 stays: the head pitches from its own angle, the right arm's poles lean with the torso
	const head0 = ctx.state.head_pitch, lean = (ctx.state.pitch ?? 0) + ctx.state.spine_pitch, H = v => v + head0;
	const EL_MOUTH = lean ? apply(rx(lean), EL_MOUTH_R) : EL_MOUTH_R, EL_HOLD = lean ? apply(rx(lean), EL_HOLD_R) : EL_HOLD_R;
	const squat = squatAnchors(ctx);
	if (squat) ctx.state.w_mouthOut_r = 0;
	const k = keyBook(ctx.state, ctx.f0), root0 = ctx.state.root.slice(), yaw = ctx.state.yaw ?? 0;
	/** The hand from the lips to the rest over f0+a..f0+b, and back; in a squat through mouthOut (smoke-kit.js). */
	const raise = (a, b) => {
		k.hold(a, "w_mouth_r", "w_hold_r", "wtwist_r", "wflex_r", "elbow_r", "head_pitch", "root", ...(squat ? ["w_mouthOut_r"] : []));
		if (squat) k.at(Math.round((a + b) / 2), { w_hold_r: 0, w_mouthOut_r: 1, w_mouth_r: 0 });
		k.at(b, { w_mouth_r: 1, w_hold_r: 0, ...(squat ? { w_mouthOut_r: 0 } : {}), wtwist_r: WR.TW_M, wflex_r: WR.FX_M, elbow_r: EL_MOUTH, head_pitch: H(6), root: root0 });
	};
	const lower = (a, b) => {
		k.hold(a, "w_mouth_r", "w_hold_r", "wtwist_r", "wflex_r", "elbow_r", "head_pitch", ...(squat ? ["w_mouthOut_r"] : []));
		if (squat) k.at(Math.round((a + b) / 2), { w_mouth_r: 0, w_mouthOut_r: 1, w_hold_r: 0 });
		k.at(b, { w_mouth_r: 0, w_hold_r: 1, ...(squat ? { w_mouthOut_r: 0 } : {}), wtwist_r: WR.TW_H, wflex_r: WR.FX_H, elbow_r: EL_HOLD, head_pitch: H(0) });
	};
	k.hold(0, ...ALL);
	// right hand: pocket -> the cigarette appears -> mouth
	k.at(2, { w_rpocket_r: 1, elbow_r: [-0.5, -0.4, -1] });
	k.hold(6, "armw_r", "w_rpocket_r", "elbow_r", "fingers_r");
	k.at(20, { armw_r: 1 });
	k.at(28, { fingers_r: { cigarette: 1 } });
	k.step(28, "cig_vis", 1);
	k.hold(36, "w_rpocket_r", "w_mouth_r", "wtwist_r", "wflex_r", "elbow_r", "head_pitch");
	k.at(58, { w_rpocket_r: 0, w_mouth_r: 1, wtwist_r: WR.TW_M, wflex_r: WR.FX_M, elbow_r: EL_MOUTH, head_pitch: H(6) });
	// left hand: pocket -> the lighter appears -> under the cigarette tip
	k.at(2, { w_lpocket_l: 1, elbow_l: [0.5, -0.4, -1] });
	k.hold(12, "armw_l", "w_lpocket_l", "elbow_l", "fingers_l");
	k.at(26, { armw_l: 1 });
	k.at(34, { fingers_l: { grip: 0, fist: 1 } });
	k.step(35, "lit_vis", 1);
	k.hold(44, "w_lpocket_l", "w_flame_l", "wtwist_l", "wflex_l", "elbow_l");
	k.at(60, { w_lpocket_l: 0, w_flame_l: 1, wtwist_l: WR.TW_L, wflex_l: WR.FX_L, elbow_l: EL_LIGHT_L });
	// light it: flame on, the ember appears, inhale
	k.step(63, "flame_vis", 1);
	k.step(73, "ember_vis", 1);
	k.step(79, "flame_vis", 0);
	// the ember catches, glows up while she draws (f80-f90, f200-f212) and settles to 0.6; she breathes out twice
	k.step(73, "ember", 1);
	k.at(80, { ember: 2 });
	k.hold(90, "ember");
	k.at(104, { ember: 0.6 });
	k.hold(194, "ember");
	k.at(200, { ember: 2 });
	k.hold(212, "ember");
	k.at(224, { ember: 0.6 });
	k.step(116, "exhale", 1);
	k.step(138, "exhale", 0);
	k.step(238, "exhale", 1);
	k.step(260, "exhale", 0);
	// the left hand puts the lighter back and drops
	k.hold(80, "w_flame_l", "w_lpocket_l", "wtwist_l", "wflex_l", "elbow_l");
	// a squat brings the lighter back to the pocket a little slower (its path crosses the hand's detour circle on the way down)
	k.at(squat ? 100 : 96, { w_flame_l: 0, w_lpocket_l: 1, wtwist_l: 0, wflex_l: 0, elbow_l: [0.5, -0.4, -1] });
	k.hold(101, "fingers_l");
	k.step(102, "lit_vis", 0);
	k.hold(104, "armw_l", "w_lpocket_l");
	k.at(112, { fingers_l: { grip: 0, fist: 0 } });
	k.at(120, { armw_l: 0, w_lpocket_l: 1 });
	k.at(123, { w_lpocket_l: 0 });
	// the right hand lowers to the holding position; exhale with the head up
	lower(92, 114);
	k.at(124, { head_pitch: H(-14) });
	k.at(140, { head_pitch: H(0) });
	// idle: weight onto the left leg, look around
	const lv = [Math.cos(yaw * Math.PI / 180), 0, -Math.sin(yaw * Math.PI / 180)];
	k.hold(120, "root", "head_yaw");
	k.at(146, { root: root0.map((v, i) => v + 0.03 * lv[i] - (i === 1 ? 0.005 : 0)), head_yaw: -22 });
	k.at(168, { head_yaw: 0 });
	// second drag
	raise(170, 194);
	lower(212, 236);
	k.at(246, { head_pitch: H(-14) });
	k.at(264, { head_pitch: H(0) });
	k.hold(until - ctx.f0, ...ALL, ...(squat ? ["w_mouthOut_r"] : []));
	const kit = kitObjects(ctx, { cig: ctx.f0 + 28, lit: ctx.f0 + 35, unlit: ctx.f0 + 102 });
	return {
		keys: k.keys, end: until, channels: ["exhale", "ember"], ...(kit ? { objects: kit.objects } : {}),
		anchors: {
			lpocket: { kind: "body", p: [0.13, -0.035, 0.08] }, rpocket: { kind: "body", p: [-0.13, -0.035, 0.08] }, hold: { kind: "body", p: squat?.hold ?? [-0.24, 0.03, 0.06] },
			...(squat ? { mouthOut: { kind: "body", p: squat.mouthOut } } : {}),
			mouth: { kind: "landmark", name: "mouth" }, flame: { kind: "prop", prop: "cig", point: "tip", offset: [0, -0.02, 0] },
		},
		props: {
			cig: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: { filter: [0, 0, -0.026], tip: [0, 0, 0.058] } },
			lighter: { hand: "l", origin: ["LeftHand", "LeftHandMiddle1"], points: { body: [0.01, 0, 0], flame: [0.01, 0.036, 0] } },
		},
		fits: [{ side: "r", anchor: "mouth", effector: { prop: "cig", point: "filter" } }, { side: "l", anchor: "flame", effector: { prop: "lighter", point: "flame" } }],
		checks: {
			contacts: [
				{ name: "filter on the lips", point: "prop:cig.filter", target: "anchor:mouth", tol: 0.01, when: "w_mouth_r" },
				{ name: "flame under the cigarette tip", point: "prop:lighter.flame", target: "anchor:flame", tol: 0.01, when: "flame_vis" },
			],
			orient: [
				{ name: "lit end points away from the face", from: "prop:cig.filter", to: "prop:cig.tip", along: "face", minCos: 0.64, when: "w_mouth_r" },
				{ name: "lighter upright", from: "prop:lighter.body", to: "prop:lighter.flame", along: "up", minCos: 0.85, when: "flame_vis" },
			],
			below: [{ name: "no chicken-wing elbow", joint: "RightForeArm", ref: "RightArm", min: 0.08, when: "w_mouth_r" }],
			appear: [
				{ name: "cigarette from the right pocket", channel: "cig_vis", joint: "RightHand", anchor: "rpocket", tol: 0.035 },
				{ name: "lighter from the left pocket", channel: "lit_vis", joint: "LeftHand", anchor: "lpocket", tol: 0.035 },
			],
			mouthPoints: ["cig.filter"], ...(kit ? { allow: kit.allow } : {}),
		},
	};
}
