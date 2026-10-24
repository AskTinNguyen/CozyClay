// Coverage patterns: how a director covers a scene with several shots. Each
// pattern lists its shots as technique stacks from the camera technique
// library (src/camera-techniques), on the first or second cast member. The
// planner (plan.js) splits the frame range, picks the side of the line, and
// camera.cover lays the shots and applies each stack. Descriptions are
// CozyClay's own words.

/** One shot of a pattern: a role word for the name, whose shot it is (0 = A, 1 = B), its stack, and stacks to try when it cannot keep the line. */
const shot = (role, who, stack, extra = {}) => ({ role, who, stack, ...extra });

export const COVERAGE_PATTERNS = Object.freeze([
	{
		id: "shot-reverse-shot", name: "Shot-Reverse-Shot", tag: "SRS", cast: 2, moods: ["conversation", "dialogue", "exchange"],
		aliases: ["shot reverse shot", "shot/reverse shot", "shot countershot", "reverse coverage", "cover this conversation", "cover the conversation", "cover this dialogue", "cover the dialogue", "dialogue coverage", "conversation coverage", "reverse on"],
		description: "Alternates over-the-shoulder views of two speakers, each camera behind the listener, both on the same side of the line so the eyelines meet across every cut.",
		shots: (count = 4) => Array.from({ length: Math.max(2, count) }, (_, i) => shot("OTS", i % 2, [{ id: "over-the-shoulder" }])),
	},
	{
		id: "master-coverage", name: "Master and Coverage", tag: "MASTER+", cast: 2, moods: ["coverage", "geography", "conversation"],
		aliases: ["master and coverage", "master coverage", "master then coverage", "give me master and coverage", "full coverage", "standard coverage"],
		description: "A wide master that holds the whole exchange, then a medium on each speaker, then their close-ups: the classic safety net an editor cuts down from.",
		shots: () => [shot("Master", 0, [{ id: "master-shot" }]), shot("MS", 0, [{ id: "medium-shot" }]), shot("MS", 1, [{ id: "medium-shot" }]),
			shot("CU", 0, [{ id: "close-up" }]), shot("CU", 1, [{ id: "close-up" }])],
	},
	{
		id: "dialogue-singles", name: "Dialogue Singles", tag: "SINGLES", cast: 2, moods: ["conversation", "isolation", "intimacy"],
		aliases: ["dialogue singles", "clean singles", "singles", "single coverage", "clean single"],
		description: "Clean medium close-ups of each speaker with nobody else in frame, cut back and forth; colder and more isolated than over-the-shoulder coverage.",
		shots: (count = 2) => Array.from({ length: Math.max(2, count) }, (_, i) => shot("Single", i % 2, [{ id: "medium-close-up" }])),
	},
	{
		id: "walk-and-talk", name: "Walk and Talk", tag: "WALK+TALK", cast: 2, moods: ["journey", "conversation", "energy"],
		aliases: ["walk and talk", "walk & talk", "walk-and-talk", "walking conversation", "walk n talk"],
		description: "A tracking two-shot that travels with both speakers, then a leading single on the first, the camera backing up ahead of them.",
		shots: () => [shot("Track 2-shot", 0, [{ id: "two-shot" }, { id: "tracking-shot", params: { speed: "slow" } }]),
			shot("Leading single", 0, [{ id: "medium-close-up" }, { id: "head-on-shot" }, { id: "pull-out", params: { speed: "slow" } }])],
	},
	{
		id: "action-coverage", name: "Action Coverage", tag: "ACTION", cast: 1, moods: ["action", "energy", "impact"],
		aliases: ["action coverage", "cover the action", "cover this action", "action sequence coverage", "fight coverage", "chase coverage"],
		description: "Establish the space wide, track the action at medium, punch in on the beat with an insert or close-up, then land on the reaction.",
		shots: (count, beat = "insert") => [shot("Establish", 0, [{ id: "establishing-shot", params: { height: 3 } }]), shot("Track", 0, [{ id: "medium-shot" }, { id: "tracking-shot" }], { alternates: [[{ id: "medium-shot" }, { id: "smooth-tracking-shot", params: { speed: "medium" } }]] }),
			shot(beat === "close-up" ? "Beat CU" : "Insert", 0, [{ id: beat === "close-up" ? "close-up" : "insert-shot" }]), shot("Reaction", 1, [{ id: "close-up" }])],
	},
	{
		id: "establish-detail", name: "Establish to Detail", tag: "EST→CU", cast: 1, moods: ["context", "opening", "reveal"],
		aliases: ["establish detail", "establish to detail", "establishing to close-up", "wide to close", "funnel in", "establish then detail"],
		description: "Walks the audience in from the place to the person: an extreme wide, a wide, a medium, then a close-up on the subject.",
		shots: () => [shot("EWS", 0, [{ id: "extreme-long-shot" }]), shot("WS", 0, [{ id: "wide-shot" }]), shot("MS", 0, [{ id: "medium-shot" }]), shot("CU", 0, [{ id: "close-up" }])],
	},
]);

export const COVERAGE_PATTERN_IDS = Object.freeze(COVERAGE_PATTERNS.map((pattern) => pattern.id));
export const coveragePattern = (id) => COVERAGE_PATTERNS.find((pattern) => pattern.id === id) ?? null;

/** The compact index an agent reads: [id, shots, cast it wants, one line]. */
export function coverageIndex() {
	return COVERAGE_PATTERNS.map((pattern) => [pattern.id, pattern.shots().map((row) => row.role).join(" / "), `cast ${pattern.cast}`]);
}
