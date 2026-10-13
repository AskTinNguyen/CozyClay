// CozyClay 3 motion: the agent writes a motion spec (keys, anchors, props, fits, generators,
// checks), the deterministic compiler bakes every frame, QA measures it, and the take is
// installed on the character. Cheap enough to run in a loop until QA reports nothing.
import { fail, characterOf } from "./shared.js";
import { compileMotion } from "../motion3/compiler/compile.js";
import { runMotionQa } from "../motion3/qa/index.js";
import { bakeTake } from "../motion3/take.js";
import { motionScene } from "../motion3/scene.js";
import { skeletonFor } from "../motion3/rigs/index.js";
import { fk } from "../motion3/compiler/skeleton.js";
import { add, apply, ry } from "../motion3/compiler/math.js";

const TIMELINE_FPS = 24;
const id = { type: "string", minLength: 1 };
const openObject = { type: "object", properties: {}, required: [], additionalProperties: true };
const input = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const SPEC_HELP = "spec = { schema: \"cozyclay.motion-spec.v1\", fps: 24, frames, keys: [{ f, set: { channel: value }, step?: [channel] }], anchors, props, fits, objects, generators, checks }. "
	+ "World metres, +Y up, yaw 0 faces +Z, positive yaw toward +X, the character's left is +X at yaw 0. Channels: root [x,y,z] (hips), yaw, pitch, roll, spine_yaw/pitch/roll, head_yaw/pitch/roll, "
	+ "foot_l/r [ankle x,y,z], fyaw_l/r, fpitch_l/r, knee_l/r (body-frame pole), armw_l/r (0 FK .. 1 IK), hand_l/r [wrist x,y,z], w_<anchor>_l/r (hand-target weights), elbow_l/r (body-frame pole), "
	+ "wtwist_l/r, wflex_l/r, aswing_l/r, abend_l/r, arm_rest, fingers_l/r { relaxed|fist|grip|cigarette|point: weight }, plus any channel an object hinge or a check names.";

const declarations = Object.freeze([
	{ id: "motion.compile", label: "Compile motion", kind: "job", domain: "motion", timeoutMs: 120000,
		description: `Compile a motion spec for a character with the deterministic motion compiler, measure it with QA and (install: true, the default) install it as the character's take. ${SPEC_HELP} `
			+ "Answers output.qa { ok, total, groups: [{ kind, subject, count, first, last, worst, worstFrame, limit }] } and the frame count. Fix the keys and compile again until qa.ok; install: false measures without changing the scene.",
		input: input({ characterId: id, spec: openObject, install: { type: "boolean", default: true } }, ["characterId", "spec"]) },
	{ id: "motion.qa", label: "Measure motion", kind: "job", domain: "motion", timeoutMs: 120000,
		description: "Re-run motion QA for the character's installed take against the scene as it is now (objects may have moved). Optional checks replace the spec's own checks.",
		input: input({ characterId: id, checks: openObject }, ["characterId"]) },
	{ id: "motion.sample", label: "Sample motion", kind: "job", domain: "motion", timeoutMs: 30000,
		description: "World positions (metres) of named bones of the installed take at up to 64 frames, e.g. to read where a hand or the hips are before writing the next keys.",
		input: input({ characterId: id, frames: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 1, maxItems: 64 },
			bones: { type: "array", items: id, maxItems: 65 } }, ["characterId", "frames"]) },
]);
export { declarations };

const DEFAULT_BONES = ["Hips", "Head", "LeftHand", "RightHand", "LeftFoot", "RightFoot"];

export function register(registry, ports) {
	const owner = () => ports.storeDomain("motion");
	const mounted = () => Boolean(ports.storeDomain?.("motion")) || "The motion owner is not mounted.";
	const rigOf = character => {
		const sk = skeletonFor(character.model);
		if (!sk) fail("TARGET_NOT_READY", `${character.subject || character.id} is a ${character.model} body, which motion compile cannot drive; use an X Bot or Y Bot character.`);
		if (Math.abs((character.scale ?? 1) - 1) > 1e-6) fail("TARGET_NOT_READY", "Set the character's scale back to 1 before compiling motion.");
		return sk;
	};
	const compile = (character, spec) => {
		if (spec?.fps !== undefined && spec.fps !== TIMELINE_FPS) fail("INVALID_ARGUMENT", `spec.fps must be ${TIMELINE_FPS}, the timeline rate.`);
		const sk = rigOf(character);
		try {
			const out = compileMotion({ fps: TIMELINE_FPS, ...spec }, { sk, scene: motionScene(ports.state().objects) });
			return { sk, out, qa: runMotionQa(sk, out, spec) };
		} catch (error) {
			if (/^MOTION_SPEC_INVALID/.test(error.message)) fail("INVALID_ARGUMENT", error.message.replace(/^MOTION_SPEC_INVALID:\s*/, ""));
			throw error;
		}
	};
	const brief = qa => ({ ok: qa.ok, total: qa.total, groups: qa.groups.slice(0, 16) });
	const installed = characterId => owner().motionFor(characterId)?.schema === "cozyclay.take.v3" ? owner().motionFor(characterId)
		: fail("TARGET_NOT_READY", "This character has no compiled take; run motion.compile first.");

	registry.register({ ...declarations[0], available: mounted, target: args => args.characterId, run({ characterId, spec, install = true }, context) {
		const character = characterOf(ports, characterId);
		const { sk, out, qa } = compile(character, spec);
		if (install) {
			const take = bakeTake(sk, out, { position: [character.x ?? 0, character.y ?? 0, character.z ?? 0], yaw: character.rot ?? 0 }, { spec, prompt: spec.label ?? "" });
			const apply = () => owner().replace(characterId, { ...take, frames: take.frameCount });
			if (context?.commit) context.commit(apply); else apply();
		}
		return { affectedIds: install ? [characterId] : [], summary: `Compiled ${out.frameCount} frames; QA ${qa.ok ? "clean" : `${qa.total} issues`}.`,
			output: { frames: out.frameCount, fps: TIMELINE_FPS, installed: install, qa: brief(qa) } };
	} });
	registry.register({ ...declarations[1], available: mounted, run({ characterId, checks }) {
		const character = characterOf(ports, characterId), take = installed(characterId);
		const { qa } = compile(character, checks ? { ...take.spec, checks } : take.spec);
		return { affectedIds: [], summary: `QA ${qa.ok ? "clean" : `${qa.total} issues`}.`, output: { qa: brief(qa) } };
	} });
	registry.register({ ...declarations[2], available: mounted, run({ characterId, frames, bones = DEFAULT_BONES }) {
		const character = characterOf(ports, characterId), take = installed(characterId), sk = rigOf(character);
		const yaw = ry(take.placement?.yaw ?? 0), at = take.placement?.position ?? [0, 0, 0], B = take.bones.length;
		const rows = frames.map(f => {
			const ff = Math.min(take.frameCount - 1, f);
			const quats = Array.from({ length: B }, (_, b) => Array.from(take.rot.subarray((ff * B + b) * 4, (ff * B + b) * 4 + 4)));
			const state = fk(sk, quats, Array.from(take.hips.subarray(ff * 3, ff * 3 + 3)));
			return { frame: ff, bones: Object.fromEntries(bones.map(name => {
				const j = sk.index[name];
				if (j === undefined) fail("INVALID_ARGUMENT", `Unknown bone ${name}.`);
				return [name, add(at, apply(yaw, state.P[j])).map(v => Math.round(v * 1e4) / 1e4)];
			})) };
		});
		return { affectedIds: [], summary: `Sampled ${rows.length} frames.`, output: { frames: rows } };
	} });
}
