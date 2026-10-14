// The agent-facing words of the motion actions (src/commands/motion3.js): each action's description.
// Lane P owns the wording; the code only reads these constants. The procedure lives in the Studio
// system prompt and the field tables in motion.describe, so these strings say only what each action takes and answers.
export const MOTION_ACTION_HELP = {
	compile: "Compile a motion spec on the character's rig and run QA; install: true (the default) installs the take, install: false changes nothing. "
		+ "Send spec, or base (an answered specId; the last 64 are kept) and an optional patch (JSON Patch ops). "
		+ "spec = { schema: \"cozyclay.motion-spec.v1\", fps: 24, frames (a number or \"auto\"), use, keys, anchors, props, fits, objects, generators, checks, goals, fix, search }; motion.describe has each part. "
		+ "Any number may be { range: [lo, hi] } to be searched. INVALID_ARGUMENT lists every problem. "
		+ "probes (at most 16): { name, distance: [ref, ref] | position: ref, frames: [f0, f1], every? }, measured without an install. Refs in probes and goals take loose bone names (any case, aliases like hand_l); spec.checks need exact ones. "
		+ "repair: { rounds } (1-8, default 4) applies group patches while the summed severity drops. "
		+ "Answers frames, fps, installed, specId, qa { ok, total, goals, groups: [{ kind, subject, count, first, last, worstFrame, severity, cause, hint, patch? }] } (GOAL first, then severity), "
		+ "delta (with base), repair, probes, timeline (beats, end poses, planted feet, events), fixed, search, skills, ms. output.more: page the rest with motion.report.",
	qa: "Measure the character's installed take again against the scene as it is now (objects may have moved). Optional checks replace the spec's checks and its skills' checks. "
		+ "Answers specId and qa as motion.compile does (goals, ranked groups with cause, hint and patch); output.more pages with motion.report. Changes nothing.",
	sample: "World positions (metres) of named bones of the installed take at up to 64 frames. Bone names may be loose (any case, a mixamorig: prefix, aliases such as hips or hand_l); an unknown one answers a did-you-mean. "
		+ "Before a take is installed, use motion.compile probes instead. Changes nothing.",
	describe: "The motion spec reference: topic is one of spec, skills, anchors, props, objects, checks, goals, probes, channels, refs, fix; "
		+ "answers { topic, schema, example, notes }. skills answers the skill list { name, args, needs, frames, adds }, and with name one skill's args schema and a use example. Changes nothing.",
	report: "Page through the parts of a motion.compile or motion.qa answer that did not fit (output.more): part is groups, timeline or probes, from the item index to start at; "
		+ "answers { specId, part, from, items, next } (next = the index to ask for next, null at the end). Changes nothing.",
};
