// C7. Spec ids and the editor's spec store. specIdOf is final (W0); the store is a plain
// recently-used map until lane D2 owns it (LRU of SPEC_STORE_SIZE, base+patch errors, motion.qa).
// The store lives in the editor page's memory: a reload forgets it, and the agent then sends
// the whole spec again.

export const SPEC_STORE_SIZE = 64;

/** Canonical JSON: object keys sorted at every level (arrays keep their order). */
const canonical = v => (Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
	: v && typeof v === "object" ? `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
		: JSON.stringify(v) ?? "null");

/** "spec-" + the first 12 hex digits of the FNV-1a 64-bit hash of the spec's canonical JSON. */
export function specIdOf(spec) {
	let h = 0xcbf29ce484222325n;
	for (const byte of new TextEncoder().encode(canonical(spec))) h = BigInt.asUintN(64, (h ^ BigInt(byte)) * 0x100000001b3n);
	return `spec-${h.toString(16).padStart(16, "0").slice(0, 12)}`;
}

/**
 * The editor's store of compiled specs and their full output parts (C7).
 *   put(spec) -> specId                 remember a compiled spec (the most recent SPEC_STORE_SIZE)
 *   get(specId) -> spec | null          a copy of a remembered spec
 *   keepParts(specId, parts)            the overflow hook: { groups, timeline, probes } in full,
 *                                       before fitOutput cuts them (report.js)
 *   parts(specId) -> parts | null       what motion.report pages and delta compares against
 */
export function createSpecStore(max = SPEC_STORE_SIZE) {
	const entries = new Map();
	const touch = (id, entry) => { entries.delete(id); entries.set(id, entry); while (entries.size > max) entries.delete(entries.keys().next().value); return entry; };
	return {
		put(spec) { const id = specIdOf(spec); touch(id, { ...entries.get(id), spec: structuredClone(spec) }); return id; },
		get(id) { const e = entries.get(id); return e?.spec ? structuredClone(touch(id, e).spec) : null; },
		keepParts(id, parts) { touch(id, { ...entries.get(id), parts }); },
		parts(id) { return entries.get(id)?.parts ?? null; },
	};
}
