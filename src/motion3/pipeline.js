// One compile as motion.compile runs it: frames "auto" resolves (skills/frames-auto.js), open
// parameters are searched (search.js), unnamed checks get their index as a name (on a copy,
// qa/check-names.js), skills expand (skills/), the spec is validated strictly (leniently for a
// saved take compiled again), the compiler bakes and auto-fixes the frames, QA measures them with
// a cause and a hint per issue group against the agent's own spec, the style quantities are
// measured (qa/style.js observeMotion), and the timeline and the requested probes read the result.
// liftRequest first takes what the agent obviously meant: spec.probes are request probes, and a
// bare goals[].moved id is object:<id>.
import { compileMotion } from "./compiler/compile.js";
import { validateSpec } from "./compiler/validate.js";
import { runMotionQa } from "./qa/index.js";
import { observeMotion } from "./qa/style.js";
import { nameChecks } from "./qa/check-names.js";
import { expandUse } from "./skills/index.js";
import { resolveFrames } from "./skills/frames-auto.js";
import { markFramesAuto } from "./spec-store.js";
import { findParams, searchParams } from "./search.js";
import { timelineOf } from "./timeline.js";
import { runProbes } from "./probes.js";
import { canonicalGoals } from "./compiler/validate-goals.js";

const ms = t => Math.round(performance.now() - t);

/** A spec after retime: frame-range checks follow the keys they were written against. */
function warpChecks(spec, map) {
	const c = structuredClone(spec.checks ?? {}), w = r => (Array.isArray(r) ? [Math.round(map(r[0])), Math.round(map(r[1]))] : r);
	for (const name of ["contacts", "orient", "below"]) for (const k of c[name] ?? []) k.when = w(k.when);
	for (const k of c.clearance ?? []) k.frames = w(k.frames);
	return { ...spec, checks: c };
}

/**
 * liftRequest(spec, probes) -> { spec, probes }. spec.probes (sent inside the spec, or added by
 * a patch) join the request's probes after them and leave the spec, so they are never stored and
 * never change its specId; bare goals[].moved ids get their object: prefix (validate-goals.js).
 * The spec comes back as the same object when nothing changes.
 */
export function liftRequest(spec, probes) {
	if (!spec || typeof spec !== "object" || Array.isArray(spec)) return { spec, probes };
	const goals = canonicalGoals(spec.goals);
	if (spec.probes === undefined && goals === spec.goals) return { spec, probes };
	const { probes: inSpec, ...rest } = spec;
	const lifted = inSpec === undefined ? probes : probes ? [...probes, ...(Array.isArray(inSpec) ? inSpec : [inSpec])] : inSpec;
	return { spec: goals === spec.goals ? rest : { ...rest, goals }, probes: lifted };
}

/**
 * spec -> { out, qa, observations, spec (frames and open values filled in), expanded, used,
 * fixed, search, timeline, probes?, ms }. opts.checks replaces every check (the spec's and its skills') for a
 * re-measure; opts.lenient ignores unknown fields (take-source.js); opts.probes are measured
 * (with spec.probes, liftRequest).
 */
export function compileSpec(sent, { sk, scene }, opts = {}) {
	const { spec, probes: asked } = liftRequest(sent, opts.probes);
	const t0 = performance.now(), ctx = { sk, scene, lenient: opts.lenient === true };
	const checks = opts.checks && nameChecks({ checks: opts.checks }).checks;
	const expand = s => {
		const { spec: exp, used } = expandUse(nameChecks(s), ctx);
		// plain JSON objects compile about twice as fast as structuredClone'd ones (V8 shapes)
		const full = JSON.parse(JSON.stringify(checks ? { ...exp, checks } : exp));
		validateSpec(full, ctx);
		return { full, used };
	};
	const framed = resolveFrames(spec, ctx), params = findParams(framed);
	let resolved = framed, search = null;
	if (params.length) ({ spec: resolved, search } = searchParams(framed, params, ctx, s => expand(s).full));
	// the store keeps the "auto" intent beside the resolved number (spec-store.js)
	if (spec?.frames === "auto") markFramesAuto(resolved);
	const t1 = performance.now();
	const { full: expanded, used } = expand(resolved);
	const out = compileMotion({ fps: 24, ...expanded }, ctx);
	const compileMs = ms(t1), t2 = performance.now();
	const measured = out.timeMap ? warpChecks(expanded, out.timeMap) : expanded;
	const qa = runMotionQa(sk, out, measured, { userSpec: resolved }), observations = observeMotion(sk, out, measured.checks);
	const timeline = timelineOf(out, { used, spec: expanded }), probes = asked && runProbes(out, asked, { spec: expanded, sk, scene });
	return { out, qa, observations, spec: resolved, expanded, used, fixed: out.fixed, search, timeline, ...(probes ? { probes } : {}), ms: { compile: compileMs, qa: ms(t2), total: ms(t0) } };
}
