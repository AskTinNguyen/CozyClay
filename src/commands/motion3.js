// CozyClay 3 motion: the agent writes a motion spec (keys, anchors, props, fits, generators,
// checks, goals), the deterministic compiler bakes every frame, QA measures it, and the take is
// installed on the character. Cheap enough to run in a loop until QA reports nothing. The words
// the agent reads live in motion3/docs.js; the contracts in docs/motion-api-v3.1.md.
import { fail, characterOf } from "./shared.js";
import { compileSpec, liftRequest } from "../motion3/pipeline.js";
import { bakeTake } from "../motion3/take.js";
import { motionScene } from "../motion3/scene.js";
import { skeletonFor } from "../motion3/rigs/index.js";
import { fk } from "../motion3/compiler/skeleton.js";
import { add, apply, ry } from "../motion3/compiler/math.js";
import { resolveBone } from "../motion3/bones.js";
import { MOTION_ACTION_HELP as HELP } from "../motion3/docs.js";
import { DESCRIBE_TOPICS } from "../motion3/schema/fields.js";
import { describe, describeMany } from "../motion3/describe.js";
import { createSpecStore, specIdOf, SPEC_STORE_SIZE } from "../motion3/spec-store.js";
import { applyPatch } from "../motion3/json-patch.js";
import { deltaOf } from "../motion3/delta.js";
import { repairSpec } from "../motion3/repair.js";
import { fitOutput, reportPage } from "../motion3/report.js";
import { keyObject } from "../motion3/key-edit.js";
import { expandUse } from "../motion3/skills/index.js";
import { publishDraft } from "../agent-progress.js";

const TIMELINE_FPS = 24;
const id = { type: "string", minLength: 1 };
const specId = { type: "string", pattern: "^spec-[0-9a-f]{12}$" };
const openObject = { type: "object", properties: {}, required: [], additionalProperties: true };
const input = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const list = (items, maxItems) => ({ type: "array", items, minItems: 1, maxItems });
const numbers = n => ({ type: "array", items: { type: "number" }, minItems: n, maxItems: n });

// readOnly: reads the scene and the take, never changes them (C10).
const declarations = Object.freeze([
	{ id: "motion.compile", label: "Compile motion", kind: "job", domain: "motion", timeoutMs: 120000, description: HELP.compile,
		// patch may be empty: base alone (or patch: []) re-measures the stored spec, with new probes; "never" is install: false
		input: input({ characterId: id, spec: openObject, base: specId, patch: { type: "array", items: openObject, maxItems: 64 },
			install: { oneOf: [{ type: "boolean" }, { const: "ifClean" }, { const: "never" }], default: true },
			probes: list(openObject, 16), repair: input({ rounds: { type: "integer", minimum: 1, maximum: 8, default: 4 } }, []) }, ["characterId"]) },
	{ id: "motion.qa", label: "Measure motion", kind: "job", domain: "motion", timeoutMs: 120000, readOnly: true, description: HELP.qa,
		input: input({ characterId: id, checks: openObject }, ["characterId"]) },
	{ id: "motion.sample", label: "Sample motion", kind: "job", domain: "motion", timeoutMs: 30000, readOnly: true, description: HELP.sample,
		input: input({ characterId: id, frames: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 1, maxItems: 64 },
			bones: { type: "array", items: id, maxItems: 65 } }, ["characterId", "frames"]) },
	{ id: "motion.describe", label: "Describe motion spec", kind: "job", domain: "motion", timeoutMs: 10000, readOnly: true, description: HELP.describe,
		input: input({ topic: { type: "string", enum: DESCRIBE_TOPICS }, name: id,
			topics: list({ oneOf: [{ type: "string", enum: DESCRIBE_TOPICS }, input({ topic: { type: "string", enum: DESCRIBE_TOPICS }, name: id }, ["topic"])] }, 8) }, []) },
	{ id: "motion.report", label: "Read motion report", kind: "job", domain: "motion", timeoutMs: 10000, readOnly: true, description: HELP.report,
		input: input({ specId, part: { type: "string", enum: ["groups", "timeline", "probes"] }, from: { type: "integer", minimum: 0, default: 0 } }, ["specId", "part"]) },
	{ id: "motion.keyObject", label: "Key held object", kind: "job", domain: "motion", timeoutMs: 120000, description: HELP.keyObject,
		input: input({ characterId: id, objectId: id, frame: { type: "integer", minimum: 0 }, pos: numbers(3), rot: numbers(4), aim: numbers(3), roll: { type: "number" },
			angle: { type: "number" }, remove: { type: "boolean", default: false } }, ["characterId", "objectId", "frame"]) },
]);
export { declarations };

const DEFAULT_BONES = ["Hips", "Head", "LeftHand", "RightHand", "LeftFoot", "RightFoot"];
const unknownSpec = (what, value, then = "send spec") => fail("INVALID_ARGUMENT", `${what} "${value}" is not known (the editor keeps the last ${SPEC_STORE_SIZE} compiled specs this session); ${then}`);

