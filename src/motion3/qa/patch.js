// C6. Hint fixes -> JSON Patch (RFC 6902, json-patch.js) on the agent's own spec.
//
// A hint function may return fix (non-enumerable on the group, never in the output):
//   { channel: "hand_l", f: 106, delta: [dx, dy, dz] | n }   move a keyed channel by delta at f
//   { channel: "elbow_r", f: 120, value: [x, y, z] | n }      set a channel at f
//   { path: "/fix/retime", value: true }                      set a spec path
//   { path: "/anchors/cupHandle/p", delta: [dx, dy, dz] }     move a spec value by delta
// Each becomes g.patch = [{ op, path, value }] against opts.userSpec (the spec as the agent sent
// it, use[] not expanded): a user key that sets the channel within f +-2 -> replace
// /keys/<i>/set/<ch>; a standIdle stance moved sideways -> /use/<i>/args/at; otherwise add
// /keys/- with the frame's value moved. A path fix replaces the value, or adds it when only the
// last step is missing (or the top-level /fix object). g.patch is set only when the patch
// applies to userSpec and changes it.
import { applyPatch } from "../json-patch.js";

const NEAR = 2;
const round4 = v => (Array.isArray(v) ? v.map(round4) : typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v);
const tokens = path => path.split("/").slice(1).map(t => t.replaceAll("~1", "/").replaceAll("~0", "~"));
const pointer = parts => parts.map(t => `/${String(t).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
const isNum = x => typeof x === "number" && Number.isFinite(x);

/** The value at a JSON pointer, or undefined. */
function valueAt(doc, parts) {
	let node = doc;
	for (const t of parts) {
		if (node === null || typeof node !== "object" || !Object.hasOwn(node, t)) return undefined;
		node = node[t];
	}
	return node;
}

/** v moved by d (same shape: a number, or a vector of numbers), else undefined. */
function moved(v, d) {
	if (isNum(v) && isNum(d)) return v + d;
	if (Array.isArray(v) && Array.isArray(d) && v.length === d.length && v.every(isNum) && d.every(isNum)) return v.map((x, i) => x + d[i]);
	return undefined;
}

/** The user key nearest f (within NEAR frames) that sets channel ch, as its index; -1 if none. */
function userKey(userSpec, ch, f) {
	let best = -1;
	(userSpec.keys ?? []).forEach((k, i) => {
		if (!k?.set || !Object.hasOwn(k.set, ch) || !isNum(k.f) || Math.abs(k.f - f) > NEAR) return;
		if (best < 0 || Math.abs(k.f - f) < Math.abs(userSpec.keys[best].f - f)) best = i;
	});
	return best;
}

/** A standIdle stance moved by the root's sideways delta: /use/<i>/args/at. */
function standPatch(X, userSpec, fix, near) {
	const m = /^use\[(\d+)\] standIdle$/.exec(near?.src ?? ""), d = fix.delta;
	if (!m || fix.channel !== "root" || !Array.isArray(d) || Math.hypot(d[0], d[2]) < Math.abs(d[1])) return null;
	const i = Number(m[1]), u = userSpec.use?.[i], root = X.fr(near.f).c.root;
	if (u?.skill !== "standIdle") return null;
	const at = Array.isArray(u.args?.at) ? u.args.at : root && [root[0], root[2]];
	if (!at) return null;
	const value = round4(at.map((v, j) => v + (j === 0 ? d[0] : j === at.length - 1 ? d[2] : 0)));
	if (!u.args) return [{ op: "add", path: `/use/${i}/args`, value: { at: value } }];
	return [{ op: Object.hasOwn(u.args, "at") ? "replace" : "add", path: `/use/${i}/args/at`, value }];
}

function channelPatch(X, userSpec, fix) {
	const { channel: ch, f } = fix;
	if (typeof ch !== "string" || !isNum(f)) return null;
	const to = v => (fix.value !== undefined ? fix.value : moved(v, fix.delta));
	const i = userKey(userSpec, ch, f);
	if (i >= 0) {
		const value = to(userSpec.keys[i].set[ch]);
		return value === undefined ? null : [{ op: "replace", path: pointer(["keys", i, "set", ch]), value: round4(value) }];
	}
	if (!X?.fr) return null;
	const { prev, next } = X.bracket(ch, f);
	const near = prev && f - prev.f <= NEAR ? prev : next && next.f - f <= NEAR ? next : null;
	const stand = fix.delta !== undefined && standPatch(X, userSpec, fix, near);
	if (stand) return stand;
	const value = to(X.fr(f).c[ch]);
	return value === undefined ? null : [{ op: "add", path: "/keys/-", value: { f: Math.round(f), set: { [ch]: round4(value) } } }];
}

function pathPatch(userSpec, fix) {
	if (typeof fix.path !== "string" || !fix.path.startsWith("/")) return null;
	const parts = tokens(fix.path), now = valueAt(userSpec, parts);
	const value = fix.delta === undefined ? fix.value : now === undefined && fix.path.endsWith("/offset") ? fix.delta : moved(now, fix.delta);
	if (value === undefined) return null;
	if (now !== undefined) return [{ op: "replace", path: fix.path, value: round4(value) }];
	const parent = valueAt(userSpec, parts.slice(0, -1));
	if (parent !== undefined) return [{ op: "add", path: fix.path, value: round4(value) }];
	// a missing top-level object (spec.fix): add it with the one member
	if (parts.length === 2 && parts[0] === "fix") return [{ op: "add", path: pointer([parts[0]]), value: { [parts[1]]: round4(value) } }];
	return null;
}

/** The patch for one fix, or null when it does not apply mechanically or changes nothing. */
function patchOf(fix, X, userSpec) {
	const patch = fix.channel !== undefined ? channelPatch(X, userSpec, fix) : fix.path !== undefined ? pathPatch(userSpec, fix) : null;
	if (!patch) return null;
	try {
		return JSON.stringify(applyPatch(userSpec, patch)) === JSON.stringify(userSpec) ? null : patch;
	} catch {
		return null;
	}
}

/**
 * attachPatches(groups, { X, userSpec }) -> groups (the same array)
 * @param {object[]} groups  ranked QA groups, each maybe with a non-enumerable g.fix
 * @param {{ X: object, userSpec?: object }} ctx  X = the explain context (qa/explain.js: X.out,
 *   X.spec the expanded spec, X.keys(ch), X.bracket(ch, f)); userSpec undefined = no patches
 */
export function attachPatches(groups, { X, userSpec } = {}) {
	if (!userSpec || typeof userSpec !== "object") return groups;
	for (const g of groups) {
		if (!g.fix) continue;
		try {
			const patch = patchOf(g.fix, X, userSpec);
			if (patch) g.patch = patch;
		} catch {
			// a fix the context cannot place (no frame, no key table) gets no patch
		}
	}
	return groups;
}
