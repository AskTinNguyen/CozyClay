// C4. The compiled motion as beats, for the agent (output.timeline) and the beats contact sheet.
// Stub until lane B: no beats. Lane B returns at most 12 entries, ordered by f[0]:
//   { beat: skill name | "walk" | "keys", src: "use[i]" | "generators[i]" | "keys",
//     f: [first, last] (inclusive, absolute frames),
//     end: { root: [x,y,z], yaw, hand_l: [x,y,z], hand_r: [x,y,z], on_l: ref | null, on_r: ref | null },
//     planted: { l: [[f0, f1], ...], r: [...] },   // at most 4 per foot
//     events: [{ f, object, event: "grab" | "release" | "show" | "hide" }] }
// Metres to 3 decimals, degrees to 1. on_* = "anchor:<a>" whose w_<a>_<k> > 0.5, or the
// "object:<id>" that hand holds (object-pose.js inHandAt). planted = heel and ball below
// QA_LIMITS.plantH and still, for 3 frames or more.

/**
 * timelineOf(out, { used, spec }) -> entries
 * @param {object} out  compileMotion result
 * @param {{ used: { skill: string, f0: number, end: number }[], spec: object }} ctx  used = the
 *   skills expandUse ran, spec = the expanded spec
 * @returns {object[]}
 */
export function timelineOf(/* out, { used, spec } */) {
	return [];
}
