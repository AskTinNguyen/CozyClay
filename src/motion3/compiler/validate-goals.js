// Validation of spec.goals (C8). Stub until lane G: accepts any goals.
// Lane G checks, with exact messages through err(...):
//   - each goal names exactly one predicate of near | above | moved (schema/fields.js GOAL_FIELDS)
//   - near/above take two refs, moved one object ref (refs.js checkRef, the full ref grammar)
//   - tol/by finite numbers, mode "all" | "any", at an absolute frame or [f0, f1] within 0..frames-1
//   - unknown fields are refused unless opts.lenient

/**
 * validateGoals(spec, err, opts)
 * @param {object} spec  the expanded spec
 * @param {(msg: string) => void} err  collects one problem (validate.js)
 * @param {{ sk?: object, scene?: object, frames: number, lenient?: boolean }} opts
 */
export function validateGoals(/* spec, err, opts */) {}
