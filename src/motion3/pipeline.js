// One compile as motion.compile runs it: open parameters are searched (search.js), skills
// expand (skills/), the spec is validated strictly, the compiler bakes and auto-fixes the
// frames, and QA measures them with a cause and a hint per issue group.
import { compileMotion } from "./compiler/compile.js";
import { validateSpec } from "./compiler/validate.js";
import { runMotionQa } from "./qa/index.js";
import { expandUse } from "./skills/index.js";
import { findParams, searchParams } from "./search.js";

const ms = t => Math.round(performance.now() - t);

/** A spec after retime: frame-range checks follow the keys they were written against. */
function warpChecks(spec, map) {
	const c = structuredClone(spec.checks ?? {}), w = r => (Array.isArray(r) ? [Math.round(map(r[0])), Math.round(map(r[1]))] : r);
	for (const name of ["contacts", "orient", "below"]) for (const k of c[name] ?? []) k.when = w(k.when);
	for (const k of c.clearance ?? []) k.frames = w(k.frames);
	return { ...spec, checks: c };
}

/**
 * spec -> { out, qa, spec (open values filled in), expanded, used, fixed, search, ms }.
 * opts.checks replaces every check (the spec's and its skills') for a re-measure.
 */
export function compileSpec(spec, { sk, scene }, opts = {}) {
	const t0 = performance.now(), ctx = { sk, scene };
	const expand = s => {
		const { spec: exp, used } = expandUse(s, ctx);
		// plain JSON objects compile about twice as fast as structuredClone'd ones (V8 shapes)
		const full = JSON.parse(JSON.stringify(opts.checks ? { ...exp, checks: opts.checks } : exp));
		validateSpec(full, ctx);
		return { full, used };
	};
	const params = findParams(spec);
	let resolved = spec, search = null;
	if (params.length) ({ spec: resolved, search } = searchParams(spec, params, ctx, s => expand(s).full));
	const t1 = performance.now();
	const { full: expanded, used } = expand(resolved);
	const out = compileMotion({ fps: 24, ...expanded }, ctx);
	const compileMs = ms(t1), t2 = performance.now();
	const qa = runMotionQa(sk, out, out.timeMap ? warpChecks(expanded, out.timeMap) : expanded);
	return { out, qa, spec: resolved, expanded, used, fixed: out.fixed, search, ms: { compile: compileMs, qa: ms(t2), total: ms(t0) } };
}
