// JSON Patch (RFC 6902) on a motion spec: add, remove, replace and test, with "-" to append to
// an array in add. Used for motion.compile { base, patch } (C7) and by repair (C6). Errors are
// MOTION_SPEC_INVALID (INVALID_ARGUMENT to the agent) and name the op and what is there:
//   patch[1] (replace /keys/12/f): /keys/12 does not exist (keys has 9 entries)

const OPS = ["add", "remove", "replace", "test"];
const bad = msg => { throw new Error(`MOTION_SPEC_INVALID: ${msg}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** "/keys/0/set" -> ["keys", "0", "set"] (~1 is "/", ~0 is "~"). */
const tokens = path => path.split("/").slice(1).map(t => t.replaceAll("~1", "/").replaceAll("~0", "~"));
const pointer = parts => parts.map(t => `/${String(t).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");

function what(container, name) {
	if (Array.isArray(container)) return `${name} has ${container.length} entries`;
	const keys = Object.keys(container);
	return keys.length ? `${name} has ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? ", ..." : ""}` : `${name} is empty`;
}

/** The container holding the last token, walking every token before it. */
function parentOf(doc, parts, tag) {
	let node = doc;
	for (let i = 0; i < parts.length - 1; i++) {
		const t = parts[i], name = i ? parts[i - 1] : "the spec";
		if (node === null || typeof node !== "object" || !Object.hasOwn(node, Array.isArray(node) ? Number(t) : t) || (Array.isArray(node) && !/^\d+$/.test(t)))
			bad(`${tag}: ${pointer(parts.slice(0, i + 1))} does not exist${node && typeof node === "object" ? ` (${what(node, name)})` : ""}`);
		node = node[Array.isArray(node) ? Number(t) : t];
	}
	if (node === null || typeof node !== "object") bad(`${tag}: ${pointer(parts.slice(0, -1))} is not an object or array`);
	return node;
}

function applyOne(doc, op, i) {
	if (!op || typeof op !== "object" || !OPS.includes(op.op)) bad(`patch[${i}]: op must be ${OPS.join(", ")}, got ${JSON.stringify(op?.op)}`);
	const tag = `patch[${i}] (${op.op} ${op.path})`;
	if (typeof op.path !== "string" || (op.path !== "" && !op.path.startsWith("/"))) bad(`${tag}: path must be a JSON Pointer such as "/keys/0/f"`);
	if (op.op !== "remove" && !Object.hasOwn(op, "value")) bad(`${tag}: needs a value`);
	if (op.path === "") {
		if (op.op === "replace") return structuredClone(op.value);
		if (op.op === "test") { if (!same(doc, op.value)) bad(`${tag}: the spec differs from the test value`); return doc; }
		bad(`${tag}: ${op.op} needs a path below the spec`);
	}
	const parts = tokens(op.path), last = parts[parts.length - 1], node = parentOf(doc, parts, tag);
	const name = parts.length > 1 ? parts[parts.length - 2] : "the spec";
	if (Array.isArray(node)) {
		if (last === "-") { if (op.op !== "add") bad(`${tag}: "-" (append) works with add only`); node.push(structuredClone(op.value)); return doc; }
		const k = /^\d+$/.test(last) ? Number(last) : NaN;
		const max = op.op === "add" ? node.length : node.length - 1;
		if (!(k >= 0 && k <= max)) bad(`${tag}: ${op.path} does not exist (${what(node, name)})`);
		if (op.op === "add") node.splice(k, 0, structuredClone(op.value));
		else if (op.op === "remove") node.splice(k, 1);
		else if (op.op === "replace") node[k] = structuredClone(op.value);
		else if (!same(node[k], op.value)) bad(`${tag}: value is ${JSON.stringify(node[k])?.slice(0, 60)}, not ${JSON.stringify(op.value)?.slice(0, 60)}`);
		return doc;
	}
	if (op.op !== "add" && !Object.hasOwn(node, last)) bad(`${tag}: ${op.path} does not exist (${what(node, name)})`);
	if (op.op === "remove") delete node[last];
	else if (op.op === "test") { if (!same(node[last], op.value)) bad(`${tag}: value is ${JSON.stringify(node[last])?.slice(0, 60)}, not ${JSON.stringify(op.value)?.slice(0, 60)}`); }
	else node[last] = structuredClone(op.value);
	return doc;
}

/**
 * Applies ops in order to a copy of doc (doc is never changed) and returns the copy; the first
 * failing op throws MOTION_SPEC_INVALID and nothing is applied.
 * @param {object} doc
 * @param {{ op: "add" | "remove" | "replace" | "test", path: string, value?: any }[]} ops
 */
export function applyPatch(doc, ops) {
	if (!Array.isArray(ops)) bad("patch must be an array of { op, path, value }");
	return ops.reduce((d, op, i) => applyOne(d, op, i), structuredClone(doc));
}