const sameArray = (a, b) => a?.length === b?.length && Array.prototype.every.call(a, (v, i) => v === b[i]);
/** True when `installed` is the take `take` would install: the same spec, placement, bones and object tracks. */
function sameTake(installed, take) {
	return installed?.schema === take.schema && installed.frameCount === take.frameCount && installed.rig === take.rig
		&& specIdOf(installed.spec ?? null) === specIdOf(take.spec) && JSON.stringify(installed.placement) === JSON.stringify(take.placement)
		&& sameArray(installed.rot, take.rot) && sameArray(installed.hips, take.hips) && JSON.stringify(installed.objects ?? {}) === JSON.stringify(take.objects);
}

/** Runs `run`, turning a MOTION_SPEC_INVALID error into INVALID_ARGUMENT with the exact message. */
function asArgument(run) {
	try {
		return run();
	} catch (error) {
		if (/^MOTION_SPEC_INVALID/.test(error.message)) fail("INVALID_ARGUMENT", error.message.replace(/^MOTION_SPEC_INVALID:\s*/, ""));
		throw error;
	}
}

export function register(registry, ports) {
	const store = createSpecStore();
	const owner = () => ports.storeDomain("motion");
	const mounted = () => Boolean(ports.storeDomain?.("motion")) || "The motion owner is not mounted.";
	const always = () => true;
	const rigOf = character => {
		const sk = skeletonFor(character.model);
		if (!sk) fail("TARGET_NOT_READY", `${character.subject || character.id} is a ${character.model} body, which motion compile cannot drive; use an X Bot or Y Bot character.`);
		if (Math.abs((character.scale ?? 1) - 1) > 1e-6) fail("TARGET_NOT_READY", "Set the character's scale back to 1 before compiling motion.");
		return sk;
	};
	/** spec -> pipeline result + sk + stored (the spec a take keeps and its specId names: what was sent, or the filled-in spec). */
	const compile = (character, asked, opts) => {
		// spec.probes and bare moved ids are lifted before fps is filled in, so the specId stays the spec's own
		const { spec, probes } = liftRequest(asked, opts.probes);
		if (spec?.fps !== undefined && spec.fps !== TIMELINE_FPS) fail("INVALID_ARGUMENT", `spec.fps must be ${TIMELINE_FPS}, the timeline rate.`);
		const sk = rigOf(character), sent = { fps: TIMELINE_FPS, ...spec };
		const r = asArgument(() => compileSpec(sent, { sk, scene: motionScene(ports.state().objects) }, { ...opts, probes }));
		return { sk, ...r, stored: r.spec === sent ? spec : r.spec };
	};
	/** The whole output, kept in the store (motion.report, delta) and cut to the receipt budget (report.js). */
	const report = (r, head, extra = {}) => {
		const specIdValue = store.put(r.stored);
		store.keepParts(specIdValue, { groups: r.qa.groups, timeline: r.timeline, probes: r.probes ?? {} });
		return fitOutput({ ...head, specId: specIdValue, qa: r.qa, observations: r.observations, ...extra, ...(r.probes ? { probes: r.probes } : {}), timeline: r.timeline,
			fixed: r.fixed, ...(r.search ? { search: r.search } : {}), ...(r.used.length ? { skills: r.used } : {}), ms: r.ms });
	};
	/** The take of compile result r on the character, installed as one undo entry. */
	const installOf = (character, r, label, context) => {
		const take = bakeTake(r.sk, r.out, { position: [character.x ?? 0, character.y ?? 0, character.z ?? 0], yaw: character.rot ?? 0 }, { spec: r.stored, prompt: label ?? "" });
		return { take, put: () => { const apply = () => owner().replace(character.id, { ...take, frames: take.frameCount }); if (context?.commit) context.commit(apply); else apply(); } };
	};
	const installed = characterId => owner().motionFor(characterId)?.schema === "cozyclay.take.v3" ? owner().motionFor(characterId)
		: fail("TARGET_NOT_READY", "This character has no compiled take; run motion.compile first.");

	registry.register({ ...declarations[0], available: mounted, target: args => args.characterId, run({ characterId, spec, base, patch, install: asked = true, probes, repair }, context) {
		const install = asked === "never" ? false : asked;
		const character = characterOf(ports, characterId);
		if ((spec === undefined) === (base === undefined)) fail("INVALID_ARGUMENT", "Send exactly one of spec or base (the specId of a compiled spec, with patch).");
		if (patch !== undefined && base === undefined) fail("INVALID_ARGUMENT", "patch applies to base, the specId of a compiled spec; send base with it, or the whole spec.");
		const source = spec ?? asArgument(() => applyPatch(store.get(base) ?? unknownSpec("base", base), patch ?? []));
		const once = s => compile(character, s, { probes });
		const fixed = repair ? repairSpec(source, repair, once) : { spec: source, result: once(source) };
		const r = fixed.result, { out, qa } = r;
		// ifClean: install only a clean final result (qa.ok includes the goals; after repair when asked)
		const wanted = install === "ifClean" ? qa.ok : install;
		let installs = wanted, kept = false;
		// open ranges are stored with the values the search chose, so motion.qa re-measures this take
		const { take, put } = installOf(character, r, fixed.spec.label, context);
		if (wanted) {
			// ifClean of the take already installed changes nothing (no undo entry; IK edits on it stay)
			kept = install === "ifClean" && sameTake(owner().motionFor(characterId), take);
			installs = !kept;
			if (installs) put();
		}
		const delta = base === undefined ? {} : { delta: deltaOf(store.parts(base)?.groups ?? [], qa.groups, base) };
		const how = kept ? "; already installed, unchanged" : install === "ifClean" ? (installs ? "; installed" : "; not installed") : "";
		const output = report(r, { frames: out.frameCount, fps: TIMELINE_FPS, installed: wanted }, { ...delta, ...(fixed.repair ? { repair: fixed.repair } : {}) });
		// the user watches every draft, installed or not (agent-progress.js: viewport ghost, timeline beats, agent panel)
		publishDraft(characterId, { take, installed: installs || kept, specId: output.specId, label: fixed.spec.label ?? null, qa, timeline: r.timeline });
		return { affectedIds: installs ? [characterId] : [], summary: `Compiled ${out.frameCount} frames; QA ${qa.ok ? "clean" : `${qa.total} issues`}${how}.`, output };
	} });
	registry.register({ ...declarations[1], available: mounted, run({ characterId, checks }) {
		const character = characterOf(ports, characterId), take = installed(characterId);
		const r = compile(character, take.spec, { checks });
		return { affectedIds: [], summary: `QA ${r.qa.ok ? "clean" : `${r.qa.total} issues`}.`, output: report(r, {}) };
	} });
	registry.register({ ...declarations[2], available: mounted, run({ characterId, frames, bones = DEFAULT_BONES }) {
		const character = characterOf(ports, characterId), take = installed(characterId), sk = rigOf(character);
		const yaw = ry(take.placement?.yaw ?? 0), at = take.placement?.position ?? [0, 0, 0], B = take.bones.length;
		const rows = frames.map(f => {
			const ff = Math.min(take.frameCount - 1, f);
			const quats = Array.from({ length: B }, (_, b) => Array.from(take.rot.subarray((ff * B + b) * 4, (ff * B + b) * 4 + 4)));
			const state = fk(sk, quats, Array.from(take.hips.subarray(ff * 3, ff * 3 + 3)));
			return { frame: ff, bones: Object.fromEntries(bones.map(name => {
				const { bone, hint } = resolveBone(sk, name);
				if (bone === null) fail("INVALID_ARGUMENT", `Unknown bone ${name}${hint || "."}`);
				return [name, add(at, apply(yaw, state.P[sk.index[bone]])).map(v => Math.round(v * 1e4) / 1e4)];
			})) };
		});
		return { affectedIds: [], summary: `Sampled ${rows.length} frames.`, output: { frames: rows } };
	} });
	registry.register({ ...declarations[3], available: always, run({ topic, name, topics }) {
		if ((topic === undefined) === (topics === undefined) || (topics && name !== undefined)) fail("INVALID_ARGUMENT", "Send topic (and name) for one answer, or topics: [{ topic, name? }] for several in one call, not both.");
		if (topics) {
			const output = asArgument(() => describeMany(topics.map(t => (typeof t === "string" ? { topic: t } : t))));
			return { affectedIds: [], summary: `Described ${output.topics.map(a => (a.name ? `${a.topic} ${a.name}` : a.topic)).join(", ")}${output.more ? `; ${output.more.length} more did not fit` : ""}.`, output };
		}
		return { affectedIds: [], summary: `Described ${topic}${name ? ` ${name}` : ""}.`, output: asArgument(() => describe(topic, name)) };
	} });
	registry.register({ ...declarations[4], available: always, run({ specId: wanted, part, from = 0 }) {
		const page = reportPage(store.parts(wanted) ?? unknownSpec("specId", wanted, "compile it again"), wanted, part, from);
		return { affectedIds: [], summary: `${page.items.length} ${part} from ${from}.`, output: page };
	} });
	// motion.keyObject (C14): one key of a held object (or a hinge angle) in the installed take's spec, compiled
	// and installed whatever QA says (a user edit), as one undo entry
	registry.register({ ...declarations[5], available: mounted, target: args => args.characterId, run({ characterId, ...args }, context) {
		const character = characterOf(ports, characterId), take = installed(characterId), scene = motionScene(ports.state().objects);
		const { spec, keyed } = asArgument(() => keyObject(take.spec, scene, args, expandUse(take.spec, { sk: rigOf(character), scene, lenient: true }).spec.objects));
		const r = compile(character, spec, { lenient: true });
		installOf(character, r, take.prompt, context).put();
		return { affectedIds: [characterId], summary: `${keyed.removed ? "Removed the key of" : "Keyed"} ${keyed.objectId} at f${keyed.f}; QA ${r.qa.ok ? "clean" : `${r.qa.total} issues`}; installed.`,
			output: report(r, { frames: r.out.frameCount, fps: TIMELINE_FPS, installed: true, keyed }) };
	} });
}
