// The agent-facing words of the motion actions (src/commands/motion3.js): each action's description.
// Lane P owns the wording; the code only reads these constants. The procedure lives in the Studio
// system prompt and the field tables in motion.describe, so these strings say only what each action takes and answers.
export const MOTION_ACTION_HELP = {
	compile: "Bake a spec on the character's rig and run QA. install: true installs (default), false or \"never\" changes nothing, \"ifClean\" only if the final qa.ok; output.installed tells. "
		+ "Send spec, or base (an answered specId) + optional patch (JSON Patch); base alone or patch: [] re-measures (new probes). "
		+ "spec = { schema: \"cozyclay.motion-spec.v1\", fps: 24, frames (number or \"auto\"), ... } (parts: motion.describe); any number may be { range: [lo, hi] } (searched). "
		+ "probes (at most 16, request level; spec.probes: measured, not stored): { name, distance: [ref, ref] | position: ref, frames, every? }. "
		+ "Refs need a prefix (joint: prop: anchor: landmark: object:; goals[].moved: a bare id too) and take loose bone names (any case); spec.checks need exact ones. "
		+ "repair: { rounds } (1-8, default 4) applies group patches while severity drops. "
		+ "qa judges only what is broken; speed, acceleration, balance, knee bend are observations unless checks.limits names them. "
		+ "Answers frames, installed, specId, qa { ok, total, goals, groups (GOAL first, then severity; cause, hint, patch?) }, observations, delta (with base), repair, probes, timeline, fixed, search, skills. output.more: motion.report pages the rest.",
	qa: "Measure the character's installed take again against the scene as it is now (objects may have moved). Optional checks replace the spec's checks and its skills' checks. "
		+ "Answers specId and qa as motion.compile does (goals, ranked groups with cause, hint and patch); output.more pages with motion.report. Changes nothing.",
	sample: "World positions (metres) of named bones of the installed take at up to 64 frames. Bone names may be loose (any case, a mixamorig: prefix, aliases such as hips or hand_l); an unknown one answers a did-you-mean. "
		+ "Before a take is installed, use motion.compile probes instead. Changes nothing.",
	describe: "The motion spec reference. topic essentials: all a first spec needs, { types (every field of every topic, one line each; objects, channels and reachGrip "
		+ "say what fields mean), skills (typed args, needs, frames, adds), notes }. topic spec, skills, anchors, props, objects, checks, goals, probes, channels, refs or fix: "
		+ "{ topic, schema, example, notes }; skills lists the skills, with name one skill's args and a use example. topic examples answers whole specs that compile. "
		+ "topics: [topic | { topic, name? }] answers several in one call: { topics, more (the asks that did not fit) }. Changes nothing.",
	keyObject: "Key an object the installed take moves (objectId) at frame, then compile and install it whatever QA says (a user edit, one undo). "
		+ "A carried object takes pos [x, y, z] and rot [x, y, z, w], or aim [x, y, z] (its +Y) and roll?: its base's world pose (a group: its root), grab..release only (objects.<id>.keys); the hand follows. "
		+ "A hinge takes angle (degrees) or rot (its turn about the axis). remove: true deletes the key at frame. Refused where the take neither holds nor hinges it (drag it then). "
		+ "Answers keyed and the motion.compile output; REACH \"<id>: n cm off its keys\": what the hand missed.",
	report: "Page through the parts of a motion.compile or motion.qa answer that did not fit (output.more): part is groups (the default), timeline or probes, from the item index to start at; "
		+ "answers { specId, part, from, items, next } (next = the index to ask for next, null at the end). Changes nothing.",
};
