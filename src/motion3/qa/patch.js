// C6. Hint fixes -> JSON Patch (RFC 6902, json-patch.js) on the agent's own spec. Stub until
// lane D1: no group gets a patch.
//
// A hint function may return fix (non-enumerable on the group, never in the output):
//   { channel: "hand_l", f: 106, delta: [dx, dy, dz] | n }   move a keyed channel by delta at f
//   { channel: "elbow_r", f: 120, value: [x, y, z] | n }      set a channel at f
//   { path: "/fix/retime", value: true }                      set a spec path
//   { path: "/anchors/cupHandle/p", delta: [dx, dy, dz] }     move a spec value by delta
// Lane D1 turns each into g.patch = [{ op, path, value }] against opts.userSpec (the spec as the
// agent sent it, use[] not expanded): a user key within f +-2 -> replace /keys/<i>/set/<ch>,
// otherwise add /keys/-; a standIdle position -> /use/<i>/args/at; path fixes -> add/replace.
// g.patch is set only when the patch applies mechanically.

/**
 * attachPatches(groups, { X, userSpec }) -> groups (the same array)
 * @param {object[]} groups  ranked QA groups, each maybe with a non-enumerable g.fix
 * @param {{ X: object, userSpec?: object }} ctx  X = the explain context (qa/explain.js: X.out,
 *   X.spec the expanded spec, X.keys(ch), X.bracket(ch, f)); userSpec undefined = no patches
 */
export function attachPatches(groups /* , { X, userSpec } */) {
	return groups;
}
