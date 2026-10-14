// QA of scene objects the spec moves (C3 and 7.1). Stub until lane C: no issues.
// Lane C reports, as plain issues { kind, msg, frame, value, limit } (frame indexes out.frames):
//   GRAB     msg "<id>: hand 12.0 cm from it at grab", frame = grab, limit = checks.limits.grab
//            (default 0.03 m); the distance runs from the prop origin to the part boxes' surface
//   COLLIDE  msg "<part> x <object>" (the body against a carried object, except the holding hand's
//            fingers, hand and forearm) and "<object> x <other>" (a carried object against the
//            scene), with the QA_LIMITS depths; the support it stood on at grab is excused for
//            +-3 frames around grab and release, anything else through checks.allow

/**
 * objectChecks(sk, out, spec) -> issues
 * @param {object} sk  the rig
 * @param {object} out  compileMotion result (out.ctx.spec, out.ctx.scene; object-pose.js)
 * @param {object} spec  the expanded spec QA measures (checks, objects)
 * @returns {{ kind: string, msg: string, frame: number, value: number, limit: number }[]}
 */
export function objectChecks(/* sk, out, spec */) {
	return [];
}
