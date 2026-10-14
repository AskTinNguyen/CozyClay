// A JSON Schema fragment (describe.js) -> one short type line, for motion.describe
// { topic: "essentials" }: `{ f: int, set: object, step?: string[] }`. `?` marks an optional
// field, `=v` a default, `lo..hi` a range, `A | B` a choice, `[key]: T` a map, `a_l|r` a field
// that has a twin with the same type; a $ref to a shared shape keeps its name (vec3, key, ...).

const BARE = { integer: "int", number: "number", string: "string", boolean: "bool" };
const range = s => (s.minimum !== undefined && s.maximum !== undefined ? ` ${s.minimum}..${s.maximum}` : "");
/** A literal: strings in single quotes, so the JSON answer needs no escapes. */
const lit = v => (typeof v === "string" ? `'${v}'` : JSON.stringify(v));
const dflt = s => (s.default !== undefined ? `=${lit(s.default)}` : "");
const wrap = t => (/[ |]/.test(t) && !/^[{[].*[}\]]$/.test(t) ? `(${t})` : t);
/** The key name of a map from its description: "scene object or group id -> hinge or carry" -> "scene object or group id". */
const keyOf = s => s.description?.match(/^(?:[^:]*: )?(.+?) -> /)?.[1] ?? "name";

/** The fields of an object schema: `{ a: T, b?: T }`, a map `{ [key]: T }`, or both. */
function objectLine(s) {
	const req = new Set(s.required ?? []), props = Object.entries(s.properties ?? {});
	// a long table of optional numbers with defaults (checks.limits): the names only
	if (props.length > 8 && !req.size && props.every(([, v]) => v.type === "number" && v.default !== undefined)) return `{ [${props.map(([k]) => k).join("|")}]: number }`;
	const twinned = new Set(props.map(([, v]) => v.$ref?.match(/^#\/properties\/(.+)$/)?.[1]).filter(Boolean));
	const fields = props.filter(([, v]) => !v.$ref?.startsWith("#/properties/"))
		.map(([k, v]) => `${twinned.has(k) ? k.replace(/_l$/, "_l|r") : k}${req.has(k) ? "" : "?"}: ${briefType(v)}`);
	for (const [p, v] of Object.entries(s.patternProperties ?? {})) fields.push(`/${p}/: ${briefType(v)}`);
	const extra = s.additionalProperties && typeof s.additionalProperties === "object" ? s.additionalProperties : null;
	if (extra) fields.push(`[${s.propertyNames?.enum?.join("|") ?? keyOf(s)}]: ${briefType(extra)}`);
	return fields.length ? `{ ${fields.join(", ")} }` : `object${s.description ? ` (${s.description})` : ""}`;
}

/** schema -> type line. */
export function briefType(s) {
	if (!s || typeof s !== "object") return "any";
	const title = s.title ? `${s.title} ` : "";
	if (s.$ref) return s.$ref.split("/").pop() + dflt(s);
	if ("const" in s) return lit(s.const);
	if (s.enum) return s.enum.map(lit).join("|") + dflt(s);
	if (s.oneOf) {
		const shapes = s.oneOf.filter(o => !(Object.keys(o).length === 1 && o.required)), picks = s.oneOf.flatMap(o => (shapes.includes(o) ? [] : o.required));
		const own = s.type === "object" || s.properties ? objectLine(s) : "";
		const choice = shapes.length && shapes.every(o => o.pattern && !o.type) ? `string: ${shapes.map(o => o.description ?? o.pattern).join("; ")}` : shapes.map(briefType).join(" | ");
		return [title + own, choice, picks.length ? `(one of ${picks.join("|")})` : ""].filter(Boolean).join(" ") + (own ? "" : dflt(s));
	}
	if (s.type === "array") {
		if (!s.items && !s.prefixItems) return `array${s.description ? ` (${s.description})` : ""}`;
		if (s.prefixItems) return `[${s.prefixItems.map(briefType).join(", ")}]`;
		const n = s.minItems === s.maxItems && s.maxItems ? ` (${s.maxItems})` : s.maxItems ? ` (<= ${s.maxItems})` : "";
		return `${wrap(briefType(s.items))}[]${n}`;
	}
	if (s.type === "object" || s.properties) return title + objectLine(s);
	return (BARE[s.type] ?? "any") + range(s) + dflt(s);
}
