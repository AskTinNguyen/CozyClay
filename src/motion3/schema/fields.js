// C1. The motion spec's field tables, the one source the validator (compiler/validate*.js),
// the skills expander and motion.describe (describe.js) read. Channels, ranges and presets stay
// in compiler/vocab.js, FIX_KEYS in fix/index.js, QA_LIMITS in qa/checks.js and the skill names
// in skills/index.js; import those, never copy them here. See docs/motion-api-v3.1.md.

/** Top-level spec fields. */
export const SPEC_FIELDS = ["schema", "fps", "frames", "label", "keys", "anchors", "props", "fits", "objects", "generators", "checks", "fix", "use", "channels", "detourRadius", "search", "goals"];
/** One key: { f, set, step?, src? } (src is written by the skills expander). */
export const KEY_FIELDS = ["f", "set", "step", "src"];
/** One spec.use entry. */
export const USE_FIELDS = ["skill", "args", "f0"];
/** Anchor fields by anchor kind (besides `kind`). */
export const ANCHOR_FIELDS = { world: ["p"], body: ["p"], bone: ["bone", "offset"], segment: ["from", "to", "t", "tMin", "offset", "reach"],
	object: ["object", "local"], landmark: ["name"], prop: ["prop", "point", "offset"] };
export const PROP_FIELDS = ["hand", "origin", "points"];
export const FIT_FIELDS = ["side", "anchor", "effector", "offset"];
/** spec.objects[id]: a hinge or a carry (a body or a group id), see C3; carry keys: C14; a switch (any record, C15) moves nothing; a follow (any record, C16) rides a point of the body. */
export const OBJECT_FIELDS = { hinge: ["pivot", "axis", "channel"], carry: ["prop", "at", "along", "visible", "level", "grab", "release", "keys"], switch: ["visible", "level"],
	follow: ["follow", "offset", "aim", "visible", "level"] };
/** One spec.objects[id].keys entry (C14): the held object's world pose at frame f; aim (+ roll) in place of rot (C16). */
export const OBJECT_KEY_FIELDS = ["f", "pos", "rot", "aim", "roll"];
export const WALK_FIELDS = ["type", "f0", "steps", "step", "period", "swing", "halfWidth", "lift", "heading", "turnDistance", "pelvisHigh", "pelvisLow", "firstStep", "armSwing", "vary"];
/** spec.checks keys. */
export const CHECK_FIELDS = ["contacts", "orient", "below", "clearance", "appear", "supports", "allow", "limits", "mouthPoints"];
/** Fields of one entry of each spec.checks list. */
export const CHECK_ENTRY_FIELDS = {
	contacts: ["name", "point", "target", "tol", "when"],
	orient: ["name", "from", "to", "along", "minCos", "when"],
	below: ["name", "joint", "ref", "min", "when"],
	clearance: ["name", "part", "object", "min", "frames"],
	appear: ["name", "channel", "joint", "anchor", "tol"],
	supports: ["object", "part", "tol"],
	allow: ["part", "object", "depth"],
};
/** One spec.goals entry (C8): exactly one of near | above | moved | still | speed; after / before order it on another goal. */
export const GOAL_FIELDS = ["name", "near", "above", "moved", "still", "speed", "tol", "by", "at", "mode", "after", "before"];
/** One motion.compile probes entry (C5): exactly one of distance | position. */
export const PROBE_FIELDS = ["name", "distance", "position", "frames", "every"];
/** Point reference kinds (C2, refs.js). */
export const REF_KINDS = ["joint", "bone", "prop", "anchor", "landmark", "object"];
/** motion.describe topics (C9); examples: whole specs that compile (schema/spec-examples.js). */
export const DESCRIBE_TOPICS = ["essentials", "spec", "skills", "anchors", "props", "objects", "checks", "goals", "probes", "channels", "refs", "fix", "examples"];
