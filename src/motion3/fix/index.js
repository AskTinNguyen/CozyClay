// Deterministic auto-fixes the compiler applies after the first solve (spec.fix). Each fix edits
// the baked channels or the per-frame IK offsets and re-solves only the frames it touched, so QA
// still measures the final frames; every fix reports what it changed (counts, worst amount).
//
// spec.fix = { reach: true, slide: true, penetration: 0.02, retime: false } (false = all off)
//   reach        wrist targets past the arm's reach go onto it through a soft knee (no snap);
//                ankle targets past the leg's reach lower the hips just enough, eased in and out
//   slide        a sole under the floor lifts its ankle onto it (ground.js); a planted heel or ball
//                that drifts less than 1 cm stays put, and a foot turning on its planted ball (heel
//                up) or heel pivots about it whatever the drift
//   penetration  hands pushed out of scene boxes along the box normal when the depth past the
//                allowance is at most this many metres (true = 0.02), eased in and out
//   retime       speed spikes get more frames, borrowed from the neighbouring keys
import { lowerHips, armReach } from "./reach.js";
import { lockFeet } from "./slide.js";
import { liftSoles } from "./ground.js";
import { pushOut } from "./push.js";
import { retime } from "./retime.js";

const FIX_KEYS = ["reach", "slide", "penetration", "retime"];
export { FIX_KEYS };

export function fixOptions(fix) {
	if (fix === false) return { reach: false, slide: false, penetration: 0, retime: false };
	const f = fix ?? {};
	const pen = f.penetration === true ? 0.02 : Math.min(0.05, Math.max(0, Number(f.penetration) || 0));
	return { reach: f.reach !== false, slide: f.slide !== false, penetration: pen, retime: f.retime === true };
}

const mergeReach = (a, b) => (a && b ? { frames: Math.max(a.frames, b.frames), eased: Math.max(a.eased, b.eased), max: Math.max(a.max, b.max), how: a.how } : a ?? b);

/** Runs the enabled fixes in order (retime first: it moves keys) and returns their reports. */
export function applyFixes(out, fix, engine, { whole = true } = {}) {
	const fixed = {}, put = (name, report) => { if (report) fixed[name] = report; };
	if (fix.retime && whole) put("retime", retime(out, engine));
	if (fix.slide) put("ground", liftSoles(out, engine));
	if (fix.reach) put("reachLegs", lowerHips(out, engine));
	if (fix.slide) put("slide", lockFeet(out, engine));
	// a pivot can hold a foot past the leg's reach: the hips go down for those frames too
	if (fix.reach && fixed.slide?.pivots) put("reachLegs", mergeReach(fixed.reachLegs, lowerHips(out, engine)));
	if (fix.penetration > 0) put("penetration", pushOut(out, engine, fix.penetration));
	if (fix.reach) put("reachArms", armReach(out));
	return fixed;
}
