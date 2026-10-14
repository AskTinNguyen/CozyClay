// C9. motion.describe { topic, name? }: the spec's schema, a valid example and notes, from
// schema/fields.js and the vocabularies it points to. Stub until lane A: every topic answers
// the right shape with the field names only. Every answer stays under 6,000 bytes of JSON.
//   topic != "skills"           { topic, schema (JSON Schema 2020-12 fragment), example, notes: [] }
//   topic "skills"              { topic, skills: [{ name, args, needs, frames, adds }] }
//   topic "skills", name        { topic, name, schema (the skill's args), example (a use entry), notes }
import { SPEC_FIELDS, ANCHOR_FIELDS, PROP_FIELDS, FIT_FIELDS, OBJECT_FIELDS, CHECK_FIELDS, CHECK_ENTRY_FIELDS, GOAL_FIELDS, PROBE_FIELDS, REF_KINDS, DESCRIBE_TOPICS } from "./schema/fields.js";
import { VEC_CHANNELS, NUM_CHANNELS, MAP_CHANNELS, didYouMean } from "./compiler/vocab.js";
import { FIX_KEYS } from "./fix/index.js";
import { SKILL_NAMES } from "./skills/index.js";

const object = fields => ({ type: "object", properties: Object.fromEntries(fields.map(f => [f, {}])) });
const byKind = table => ({ oneOf: Object.entries(table).map(([kind, fields]) => ({ title: kind, ...object(fields) })) });
const SCHEMAS = {
	spec: () => object(SPEC_FIELDS),
	anchors: () => byKind(ANCHOR_FIELDS),
	props: () => ({ props: object(PROP_FIELDS), fits: object(FIT_FIELDS) }),
	objects: () => byKind(OBJECT_FIELDS),
	checks: () => ({ ...object(CHECK_FIELDS), entries: Object.fromEntries(Object.entries(CHECK_ENTRY_FIELDS).map(([k, f]) => [k, object(f)])) }),
	goals: () => object(GOAL_FIELDS),
	probes: () => object(PROBE_FIELDS),
	channels: () => ({ enum: [...VEC_CHANNELS, ...NUM_CHANNELS, ...MAP_CHANNELS] }),
	refs: () => ({ enum: REF_KINDS }),
	fix: () => object(FIX_KEYS),
};
const EXAMPLE = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 48, keys: [{ f: 0, set: { yaw: 0 } }] };
const NOTE = "stub: lane A fills the schema, example and notes";
const bad = msg => { throw new Error(`MOTION_SPEC_INVALID: ${msg}`); };

/** describe(topic, name?) -> the answer for one topic (see the table above). */
export function describe(topic, name) {
	if (!DESCRIBE_TOPICS.includes(topic)) bad(`topic "${topic}" is not a describe topic${didYouMean(String(topic), DESCRIBE_TOPICS)} (topics: ${DESCRIBE_TOPICS.join(", ")})`);
	if (topic !== "skills") return { topic, schema: SCHEMAS[topic](), example: topic === "spec" ? EXAMPLE : {}, notes: [NOTE] };
	if (name === undefined) return { topic, skills: SKILL_NAMES.map(n => ({ name: n, args: {}, needs: "", frames: "", adds: [] })) };
	if (!SKILL_NAMES.includes(name)) bad(`skill "${name}" is not a skill${didYouMean(String(name), SKILL_NAMES)} (skills: ${SKILL_NAMES.join(", ")})`);
	return { topic, name, schema: { type: "object", properties: {} }, example: { skill: name, args: {}, f0: 0 }, notes: [NOTE] };
}
