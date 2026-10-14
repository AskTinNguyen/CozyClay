// JSON Schema 2020-12 fragments for the fields of each table in schema/fields.js, keyed by the
// field name. The field lists themselves stay in fields.js: describe.js walks those lists and
// looks each field up here, and throws when one is missing, so a new field needs a type here.
// Shared shapes are $refs into DEFS (describe.js adds the ones an answer uses).
import { REF_KINDS, OBJECT_KEY_FIELDS } from "./fields.js";
import { CONVENTIONS } from "../compiler/vocab.js";
import { QA_LIMITS } from "../qa/checks.js";
import { CAPSULES } from "../qa/geometry.js";

const def = (d, extra) => ({ ...extra, ...(d ? { description: d } : {}) });
export const num = (d, extra) => def(d, { type: "number", ...extra });
export const int = (d, extra) => def(d, { type: "integer", ...extra });
export const str = (d, extra) => def(d, { type: "string", ...extra });
const bool = (d, extra) => def(d, { type: "boolean", ...extra });
export const ref = (name, d) => def(d, { $ref: `#/$defs/${name}` });
export const side = d => def(d, { enum: ["l", "r"] });
const pair = (items, d) => def(d, { type: "array", prefixItems: [items, items], minItems: 2, maxItems: 2 });

export const DEFS = {
	vec3: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
	frameSpan: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 2, maxItems: 2, description: "[f0, f1] inclusive" },
	ref: { type: "string", pattern: `^(${REF_KINDS.join("|")}):.+$`, description: "a point ref (topic refs)" },
	checkRef: { type: "string", pattern: "^(joint|prop|anchor):.+$", description: "joint:<Bone> | prop:<prop>.<point> | anchor:<name>" },
	part: { type: "string", description: `a body capsule: ${CAPSULES.map(c => c[0]).join(", ")}; allow matches a prefix (hand = hand_l and hand_r)` },
	when: { oneOf: [{ type: "string", description: "a weight channel: active where it is > 0.99" }, { $ref: "#/$defs/frameSpan" }] },
};

export const KEY_TYPES = {
	f: int("frame", { minimum: 0 }), set: { type: "object", description: "{ channel: value } (topic channels)" },
	step: { type: "array", items: { type: "string" }, description: "channels that jump at f instead of easing in" },
	src: str("written by the skills expander; leave it out"),
};

export const USE_TYPES = { skill: str("a skill name (topic skills)"), args: { type: "object", description: "the skill's args (topic skills with name)" }, f0: int("first frame", { minimum: 0 }) };

export const WALK_TYPES = {
	type: { const: "walk" }, f0: int("first frame; needs a standing pose keyed before it", { minimum: 0 }), steps: int("footsteps", { minimum: 1, default: 8 }),
	step: num("stride, m", { default: 0.5 }), period: int("frames per step", { default: 20 }), swing: int("frames a foot is in the air", { default: 14 }),
	halfWidth: num("feet half-width, m", { default: 0.1 }), lift: num("foot lift, m", { default: 0.08 }), heading: pair({ type: "number" }, `[h0, h1] degrees; ${CONVENTIONS.yaw}`),
	turnDistance: num("m walked while the heading turns h0 -> h1", { default: 0.4 }), pelvisHigh: num("hips offset over the stance foot, m"),
	pelvisLow: num("hips offset at double support, m"), firstStep: num("first stride, m", { default: 0.4 }), armSwing: num("degrees", { default: 14 }),
};

export const SPEC_TYPES = {
	schema: { const: "cozyclay.motion-spec.v1" }, fps: { const: 24 },
	frames: { oneOf: [int(null, { minimum: 1, maximum: 20000 }), { const: "auto", description: "the last skill end, generator end or key f, plus 1 (open values at their upper bound); the stored spec keeps the number" }] },
	label: str("a short name for the take"),
	keys: { type: "array", items: { $ref: "#/$defs/key" } },
	anchors: { type: "object", description: "name -> anchor (topic anchors)" }, props: { type: "object", description: "name -> held prop (topic props)" },
	fits: { type: "array", description: "topic props" }, objects: { type: "object", description: "scene object id -> hinge or carry (topic objects)" },
	generators: { type: "array", items: { $ref: "#/$defs/walk" } }, checks: { type: "object", description: "topic checks" },
	fix: { oneOf: [{ const: false }, { type: "object" }], description: "topic fix" }, use: { type: "array", items: { $ref: "#/$defs/use" } },
	channels: { type: "array", items: { type: "string" }, description: "extra numeric channels your keys set" },
	detourRadius: num("m; a hand moving between targets arcs around the torso this far out", { default: 0.25 }),
	search: { type: "object", properties: { budget: int("compiles at most", { minimum: 1, maximum: 64, default: 32 }) }, additionalProperties: false },
	goals: { type: "array", description: "topic goals" },
};

export const ANCHOR_TYPES = {
	p: ref("vec3", `world: a world point (m); body: root-relative, ${CONVENTIONS.pole}`), bone: str("bone name"), offset: ref("vec3", "world offset, m"),
	from: str("bone"), to: str("bone"), t: num("0 = from .. 1 = to", { default: 0.5 }), tMin: num("with reach: the lowest t to slide back to", { default: 0.15 }),
	reach: side("slide toward `from` until this arm reaches"), object: str("scene object id"), local: ref("vec3", "point in the object's frame, m"),
	name: { const: "mouth" }, prop: str("a prop held by the other hand"), point: str("a point of that prop, or origin"),
};

