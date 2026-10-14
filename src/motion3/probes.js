// C5. Probes: measurements the agent asks for on this compile (motion.compile { probes }),
// whether or not it installs. Stub until lane B: no results. Lane B checks each probe (at most
// 16, schema/fields.js PROBE_FIELDS, refs.js checkRef with the full grammar; errors are
// MOTION_SPEC_INVALID, e.g. probes[0].distance[0] "joint:LeftHnad": unknown bone; did you mean
// "LeftHand"?) and answers per name:
//   distance [a, b]  { min, minAt, max, maxAt, mean, first, last }   (refs.js refDistance)
//   position ref     { at: [{ f, p: [x,y,z] }] }                       (every `every` frames, <= 16 rows)
// frames: [f0, f1] absolute (default the whole take).

/**
 * runProbes(out, probes, { spec, sk, scene }) -> { [name]: result }
 * @param {object} out  compileMotion result
 * @param {object[]} probes  the request's probes
 * @param {{ spec: object, sk: object, scene: object }} ctx  spec = the expanded spec
 */
export function runProbes(/* out, probes, { spec, sk, scene } */) {
	return {};
}
