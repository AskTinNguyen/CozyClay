// What each skill takes and does, for motion.describe { topic: "skills" } and the expander (an
// arg not listed here is refused; a lenient reload ignores it): args (JSON Schema fragments),
// required args, what must come before it (needs), how many frames it runs from f0 and what it
// adds to the spec. A test keeps the names equal to SKILL_NAMES (skills/index.js). `tune` names
// the numeric args repair may nudge (arg -> one step) when a near-limit QA group names the skill
// as its cause (repair-tune.js); the start value is the arg as sent, else its schema default.
// `place` names the args that set where the body stands (arg -> one step, m): repair-tune.js
// steps them when a GOAL group misses and this skill placed the body last.
import { WALK_FIELDS } from "../schema/fields.js";
import { WALK_TYPES, num, int, str, side, ref } from "../schema/types.js";
import { FINGER_PRESETS } from "../compiler/vocab.js";

/** The last frame of a walk (generator or walkTo): feet together 18 frames after the last step. */
export const walkEnd = gen => gen.f0 + 16 + (gen.steps ?? 8) * (gen.period ?? 20) + 18;

const xz = d => ({ type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: d });
const carArgs = names => Object.fromEntries(names.map(n => [n, str(n === "car" ? "car prefix: fills <car>_Seat_Driver, _Seat_Driver_Back, _Door_L/R, _Door_Handle, _Steering_Wheel" : "scene object id (overrides the car default)")]));
const walkArgs = Object.fromEntries(WALK_FIELDS.filter(f => f !== "type" && f !== "f0").map(f => [f, WALK_TYPES[f]]));

export const SKILL_INFO = {
	standIdle: {
		args: { at: xz("[x, z] world m; default the root keyed before f0"), heading: num("degrees (yaw); default the keyed yaw"), until: int("hold the pose to this frame") },
		needs: "args.at, or a root keyed before f0", frames: "1 (to args.until when given)",
		adds: ["keys: a standing pose, FK arms down"], example: { f0: 0, args: { at: [0, 0], heading: 0 } },
		place: { at: 0.03 },
	},
	walkTo: {
		args: { to: xz("[x, z] world m: the heading turns toward it and the steps cover the distance"), ...walkArgs,
			heading: { oneOf: [num(), WALK_TYPES.heading], description: "degrees: h1, or [h0, h1]" } },
		needs: "a standing pose keyed before f0", frames: "16 + steps * period + 18 (194 by default)",
		adds: ["keys: a walk (the walk generator), feet together at the end"], example: { f0: 10, args: { to: [0.5, 1.5] } },
		tune: { lift: 0.01, halfWidth: 0.01, firstStep: 0.01, step: 0.01 }, place: { firstStep: 0.03, step: 0.03 },
	},
	reachGrip: {
		args: { anchor: str("the anchor to grip (not ending in _l/_r)"), side: side("the hand"), reach: int("frames to reach", { default: 20 }), hold: int("frames held", { default: 22 }),
			release: int("frames to let go", { default: 12 }), elbow: ref("vec3", "elbow pole while reaching"), fingers: { enum: FINGER_PRESETS, default: "grip" },
			define: { type: "object", description: "an anchor (topic anchors) to define under args.anchor" } },
		required: ["anchor", "side"], needs: "args.anchor in spec.anchors or args.define", frames: "reach + hold + release (54 by default)",
		adds: ["props.<anchor>Grip (fingers point)", "fits: fingers onto the anchor", "checks.contacts \"fingers on <anchor>\"", "checks.allow hand on the anchor's object",
			"keys: w_<anchor>_<side>, fingers_<side>, armw_<side>"],
		example: { f0: 10, args: { anchor: "bar", side: "r", define: { kind: "world", p: [-0.2, 1.2, 0.33] } } },
		tune: { reach: 2, release: 2 },
	},
	sitInSeat: {
		args: { ...carArgs(["car", "seat", "seatBack", "wheel"]), offset: { ...ref("vec3", "hips from the seat top, seat frame"), default: [0, 0.17, 0.02] }, floor: num("floor y under the feet, m") },
		needs: "args.car or args.seat (a scene box)", frames: "1", adds: ["keys: seated, hands at the wheel", "checks.supports seat", "checks.allow seat, back, wheel"],
		example: { f0: 0, args: { car: "Car" } },
	},
	exitCar: {
		args: { ...carArgs(["car", "seat", "door", "handle"]), side: side("driver door side, default l"), channel: str("the door hinge channel", { default: "door" }) },
		needs: "seated in the car before f0 (sitInSeat); a car on the ground (seat base y 0.4)", frames: "246",
		adds: ["objects: door and handle hinges", "anchors handle, lthigh, rthigh", "props.grip", "fits, checks.contacts, checks.allow"],
		example: { f0: 0, args: { car: "Car" } },
	},
	smokeCigarette: {
		args: { until: int("hold to this frame; default the last frame; under f0+264 the beats are paced to fit"),
			kit: { type: "object", properties: { cig: str("the cigarette kit's rootId (object.createKit)"), lighter: str("the lighter kit's rootId"), exhale: str("the exhale kit's rootId (or an effect): it follows the mouth") },
				required: ["cig", "lighter"], additionalProperties: false, description: "kits the skill carries and lights: it adds their spec.objects entries itself" } },
		needs: "a stand or squat keyed before f0", frames: "265 nominal; fits 199..264 by pacing",
		adds: ["anchors lpocket, rpocket, hold, mouth, flame", "props cig, lighter", "channels cig_vis, lit_vis, flame_vis, ember_vis, exhale, ember",
			"checks contacts, orient, below, appear, mouthPoints"],
		example: { f0: 0, args: {} },
	},
};