const palm = d => ref("vec3", `${d} [d, l, n] on the palm axes (d to the middle finger, l to the thumb side, n = d x l), m`);
/** Fields an anchor of each kind must have. */
export const ANCHOR_REQUIRED = { world: ["p"], body: ["p"], bone: ["bone"], segment: ["from", "to"], object: ["object"], landmark: ["name"], prop: ["prop", "point"] };

export const PROP_TYPES = {
	hand: side(), origin: { type: "array", items: { type: "string" }, minItems: 1, description: "bones whose mean is the prop origin" },
	points: { type: "object", additionalProperties: palm("point:"), description: "name -> point" },
};

export const FIT_TYPES = {
	side: side(), anchor: str("an anchor name"),
	effector: { oneOf: [{ type: "object", properties: { prop: str(), point: str() }, required: ["prop", "point"] }, { type: "object", properties: { joints: { type: "array", items: { type: "string" } } }, required: ["joints"] }],
		description: "the hand point fitted onto the anchor" },
	offset: ref("vec3", "world offset, m"),
};

const OBJECT_KEY_TYPES = { f: int(), pos: ref("vec3"), rot: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4, description: "quaternion x, y, z, w" },
	aim: ref("vec3", "or rot: its +Y direction"), roll: num("deg about aim") };

export const OBJECT_TYPES = {
	pivot: ref("vec3", "world hinge point, m"), axis: ref("vec3", "default [0, 1, 0]"), channel: str("the angle channel (degrees) your keys set"),
	prop: str("a spec.props name: it rides that hand"), at: palm("fixed offset:"), along: palm("its +Y, fixed:"),
	visible: str("a channel: shown above 0.5"), level: str("a channel: light, glow, effect strength 0..4 (1 as authored)"), grab: int("frame the hand takes it", { default: 0 }), release: int("frame it is put down (else the end)"),
	keys: { type: "array", items: { type: "object", properties: Object.fromEntries(OBJECT_KEY_FIELDS.map(f => [f, OBJECT_KEY_TYPES[f]])), required: ["f", "pos"], additionalProperties: false },
		description: "world pose at f (a group: its root), grab..release; the hand follows" },
	follow: ref("ref"), offset: ref("vec3"), aim: { oneOf: [{ enum: ["face", "up"] }, { $ref: "#/$defs/vec3" }, { $ref: "#/$defs/ref" }], default: "up" },
};

export const CHECK_ENTRY_TYPES = {
	name: str("the QA group's name"), point: ref("checkRef"), target: ref("checkRef"),
	tol: num("m; default contacts 0.01, appear 0.035, supports 0.04"), when: ref("when"), from: ref("checkRef"), to: ref("checkRef"),
	along: { oneOf: [{ enum: ["face", "up"] }, { $ref: "#/$defs/vec3" }] }, minCos: num("default 0.64"),
	joint: str("bone"), ref: str("bone"), min: num("m; below default 0.08"), part: ref("part"),
	object: str("scene object id"), frames: ref("frameSpan"), channel: str("a visibility channel"), anchor: str("an anchor name"), depth: num("allowed depth, m"),
};

/** Fields each checks entry must have. */
export const CHECK_REQUIRED = { contacts: ["point", "target"], orient: ["from", "to", "along"], below: ["joint", "ref"], clearance: ["part", "object", "min"],
	appear: ["channel", "joint", "anchor"], supports: ["object"], allow: ["part", "object", "depth"] };

export const CHECKS_TYPES = {
	limits: { type: "object", properties: Object.fromEntries(Object.entries(QA_LIMITS).map(([k, v]) => [k, num(null, { default: v })])), additionalProperties: false },
	mouthPoints: { type: "array", items: str("prop.point"), description: "prop points allowed at the mouth" },
};

export const GOAL_TYPES = {
	name: str(), near: pair({ $ref: "#/$defs/ref" }, "distance <= tol"), above: pair({ $ref: "#/$defs/ref" }, "a.y - b.y >= by"),
	moved: str("object id or object:<id>[.center|.top|.base]; its base moved at least `by` from the scene pose"), tol: num("m", { default: 0.05 }),
	by: num("m; above default 0, moved default 0.05"), at: { oneOf: [int(null, { minimum: 0 }), { $ref: "#/$defs/frameSpan" }], description: "absolute frame or span" },
	mode: { enum: ["all", "any"], default: "all", description: "every frame of `at`, or one" },
};

export const PROBE_TYPES = {
	name: str("the key of the answer"), distance: pair({ $ref: "#/$defs/ref" }, "min/max/mean/first/last m"), position: ref("ref", "world points"),
	frames: ref("frameSpan", "absolute, default the whole take"), every: int("position: every n frames (<= 16 rows)", { minimum: 1 }),
};

export const FIX_TYPES = {
	reach: bool("wrist targets past reach go onto it softly; hips lower for near-miss ankles", { default: true }),
	slide: bool("a planted heel or ball drifting under 1 cm stays put", { default: true }),
	penetration: { oneOf: [{ type: "boolean" }, { type: "number", minimum: 0, maximum: 0.05 }], default: 0, description: "push hands out of boxes up to this depth, m (true = 0.02)" },
	retime: bool("speed spikes borrow frames from the neighbouring keys", { default: false }),
};

export const REF_DOCS = {
	joint: "joint:<Bone>, the bone's joint", bone: "bone:<Bone>, as joint:", prop: "prop:<prop>.<point> (origin always exists)",
	anchor: "anchor:<name>, a spec anchor", landmark: "landmark:mouth", object: "object:<id>[.center|.top|.base], a body or group (Empty); bare = its surface in a distance",
};
