// One motion compile as a job of plain data, the same in the compile worker (compile-worker.js) and on
// the calling thread (commands/motion3-compile.js, where no worker runs: Node, tests): the rig by model
// name, the motion scene (scene.js motionScene of the editor's objects: boxes only), the spec as sent, and
// what to do with it (probes, checks, lenient, repair, bake). The answer is plain data and typed arrays
// only (the compiler's out holds closures), so it crosses a worker boundary: QA, observations, the stored
// spec, and the baked take when asked.
// A refusal is an Error with a code (INVALID_ARGUMENT, MOTION_SPEC_INVALID turned into it), which the
// client turns back into the Studio's protocol error.
import { compileSpec, liftRequest } from "./pipeline.js";
import { repairSpec } from "./repair.js";
import { bakeTake } from "./take.js";
import { skeletonFor } from "./rigs/index.js";

const TIMELINE_FPS = 24;
const refuse = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** Runs `run`, turning a MOTION_SPEC_INVALID error into INVALID_ARGUMENT with the exact message. */
function asArgument(run) {
	try {
		return run();
	} catch (error) {
		if (/^MOTION_SPEC_INVALID/.test(error.message)) refuse("INVALID_ARGUMENT", error.message.replace(/^MOTION_SPEC_INVALID:\s*/, ""));
		throw error;
	}
}

/**
 * The same plain data as fresh literals. Objects that came through a structured clone (a worker message) make
 * the compiler's hot loops ~60% slower in V8 (their shapes); a copy built from literals runs at full speed and
 * keeps every value exactly (unlike a JSON round trip: -0, NaN, Infinity).
 */
const fresh = value => (Array.isArray(value) ? value.map(fresh) : value && typeof value === "object" && !ArrayBuffer.isView(value)
	? Object.fromEntries(Object.keys(value).map(k => [k, fresh(value[k])])) : value);

/**
 * runCompileJob({ model, scene, spec, probes?, checks?, lenient?, repair?, bake? }) -> { stored, qa, observations,
 * used, fixed, search, timeline, probes?, notes?, ms (+ repair: its wall ms), frameCount, label, repair?, take? }
 * bake: { position, yaw, prompt? } bakes the final result's take (prompt: given, else the final spec's label).
 */
export function runCompileJob({ model, scene, spec: asked, probes: sentProbes, checks, lenient, repair, bake }) {
	const sk = skeletonFor(model);
	const opts = { ...(checks ? { checks } : {}), ...(lenient ? { lenient: true } : {}) };
	// spec.probes and bare moved ids are lifted before fps is filled in, so the specId stays the spec's own
	const once = s => {
		const { spec, probes } = liftRequest(s, sentProbes);
		if (spec?.fps !== undefined && spec.fps !== TIMELINE_FPS) refuse("INVALID_ARGUMENT", `spec.fps must be ${TIMELINE_FPS}, the timeline rate.`);
		const sent = { fps: TIMELINE_FPS, ...spec };
		const r = asArgument(() => compileSpec(sent, { sk, scene }, { ...opts, probes }));
		return { ...r, stored: r.spec === sent ? spec : r.spec };
	};
	const t0 = performance.now(), fixed = repair ? repairSpec(asked, repair, once) : { spec: asked, result: once(asked) };
	// ms.repair: the whole repair's wall time, so a sweep that repairs every variant shows what it costs
	const r = fixed.result, label = fixed.spec?.label ?? null, ms = fixed.repair ? { ...r.ms, repair: Math.round(performance.now() - t0) } : r.ms;
	const take = bake ? bakeTake(sk, r.out, { position: bake.position, yaw: bake.yaw }, { spec: r.stored, prompt: ("prompt" in bake ? bake.prompt : label) ?? "" }) : undefined;
	return { stored: r.stored, qa: r.qa, observations: r.observations, used: r.used, fixed: r.fixed, search: r.search, timeline: r.timeline,
		...(r.probes ? { probes: r.probes } : {}), ...(r.notes ? { notes: r.notes } : {}), ms, frameCount: r.out.frameCount, label,
		...(fixed.repair ? { repair: fixed.repair } : {}), ...(take ? { take } : {}) };
}

/** The ArrayBuffers under a job answer's typed arrays (each once), to transfer instead of copy. */
function buffersOf(value, found = new Set()) {
	if (ArrayBuffer.isView(value)) found.add(value.buffer);
	else if (value && typeof value === "object") for (const v of Object.values(value)) buffersOf(v, found);
	return [...found];
}

/** The worker's answer to { id, job }: { message: { id, value }, transfer } or { message: { id, error: { message, code, name } }, transfer: [] }. */
export function answerOf({ id, job }) {
	try {
		const value = runCompileJob(fresh(job));
		return { message: { id, value }, transfer: buffersOf(value) };
	} catch (error) {
		return { message: { id, error: { message: String(error?.message ?? error), code: error?.code ?? null, name: error?.name ?? "Error" } }, transfer: [] };
	}
}
