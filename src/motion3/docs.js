// The agent-facing words of the motion actions (src/commands/motion3.js): the spec summary and
// each action's description. Lane P owns the wording; the code only reads these constants.
const SPEC_HELP = "spec = { schema: \"cozyclay.motion-spec.v1\", fps: 24, frames, use: [{ skill, args, f0 }], keys: [{ f, set: { channel: value }, step?: [channel] }], anchors, props, fits, objects, generators, checks, fix, search }. "
	+ "Prefer skills (use): standIdle, sitInSeat, exitCar, walkTo, reachGrip, smokeCigarette expand into keys, anchors, props, fits and checks; your own keys win over them. "
	+ "Any number may be { range: [lo, hi] } to let the compiler search it (QA 0 first, at most search.budget compiles, default 32, max 64). "
	+ "fix: { reach, slide } are on by default (soft wrist reach, hips lowered for near-miss ankles, planted feet locked under 1 cm); penetration: 0.02 and retime: true are opt-in. "
	+ "World metres, +Y up, yaw 0 faces +Z, positive yaw toward +X, the character's left is +X at yaw 0. Channels: root [x,y,z] (hips), yaw, pitch, roll, spine_yaw/pitch/roll, head_yaw/pitch/roll, "
	+ "foot_l/r [ankle x,y,z], fyaw_l/r, fpitch_l/r, knee_l/r (body-frame pole), armw_l/r (0 FK .. 1 IK), hand_l/r [wrist x,y,z], w_<anchor>_l/r (hand-target weights), elbow_l/r (body-frame pole), "
	+ "wtwist_l/r, wflex_l/r, aswing_l/r, abend_l/r, arm_rest, fingers_l/r { relaxed|fist|grip|cigarette|point: weight }, plus any channel an object hinge or a check names.";

export const MOTION_ACTION_HELP = {
	compile: `Compile a motion spec for a character with the deterministic motion compiler, measure it with QA and (install: true, the default) install it as the character's take. ${SPEC_HELP} `
		+ "Answers output.qa { ok, total, groups: [{ kind, subject, count, first, last, worst, worstFrame, limit, cause, hint }] } (cause = the key/anchor/fit/generator step/skill most responsible, hint = what to change, direction and amount in metres or degrees, at a frame), "
		+ "output.fixed (what the auto-fixes changed), output.search (chosen open values, evals, ms), output.skills and the frame count. Apply the hints and compile again until qa.ok; install: false measures without changing the scene.",
	qa: "Re-run motion QA (with cause and hint per group) for the character's installed take against the scene as it is now (objects may have moved). Optional checks replace the spec's own checks and its skills' checks.",
	sample: "World positions (metres) of named bones of the installed take at up to 64 frames, e.g. to read where a hand or the hips are before writing the next keys.",
	describe: "Describe the motion spec before writing one: topic is one of spec, skills, anchors, props, objects, checks, goals, probes, channels, refs, fix; "
		+ "answers { topic, schema, example, notes } (skills: the skill list, or with name one skill's args and a use example). Reading it changes nothing.",
	report: "Page through the parts of a motion.compile or motion.qa output that did not fit (output.more): part is groups, timeline or probes, from the item index to start at; "
		+ "answers { specId, part, from, items, next } (next = the index to ask for next, null at the end).",
};
