# Motion API v3.1 contracts

This file is the contract for the motion API v3.1 lanes. The stub modules repeat each contract in their JSDoc. A lane fills its stub modules and does not change a contract. If a lane needs a contract change, it stops and reports the change and the reason. The integration lane (I) then lands a small "contract amendment" PR on `v3` first, and every lane rebases.

The wave-0 PR (W0) wires every hot file once. After W0 these files are frozen for the lanes:

- `src/commands/motion3.js`, `src/motion3/pipeline.js`, `src/motion3/qa/index.js`
- `src/motion3/refs.js`, `src/motion3/json-patch.js`, `src/motion3/report.js`, `src/motion3/qa/severity.js`
- `src/motion3/compiler/validate-common.js`, `tools/run-tests.mjs`, this file

## Ownership

| Lane | Owns |
|---|---|
| A | `schema/*`, `describe.js`, `compiler/validate.js`, `compiler/validate-parts.js`, `compiler/vocab.js`, `skills/{index,basic,car,smoke,book,info,frames-auto}.js` |
| B | `timeline.js`, `probes.js`, `bones.js` |
| C | `carried.js`, `object-pose.js`, `take.js`, `scene.js`, `object-tracks.js`, `compiler/compile.js`, `compiler/validate-objects.js`, `qa/object-checks.js`, `qa/hints-object.js`, `qa/checks.js` (`QA_LIMITS.grab` only), `src/object-travel.js` |
| D1 | `qa/explain.js`, `qa/hints-motion.js`, `qa/hints-contact.js`, `qa/patch.js`, `repair.js` |
| D2 | `spec-store.js`, `delta.js` |
| E | `src/studio-contact-sheet.js`, `beats.js`, `src/studio-motion-visual.js`, the visual branch of `src/studio-app-binding.js` |
| F | readOnly in `src/command-bus.js` and the `registry.list()` row, the revision fix, `qa/check-names.js` |
| G | `compiler/validate-goals.js`, `qa/goals.js`, `qa/hints-goal.js` |
| P | `bin/agent/studio-prompt.mjs`, `docs.js` (the words), supervisor default (off) |
| J2 | C14: `object-keys.js`, `key-edit.js`, `compiler/hold.js`, `compiler/quat.js`, `qa/key-checks.js`, `motion.keyObject` in `src/commands/motion3.js` |
| K4 | C15: switch entries and `level` (`compiler/validate-objects.js`, `take.js`, `src/object-travel.js` `trackShown`/`trackLevel`), `skills/smoke.js`, `skills/smoke-kit.js`, `src/kits/`, `object.createKit` in `src/commands/kits.js` |
| K6 | C16: follow entries (`follow.js`) and aim keys (`key-aim.js`, `qa/key-checks.js` `heldReadings`), the exhale kit (`src/kits/smoking.js`), the exhale look (`src/effects/`) |
| objkeys | C17: free entries and falls (`free-motion.js`; the free branches of `object-pose.js`, `compiler/compile.js` `objectTracks`, `compiler/validate-objects.js`, `take.js`, `qa/object-checks.js` `grabGap`/`supportOf`) |

Paths without a folder are under `src/motion3/`. Every lane test is already registered in `tools/run-tests.mjs` as a placeholder that prints `pending (lane X)`.

## C1. One schema source

`src/motion3/schema/fields.js` holds the field tables. The validator, the skills expander and `motion.describe` read them only from there. Channels, ranges and presets come from `compiler/vocab.js`, `FIX_KEYS` from `fix/index.js`, `QA_LIMITS` from `qa/checks.js` and the skill names (`SKILL_NAMES`) from `skills/index.js`. Do not copy them.

- `SPEC_FIELDS` (now with `goals`), `KEY_FIELDS`, `USE_FIELDS`, `ANCHOR_FIELDS`, `PROP_FIELDS`, `FIT_FIELDS`, `OBJECT_FIELDS`, `WALK_FIELDS`, `CHECK_FIELDS`, `CHECK_ENTRY_FIELDS`, `GOAL_FIELDS`, `PROBE_FIELDS`, `REF_KINDS`, `DESCRIBE_TOPICS`.
- Every new validation error is `Error("MOTION_SPEC_INVALID: <exact message>")`. `motion3.js` turns it into `INVALID_ARGUMENT`.
- `validateSpec(spec, { sk, scene, lenient })`. With `lenient: true` an unknown field is ignored. Unknown fields go through `opts.unknown` in the validator parts. `compileTakeSource` (a saved take compiled again) is lenient. `motion.compile` is strict.

## C2. Point references (`refs.js`)

```text
ref := joint:<Bone> | bone:<Bone> | prop:<prop>.<point> | anchor:<name> | landmark:mouth | object:<id>[.center|.top|.base]
refPoint(out, f, ref)            -> [x, y, z] | null   f is absolute; null outside out.f0 .. out.f0 + frames - 1
refDistance(out, f, a, b)        -> metres | null      a bare object:<id> means "to its surface" (sdBox, 0 inside)
checkRef(spec, err, { sk, scene }, at, ref, kinds = REF_KINDS) -> boolean
```

- `bone:` is the same point as `joint:`. Bone names go through `bones.js` `resolveBone`.
- `object:<id>` takes a body or a group. Its points are the centre, the top-face centre and the bottom-face centre of the AABB of its part boxes' corners (`objectBoxesAt`). The default is the centre.
- Two bare objects measure the centre of `a` to the surface of `b`.
- `checkRef` messages start with `` `${at} "${ref}"` ``, for example `probes[0].distance[0] "joint:LeftHnad": unknown bone; did you mean "LeftHand"?`.
- `spec.checks.*` keep their older grammar (joint, prop, anchor; `validate-common.js` `refOk`). Goals and probes use the full grammar.

## C3. Objects: hinge, carry, grab/release (revised by user decisions 7.1 and 7.2)

```jsonc
spec.objects[id] =
  { "pivot": [x,y,z], "axis": [x,y,z], "channel": "door" }            // hinge: a body or a group
| { "prop": "cupHandleGrip", "grab": 104, "release": 160,             // carry: a body or a group (Empty) id
    "at": [d,l,n], "along": [d,l,n], "visible": "cup_vis",
    "fall": { "at": 170 } }                                           // a carry falls before grab or from release on (C17)
| { "keys": [...], "fall": { "at": 40, "onto": "tray" } }             // free: moves on its own (C17)
```

**The group (Empty) is the unit.**

- `object:<group>` refs, carry and hinge all take a group id.
- A carried or hinged group gets **one track, on the group root** (`take.objects[groupId] = { pos, quat, vis? }`). The parts follow through the parent carry that already exists in `src/object-travel.js` (`ancestorsOf`, `ownTravelMatrix`). The Empty marker moves with them. There are no per-part tracks.
- `motionScene` lists `ancestors` (parent ids, nearest first) on every body entry, so a group is known by its parts (`object-pose.js` `partsOf`). QA and refs move the part boxes by the group's pose.
- While a group is in hand (grab to release), its track is in world space. The carry from the group's own parent (for example the table) is cut for that span, like `attach`, so nothing is carried twice.
- A group hinge turns the whole group about the group root.

**Timing.**

- `f < grab`: the scene pose. `grab <= f <= release`: the prop's hand. `f > release`: frozen at the release pose.
- No `grab`: in hand from frame 0. No `release`: in hand to the end. This is the PR #14 behaviour.
- `grab` without `at`/`along`: the object keeps the transform it had against the palm axes at the grab frame, so it does not jump.
- `at`/`along`: a fixed palm offset. Bodies, and since C15 a group's root (a kit's grip).

**Carried objects are obstacles (7.1).**

- A carried object (every part box of a group) is an obstacle at every frame, at its pose that frame. `objectTracks` does not mark it `ignore`; it moves like a hinged obstacle.
- Body against carried object: the existing capsule-against-box check. The holding hand's fingers, hand and forearm are excused.
- Carried object against other scene objects: new, kind `COLLIDE`, subject `"<object> x <other>"`, the same `QA_LIMITS` depth limits as the body.
- Contact with the support the object stood on at grab (the object right below it at the grab frame) is allowed for +-3 frames around the grab frame and around the release frame. Other exceptions use `checks.allow`.
- The hint moves the hand channel, like `moveHint`, with a D1 `fix`.

**QA and functions.**

- GRAB issues: kind `"GRAB"`, subject `"<id>: hand 12.0 cm from it at grab"`, `worstFrame` = grab, `limit` = `checks.limits.grab` (default 0.03 m). The distance runs from the prop origin to the part boxes' surface. A `grab` of 0 is in hand from the first frame, as with no `grab`: nothing is picked up, so it has no GRAB issue (lane N1; session d5c110a7 had "hand 63.6 cm from it at grab" for a bat kit left on the floor).
- `partsOf(scene, id) -> string[]`: `[id]` for a body (plus bodies parented under it), every body under a group, `[]` for an unknown id.
- `inHandAt(o, f) -> boolean`: `o` is the `spec.objects` entry, `f` absolute.
- `objectBoxesAt(out, id, f) -> [{ id: partId, pos, R, half }] | null`: the part boxes moved by the group root's pose at absolute frame f; null outside the compiled window or for an unknown id. W0 answers the scene pose, hinges and the always-carried body; lane C adds grab/release and the group-root pose.
- `objectOk(err, scene, at, id, { groups })`: a group id passes only with `{ groups: true }`. Elsewhere the message lists the parts: `checks.clearance[0] names "empty-2", a group (Empty) with no body of its own; its parts are cylinder, cube-6, cube-7, cube-8. Name one part`.

## C4. Timeline (`timeline.js` `timelineOf(out, { used, spec }) -> entries`)

`output.timeline`, at most 12 entries, ordered by `f[0]`:

```jsonc
{ "beat": "walkTo",          // the skill name | "walk" (generators) | "keys" (spans no skill covers)
  "src": "use[1]",           // "use[i]" | "generators[i]" | "keys"
  "f": [12, 86],             // inclusive, absolute frames
  "end": { "root": [0.1, 0.98, 0.27], "yaw": 2.1, "hand_l": [0.27, 0.81, 0.85], "hand_r": [-0.2, 0.87, 0.3],
           "on_l": "anchor:cupHandle", "on_r": null },   // metres 3 decimals, degrees 1; on_* = w_<a>_k > 0.5 or the held "object:<id>"
  "planted": { "l": [[12, 31], [52, 86]], "r": [[12, 40]] },   // heel or ball < QA_LIMITS.plantH over the ground (floor or object top) and still (on the ball, heel up, counts), >= 3 frames, <= 4 per foot
  "events": [{ "f": 104, "object": "empty-2", "event": "grab" }] }   // grab | release | show | hide
```

`output.skills` stays for compatibility.

## C5. Probes (`probes.js` `runProbes(out, probes, { spec, sk, scene }) -> { [name]: result }`)

At most 16 probes per request. The answer comes from this compile, whether or not it installs.

```jsonc
"probes": [
  { "name": "handToCup", "distance": ["joint:LeftHand", "object:empty-2"], "frames": [80, 130] },
  { "name": "cupTop", "position": "object:empty-2.top", "frames": [100, 170], "every": 10 } ]
-> "probes": {
  "handToCup": { "min": 0.012, "minAt": 106, "max": 0.41, "maxAt": 80, "mean": 0.2, "first": 0.41, "last": 0.02 },
  "cupTop": { "at": [{ "f": 100, "p": [0.2, 0.85, 0.85] }] } }        // at most 16 rows
```

## C6. Severity, hint fix, patch, repair

`qa/severity.js` (W0, final):

```js
LOW_IS_BAD = new Set(["ORIENT", "BELOW", "CLEARANCE"])
excessOf(g)   = max(0, LOW_IS_BAD ? limit - worst : worst - limit)
weightOf(g)   = count * (1 + min(3, excess / max(|limit|, 0.01)))     // search.js cost = the sum, unrounded
severityOf(g) = round2(weightOf(g))
rankGroups(groups)  // adds excess (4 decimals) and severity; GOAL first, then severity desc, then count desc
groupKey(g)   = `${kind} ${subject with every number as "#"}`         // a bracketed index ("contacts[1]") stays
```

```jsonc
qa.groups[i] = { "kind": "COLLIDE", "subject": "thigh_r x cube", "count": 6, "first": 60, "last": 65,
  "worst": 0.017, "worstFrame": 62, "limit": 0.005, "excess": 0.012, "severity": 13.2,
  "cause": "...", "hint": "...",
  "patch": [{ "op": "replace", "path": "/keys/0/set/root", "value": [0.48, 0.92, -0.052] }] }   // only when it applies mechanically
```

- Every hint function (`hints-*.js`) returns `{ cause, hint, fix? }`. `explain.js` puts `fix` on the group as a non-enumerable property, so it never reaches the output. The `moveHint` signature is frozen.
- `fix = { channel, f, delta } | { channel, f, value } | { path: "/fix/retime", value: true } | { path: "/anchors/cupHandle/p", delta }`.
- `qa/patch.js` `attachPatches(groups, { X, userSpec }) -> groups`: `X` is the explain context, `userSpec` the spec as the agent sent it (patches address it).
- `repair.js` `repairSpec(spec, { rounds }, compile) -> { spec, result, repair }` with `repair = { rounds, compiles, applied: [{ kind, subject, patch, severity: [before, after] }], rejected }`. Each round tries the top 3 groups that carry a patch, keeps one when the summed severity drops, and stops when a round keeps nothing. Deterministic, at most 20 s. With `install: true` (or `"ifClean"` and a clean result, C12) the improved spec is installed and `output.specId` names it.

## C7. specId, base + patch, delta, report, output budget

```jsonc
// request: exactly one of spec or base (+ patch)
{ "characterId": "char-a", "base": "spec-91c2a07d3e15", "patch": [{ "op": "replace", "path": "/keys/4/f", "value": 112 }], "install": false }
// answer
"specId": "spec-1f0e4b2a9c77",
"delta": { "base": "spec-91c2a07d3e15", "resolved": 2, "new": 0, "worse": 0, "better": 1,
           "keys": { "resolved": ["COLLIDE thigh_r x cube"], "new": [], "worse": [] } },   // at most 6 each; groupKey, severity change >= 5 %
"more": { "specId": "...", "groups": 9, "timeline": 0, "probes": 0 }                         // only when something was cut
// motion.report { specId, part: "groups" | "timeline" | "probes", from } -> { specId, part, from, items, next }
```

- `specIdOf(spec)` (`spec-store.js`, W0, final): `"spec-"` + the first 12 hex digits of the FNV-1a 64-bit hash of the JSON with keys sorted at every level.
- The specId names the spec the take stores: what the agent sent, or the filled-in spec when a search or `frames: "auto"` changed it. `motion.qa` answers the specId of the installed take's spec.
- `createSpecStore(max = 64) -> { put(spec) -> specId, get(specId) -> spec | null, keepParts(specId, { groups, timeline, probes }), parts(specId) -> parts | null }`. The store lives in the editor page's memory (a reload forgets it). W0 keeps the most recent 64; D2 owns it.
- `frames: "auto"` intent (G3). The spec a specId names, and the take an install keeps, hold the resolved number (`normalizeTakeSource` requires a number). The intent lives beside it in the store: `compileSpec` marks a spec it resolved from `"auto"` (`markFramesAuto`), `put` remembers the mark on the entry, and the mark sticks to that specId (a later unmarked `put` of the same spec, such as `motion.qa` re-measuring the take, keeps it). `get` then answers `frames: "auto"`, so base + patch re-resolves the length: keys appended past the old end extend the take instead of failing. A patch that sets `/frames` to a number replaces the intent. A reloaded take has no store entry and stays numeric.
- A frame past the end names the length that fits: `keys[5].f = 208 is outside 0..195 (spec.frames 196); set frames >= 297 or frames: "auto"`. The number covers every frame the spec names (keys, walk starts, check windows, goals); `or frames: "auto"` is added only when the keys and walks reach that far, because `"auto"` does not count check windows or goals.
- A skill whose tail only lets go or settles ends at the last frame when the take ends in that tail (lane M2): reachGrip past its hold keeps the grip to the end, walkTo past its last step keeps the feet together. The answer says so in `output.observations.cut` (`["reachGrip: release cut at f83 (hold to the end)"]`) and `output.skills[i].cut`. A take that ends before the hold (or the last step) is still refused: `use[0] reachGrip needs 64 frames from f0 (to f64), past the last frame f59; set frames >= 65 or frames: "auto"` (reach 4, hold 58 ends at f62). Under `frames: "auto"` nothing is cut.
- `json-patch.js` `applyPatch(doc, ops) -> copy`: add, remove, replace, test, `-` appends in add, `~0`/`~1` escapes. Errors: `patch[1] (replace /keys/12/f): /keys/12 does not exist (keys has 9 entries)`.
- `delta.js` `deltaOf(baseGroups, groups, baseId) -> delta`.
- Errors: `base "spec-…" is not known (the editor keeps the last 64 compiled specs this session); send spec`.
- `patch` may be empty. `{ base }` alone or `{ base, patch: [] }` compiles the base again, for example to measure new probes.
- `report.js`: `MOTION_OUTPUT_BUDGET = 6000` bytes (8 KiB receipt minus about 1.5 KB of head and readback). `fitOutput(full, budget) -> output` keeps, in order: (1) frames, fps, installed, specId, qa.ok/total/goals, observations (C13), delta, repair; (2) the first 4 groups in full; (3) probes; (4) timeline (planted spans go first); (5) the other groups as one-liners `{ kind, subject, count, severity, first, last }`; (6) fixed, search, skills, ms. Room left turns one-liners back into full groups from the top. `more.<part>` counts the items missing or shortened. Every compile and `motion.qa` keeps its full parts in the store (`keepParts`), and `motion.report` pages them with `reportPage(parts, specId, part, from)`.

## C8. Goals (spec top level; `qa/goals.js` `goalChecks(out, goals) -> { issues, results }`)

```jsonc
"goals": [
  { "name": "cup lifted", "moved": "object:empty-2", "by": 0.1, "at": [130, 140] },
  { "name": "cup at mouth", "near": ["object:empty-2.top", "landmark:mouth"], "tol": 0.06, "at": [150, 170] },
  { "name": "hand over table", "above": ["joint:LeftHand", "object:cube.top"], "by": 0.05, "at": 120, "mode": "any" } ]
-> "qa": { "ok": false,
  "goals": [{ "name": "cup at mouth", "kind": "near", "ok": false, "value": 0.31, "at": 150, "need": 0.06 }],
  "groups": [{ "kind": "GOAL", "subject": "cup at mouth: 0.31 m at f150 (needs <= 0.06)", "count": 1,
               "worst": 0.25, "limit": 0, "worstFrame": 150, "first": 150, "last": 170 }] }
```

- Exactly one predicate: `near` (distance <= `tol`, default 0.05), `above` (a.y - b.y >= `by`, default 0), `moved` (the object base moved at least `by`, default 0.05, from the scene pose), `still` (the point stays within `tol`, default 0.01, of where `moved` measures from), `speed` (the point's speed reaches `by` m/s; `by` is required and > 0).
- `moved` accepts a bare object id: `"empty-2"` means `"object:empty-2"`. Every other ref needs its prefix.
- `moved` on any other point ref (`prop:<p>.<point>`, `joint:<Bone>`, `landmark:mouth`, `anchor:<a>`) measures how far the point gets from where it is at `at[0]`: one value, its farthest frame of `at`, so `at` must be `[f0, f1]` with f0 < f1. The subject reads `bat swings: moved 0.8 m from f31 at f39 (needs >= 1.2)`.
- `still` measures from the same home as `moved`: an object ref from its scene pose, any other point ref from where it is at the window's first frame, so a point's `still` needs `at: [f0, f1]` with f0 < f1. The subject reads `cup still: 0.034 m from its scene pose at f80 (needs <= 0.01)` or `hand still: 0.02 m from f10 at f30 (needs <= 0.005)`. `moved`, `still` and `speed` take a bare object id as `object:<id>`.
- `speed` is the central difference of the point over f-1..f+1 (one-sided at the compiled window's edges), in m/s. The subject reads `kick fast: 1.9 m/s at f96, the best of f92-f100 (needs >= 3)`.
- `mode` is `"all"` or `"any"`. The default is `"all"`, except `speed`, whose default is `"any"` (a speed is reached).
- `after` / `before` (amended in the intent round, lane pred): another goal's name (or `goals[<i>]` for an unnamed one). The goal's `at` is cut to the frames after (before) the first frame the named goal holds, judged by the named goal's own predicate on its own window, so cause and effect keep their order wherever the event lands: `{ "name": "can falls", "moved": "object:can", "by": 0.05, "at": [0, 200], "after": "kick", "mode": "any" }`. When the named goal never holds, or the cut leaves no frame, the goal fails with `value: null`, `at: null` and one GOAL issue (value 0.01, at `at[0]`): `can falls: waits for "kick" (after), which never holds`, `can still: no frames left before "kick" (it holds first at f40; at is f60-f80)`. A windowed trial compile that does not reach the named goal answers nothing for the waiting goal. Goals that wait on each other are refused: `goals wait on each other through after/before: "a" -> "b" -> "a"; one of them must not wait`.
- A GOAL issue's value is the shortfall and its limit is 0. A failed goal makes `qa.ok` false. `qa.goals` is there when `spec.goals` is.
- Issue frames index `out.frames`. `goals[].at` is absolute.
- Validation: `compiler/validate-goals.js` `validateGoals(spec, err, opts)`.
- `tol` on `above`, `moved` or `speed` is refused, not mapped: a tolerance could mean `by: -tol` (slack) or `by: tol` (clearance). The message names the replacement with the number sent: `goals[0].tol applies to near and still; above takes by (a.y - b.y >= by, default 0): use by: 0.02 for a at least 0.02 m above b, or by: -0.02 to let a sit up to 0.02 m below b, not tol`. `by` on `near` or `still` is refused the other way: `goals[0].by applies to above, moved and speed; still takes tol`.
- The GOAL hint for `still` moves the point back toward its home (an object nothing holds: no fix, the hint names its hinge or keys); `speed` and a waiting goal get a hint without a fix.

## C9. describe (`describe.js` `describe(topic, name?)`)

- `motion.describe { topic, name? }` answers `{ topic, schema (JSON Schema 2020-12 fragment), example (passes validation), notes[] }`.
- `topic: "skills"` answers `{ topic, skills: [{ name, args, needs, frames, adds }] }`. With `name` it answers that skill's full args schema and a `use` example.
- `topic: "essentials"` answers `{ topic, types, skills, notes }` in one call: `types` has one type line per topic and per shared shape (vec3, key, ref, ...), built from the same schemas (`schema/brief.js`); `skills` lists each skill with typed args, needs, frames and adds. The full topics stay one call each for meanings, examples and notes.
- `topic: "examples"` answers `{ topic, examples: [{ name, scene, spec }], notes }`: four whole specs (`schema/spec-examples.js`), a reachGrip carry, a squat smoke dressed by `smokeCigarette` `args.kit`, an aim-keyed held sword, a hinged door pushed by its knob. Each compiles at QA 0 on the scene its `scene` line names, on both rigs (`test/bus/verify-motion3-examples.mjs`). It is not part of essentials.
- Every answer is at most 6,000 bytes, except essentials: at most `DESCRIBE_BUDGET` (`describe.js`, 8,192 − 768 = 7,424 bytes; a describe receipt's head is about 570 B). It is a readOnly job.

## C10. readOnly

- `motion.qa`, `motion.sample`, `motion.describe` and `motion.report` declare `readOnly: true` (data, W0).
- Lane F shows it in the `registry.list()` rows and makes the bus skip expectedRevision and TARGET_BUSY for these actions. The host check stays.
- `motion.describe` and `motion.report` are kind `"job"`, not transient: the bus `receipt()` carries no `output` for transient actions.

## C11. verify_result

```jsonc
verify_result { "targets": ["char-a"], "checks": ["motion"], "visual": "contact_sheet", "frames": "beats" }
-> visualRefs[0] = { "imageId": "…", "frames": [86, 104, 120, 150, 160, 169], "layout": "3x2 row-major",
  "picks": [{ "f": 104, "why": "grab empty-2" }, { "f": 150, "why": "worst GOAL cup at mouth" }] }
verify_result { "targets": ["char-a"], "checks": ["motion"], "visual": "trace" }
-> visualRefs[0] = { "imageId": "…", "kind": "trace", "range": [0, 279],
  "series": [{ "name": "hand_l.y", "color": "#d1495b", "unit": "m", "min": 0.8, "minAt": 0, "max": 1.52, "maxAt": 160 }] }
```

- `frames` defaults to `"even"`, as today.
- Beats pick, in order: grab and release frames, beat starts, the worstFrame of the top 2 groups, then even fill. Frames within +-3 of a pick are dropped. At most 6, ascending.
- `frames` may also be up to 8 timeline frames, `[f, ...]`. They are shown ascending; a frame outside the range is refused. 7-8 frames tile 4x2.

Views of its own (observation round, lane H2). The shot camera is the user's; these cameras are the agent's.

```jsonc
verify_result { "targets": ["char-a"], "checks": ["motion"], "visual": "contact_sheet", "frames": [10, 30, 34, 50, 70, 90],
  "views": ["front", "side"], "focus": ["object:empty-2", "joint:LeftHand"], "trail": "object:empty-2" }
-> visualRefs[0] = { "imageId": "…", "frames": [10, 30, 34, 50, 70, 90], "layout": "6x2 row-major, a row per view",
  "views": [{ "name": "front", "eye": [0.33, 1.25, 2.06], "target": [0.33, 1.03, 0.81] }, { "name": "side", … }],
  "focus": ["object:empty-2", "joint:LeftHand"], "trails": [{ "ref": "object:empty-2", "color": "#d1495b" }] }
```

- `views`: 1-2 of `front`, `side`, `three-quarter`, `top` (`src/motion3/views.js`). The character's facing comes from its hip line over the frames. `side` and `three-quarter` look from the side the focus is on (the right when centred). `top` looks straight down, with the character's forward up the image.
- Each view stays at one place for every frame. It frames the `focus` refs (default: every joint of the character) and the trail points over those frames. A deep subject moves the camera back until its far side is at most 1.8x as far as its near side, and the lens narrows (35 to 12 degrees) to fill the tile.
- `focus` and `trail` take a ref or up to 3 (the C2 grammar). A bare `object:<id>` frames the corners of its part boxes. A trail is one dot per frame over the range, so dot spacing shows speed. Dots up to the tile's frame are solid, later ones faint, and the tile's own frame is ringed.
- The render poses the frame as the export does, and renders it offscreen from a clone of the shot camera moved to the view. The shot camera and the view are not changed.
- Tiles are square. One view uses 3x2 (4x2 for 7-8 frames, a strip for 1-3 frames); several views use a column per frame and a row per view. A sheet is at most 1600x900.
- Refusals: `views`, `focus` or `trail` on a visual other than `contact_sheet`, and `focus` or `trail` without `views`, are INVALID_ARGUMENT. An unknown ref is refused with the C2 message. `views` without a compiled take is TARGET_NOT_READY.

## C12. install: "ifClean" (waste-removal round, lane G1)

`motion.compile { install }` takes `true` (the default), `false` or `"ifClean"`. `true` and `false` are unchanged. `"never"` equals `false`.

- `"ifClean"` installs the take only when the final result is clean: `qa.ok`, which includes the goals, measured after `repair` when `repair` is sent. Otherwise it is `install: false`. The agent no longer compiles a second time only to install.
- It works with `spec` and with `base` + `patch`. With `repair`, the repaired spec is what is installed, and `output.specId` names it (the spec the take stores).
- `output.installed` is `true` when the character's take is now this result, else `false`. The receipt `affectedIds` names the character, and an undo/history entry exists, only when a take was installed.
- The take already installed: when the installed take is exactly the take this compile would install (the same spec by specId, placement, bones and object tracks), `"ifClean"` changes nothing. There is no replace, no `affectedIds` and no history entry, so IK edits on the take stay. `output.installed` is `true`, and the receipt summary says `already installed, unchanged`. It is not an error. `install: true` still replaces the take as before.

## C13. QA verdict and observations (lane H1)

QA errors are kept for what is broken whatever the motion is for. Quantities that depend on the motion's intent are measured, not judged: a bat swing moves the wrists at 8-10 m/s, a lunge leaves the centre of mass outside the feet.

| Class | Kinds | Why |
|---|---|---|
| hard (`qa.groups`, `qa.total`, `qa.ok`, search and repair cost) | COLLIDE (body, carried object), OBJECT (hinged object), GROUND, REACH, SLIDE, FLIP, LENGTH, FACE, BODY, SELF, KNEE (bends backward, or folds past its stop), ELBOW (folded past its stop), GRAB, POP, FLOAT, the spec's checks (CONTACT, ORIENT, BELOW, CLEARANCE, APPEAR), GOAL | penetration, a pose that is not the one asked for, a planted foot that skates, a pole that flips, a stretched bone, a shin inside the thigh, a forearm inside the upper arm, a one-frame artifact, a body held up by nothing, a failed declared check or goal |
| style (`output.observations`) | SPEED, ACC (sustained acceleration), KNEE (bend past `knee`), BALANCE | fast, hard, deep or off-balance is a choice: a swing, a throw, a deep squat, a lunge |

- **POP** (hard): a spike, not a large value. The acceleration of a joint at frame f (second difference, m/frame^2) is above `accLimb` (`accCore` for Hips and Head) and more than 2x the level around it, the larger of: **far**, the largest acceleration of the frames 2 and 3 away (f-3, f-2, f+2, f+3; a one-frame event shows in up to three neighbouring frames, a step key in f and f+1, a one-frame glitch in f-1..f+1, so the frames next to f are not read here); and **burst**, what the frames next to f carry in f's own direction (the projection of their acceleration on f's), less what the other one turns back. At 24 fps a hard move gathers its acceleration into 2 or 3 frames that all push the same way (a swing's launch, the hips turning round): a burst, never a pop however hard. A glitch pushes back on both sides (+1, -2, +1), a step on one (+1, -1), a jitter turns back on one side as the other follows (+, -, -, +): those carry none and still pop. Subject `"<joint> accel 8.66 cm/f^2 in one frame"`. `qa/style.js` `isPop({ a, A }, f, floor)` (a: magnitudes, A: the vectors).
- **FLIP** (hard): a knee's or elbow's bend plane (the normal of upper x lower bone) turns more than `flip` degrees (default 60) a frame. The plane is read only on frames the limb is bent 20 deg or more from straight and from folded flat; near either end a few millimetres set it, and the hand or foot moving a few centimetres turns it any way (session df6acdcc: the right elbow folded to 171 deg as the wrist passed the shoulder, and its plane turned 71 deg in a frame while the elbow moved 3 cm). Across the frames between, the turn is shared out per frame, so a pole that flips while the limb is straight still shows: subject `"RightForeArm bend plane jumps 120deg over 2 frames"` (value: degrees a frame). `flip` is the bend plane, not the forearm's twist: the wrist and forearm turn within `compiler/arm-orient.js` `WRIST_LIMITS` (twist -85..85, flex -70..70, dev -35..20 deg), which the solver keeps to and QA does not judge. The FLIP hint names an elbow on its stop (below): the target passing near the shoulder, not the pole.
- **The elbow's stop** (lane P3, `compiler/limbs.js`). Elbow flexion is the angle between the upper arm and the forearm on the joints (Arm->ForeArm against ForeArm->Hand, 0 straight), as QA reads it. Active flexion ends near 145 deg (clinical norms 140-150: AMA 140, Kendall 145, AAOS 150) and the passive fold a few degrees on. Every arm solve keeps to it (the plain IK, the held-object hand and the second hand through `twoBone`, the swivel landscape, an FK `abend_<side>`): the arm follows its wrist target to `ELBOW_FOLD` = 145 deg, then the wrist's distance from the shoulder eases at a constant rate onto the distance at `ELBOW_STOP` = 150 deg (C1: no kink where it engages) and sits there once the target is twice the ease's width inside (`armReach`). A target nearer the shoulder is reached along the ray from a point on the stop's sphere straight behind the shoulder (the chest's -Z), not the nearest point, which whips round the shoulder as a target passes near it (`foldPoint`). The rest is a residual, reported as a target out of reach is: `diag.arm_miss_<side>` (REACH `arm_miss_<side>`, with `diag.arm_fold_<side>` the flexion the target asked), or `diag.hold_<side>.miss` and `.fold` for a held object (REACH `"<id>: 10.9 cm off its keys"`). A fit's measuring passes leave the elbow unstopped (`foldFree`), so a fit that converges within 145 deg solves as before. Takes whose elbows stay within 145 deg bake bit for bit as before.
- **ELBOW** (hard): an elbow folded past `ELBOW_STOP` (+0.01 deg): the forearm is inside the upper arm. Subject `"Right elbow folds 171deg"`, `limit` 150; not a `checks.limits` key (no motion asks for it). The solver never draws one; QA reports one any other path makes. Hint: move the hand out from the shoulder by the distance that folds the elbow 145 deg.
- **REACH with a fold**: `hand_<side>: move [x, y, z] m at f34 (the hand target is 0.099 m inside the forearm's reach: the elbow would fold 171deg; it bends to 145deg and stops at 150deg), or bring root [x, 0, z] m back from it`; a CONTACT check on that hand says `inside the forearm's reach by ... m` and moves the root back; a GOAL never reads a fold as an arm at full reach.
- **The knee's stop** (lane P4, `compiler/limbs.js`). Knee flexion is the angle between the thigh and the shin on the joints (UpLeg->Leg against Leg->Foot, 0 straight), as QA reads it. Active flexion ends near 135-140 deg (AAOS 135); past it the knee folds only passively, under the body's weight: a deep squat with the heels down reaches 150-160 deg as the thigh rests on the calf, and passive flexion stops near 160 (the heel at the buttock). The leg IK (`twoBone(..., "knee")`, pose.js) follows its ankle target to `KNEE_FOLD` = 150 deg, then the ankle's distance from the hip eases at a constant rate onto the distance at `KNEE_STOP` = 160 deg (the elbow's `armReach` with the knee's angles: C1, no kink where it engages) and sits there once the target is twice the ease's width inside. A target nearer the hip is reached along the ray from a point on the stop's sphere straight above the hip (the pelvis's +Y), where no foot goes, so a squat's ankle target under the hip goes on down from it (`foldPoint`). The rest is a residual: `diag.leg_miss_<side>` (REACH `leg_miss_<side>`, with `diag.leg_fold_<side>` the flexion the target asked), and in a squat the sole goes into the floor by about as much (GROUND). The squats the sessions keyed bend 125-138 deg (fixtures/ground-sessions.mjs, the smokeCigarette squat on both rigs), so every take whose knees stay within 150 deg bakes bit for bit as before. `fix.reach` (lowerHips) is for a target past the leg's reach and leaves these alone.
- **KNEE** (hard, folds): a knee folded past `KNEE_STOP` (+0.01 deg): the shin is inside the thigh. Subject `"Left knee folds 170deg"`, `limit` 160. The solver never draws one; QA reports one any other path makes. Hint: the root up by what puts the ankle where the knee folds 150 deg (the foot out from the hip when the ankle is above it).
- **REACH and GROUND with a knee fold**: `root: raise 0.186 m at f48 (the ankle target is 0.111 m inside the shin's reach: the knee would fold 175deg; it bends to 150deg and stops at 160deg), or key foot_l farther from the hip (wider or more forward)`, and GROUND on that foot says `(the sole is in the floor because the knee is on its stop: ...)` with the same root move instead of raising the foot (which folds the knee further). The patch moves the root key: the hips come up to where the knee folds 150 deg. An ankle target above the hip moves the foot out from it instead.
- **KNEE (style, bent)** stays: `checks.limits.knee` (opt-in, default 150 = `KNEE_FOLD`) makes a bend into the deep range a check (`"Left knee bent 154deg"`) for a motion that should not crouch that deep. The stop is anatomy (no motion asks for a shin in the thigh); the style limit is the motion's choice, so both are kept: free to 150, `knee` flags 150-160 when asked, KNEE (folds) past 160.
- **Sole points** (GROUND, SLIDE, FLOAT, the planted runs, `fix.slide`): heel, ball and tip of each foot on the skin's sole, the surface `verify_result` measures the floor on (`qa/geometry.js` `solePoints`; the rig's `landmarks.sole` says how far the skin lies below the ToeBase and Toe_End joints, measured by `tools/motion3/extract-rig.mjs`: X Bot 0 / -0.7 cm, Y Bot 3.3 / 2.6 cm). The lowest sole point and the lowest skin vertex of the foot agree within 3 mm on the Y Bot for fpitch -30..60; on the X Bot within 1.5 mm for fpitch -10..10, the skin 3-5 mm above the heel point with the toes up (-20..-30), and the skin of the toe crease 3 / 5 / 10 mm below the ball point at fpitch 20 / 30 / 45 (linear-blend skinning at the bent toe joint; not modelled, so the X Bot takes keep their bits).
- **A flat planted foot keeps its heading** (lane Q1, `fix/turn.js`, part of `fix.slide`). While both its heel and its ball are planted (QA's definition: under `plantH`, still), a foot cannot turn without one of them sliding. A turn the channels ask for then (`fyaw_<k>`, or the body's `yaw` when `fyaw_<k>` is not keyed) waits: the foot keeps the heading it planted with until its heel or toes come up or it lifts, then eases onto the keyed heading at about 6 deg a frame (with the heel up it turns on its ball, which `fix.slide` holds). A turn of 1 deg or less (the heel moves under 3 mm) is left. `fixed.slide.turns = { frames, max }` (max: degrees held). Session 4db5d447: `fyaw_r` keyed 0 at f0 and 30 at f37 turned the flat back foot 9 deg over the load, and its heel slid 2.2 cm (SLIDE f10-19); L2's 9dcf19c5 front foot turned 18.5 deg flat (SLIDE f7-24). With `fix.slide` off the turn is the SLIDE it was, whose hint keys `fyaw_<k>`.
- **FLOAT** (hard): 4 or more frames with both soles 2 cm or more above the ground and no declared support (`checks.supports`), in which the hips do not fall. The ground is the floor or the top of a scene obstacle under the sole point (see **The ground** below), so a foot on a box needs no support. Over the run the hips' vertical speed must drop by gravity; `value` is the share of g missing (1 = no fall), `limit` 0.75. A jump or a drop passes; a body held in the air does not. Subject `"no foot on the ground f27-f33, hips fall at 9% of g"`.
- **The ground** (`qa/ground.js`, 2026-10-16). The ground under a sole point is the floor (y 0) or the highest top of a scene obstacle at that frame (`out.objectsAt`: carried and follow objects are not obstacles, a hinge is at its turned pose) on the vertical line through the point, read in the box's own frame (a yawed or tilted box counts by its real footprint and sloped top), that is no more than 5 cm above the point (a sole sunk into a top stands on it; a table top above the foot is not its ground). FLOAT, the balance margins and `air`, SLIDE, the timeline's planted runs and the two fixes that use QA's planted definition (`fix.slide`'s lock and its turn hold) all measure sole heights from it. GROUND (a sole under the floor) and `fixed.ground` (soles lifted onto the floor) stay on the floor. Session 68d305dc: feet on a 0.7 m cube read as "no foot on the ground" (FLOAT n57) and `checks.supports: [{ object: "cube" }]` did not clear it, since a support rests the hips; only `part: "shin_l"` did, which also switched balance off on the cube.
- **Opt-in.** A spec whose `checks.limits` names a style limit (its own key, also from `motion.qa { checks }`) makes that quantity a check again, with these kinds: `speedCore`/`speedLimb` -> SPEED (m/frame), `accCore`/`accLimb` -> ACC (m/frame^2, pop frames excluded), `knee` -> KNEE `"<side> knee bent 152deg"`, `balance` (new, default 0.08 m) -> BALANCE (`value` = metres of the centre of mass outside the feet, or `"no foot on the ground"`). The agent decides this on purpose; the defaults in `QA_LIMITS` are only the opt-in values.
- `fix.retime` stretches only what QA reports: pops, and the speed and acceleration limits the spec opted into (`qa/style.js` `speedExcess`). A smooth fast motion, and a hard burst, keep their speed.

`output.observations` (every `motion.compile` and `motion.qa`, after `qa`; frames are absolute):

```jsonc
"observations": {
  "units": "[value, frame]; speed m/s, accel m/s^2, balance m inside the feet (< 0 outside), bend deg (0 straight)",
  "peaks": { "RightHand": { "speed": [9.27, 24], "accel": [149.98, 24] } },   // SPEED_JOINTS that move (peak >= 0.05 m/s)
  "balance": { "min": [-0.09, 18], "outside": [18, 59], "air": [[27, 33]] },   // min margin; outside = first/last frame < 0; air = up to 4 runs
  "bend": { "knee_l": [18, 0], "knee_r": [17, 0], "elbow_l": [0, 0], "elbow_r": [10, 25] } }
```

- Peak acceleration includes the centripetal part: a swing's wrist peaks near its fastest frame.
- `balance.min` skips frames carried by a declared support and frames where no foot counts; `air` lists the runs with both soles 2 cm or more above the ground (the floor or an object's top).
- Budget (C7): observations are tier 1 (always kept) and bounded (10 joints, 4 limbs, at most about 1 KB).
- `paced` (only when a skill paced its beats to fit a short span, C15): one line per such skill, `"smokeCigarette paced 0.90 to fit f1..f239"`.

## C14. Held-object keys and motion.keyObject (lane J2)

A carried object can be posed while it is in hand. The object leads; the holding hand follows.

```jsonc
spec.objects[id] = { "prop": "batGrip", "grab": 30, "release": 90,
  "keys": [{ "f": 40, "pos": [x, y, z], "rot": [qx, qy, qz, qw] }, ...] }    // carry entries only
```

**A key** is the world pose of the object's root at absolute frame `f`: the body's base pivot, or the group root for a group id. `rot` is a unit quaternion in three.js order (the take track's `quat`).

**Validation** (strict; a lenient reload ignores only unknown key fields). The exact messages:

- `objects.<id>.keys must be an array of { f, pos: [x, y, z], rot: [x, y, z, w] } or { f, pos, aim: [x, y, z], roll? }` (aim: C16)
- `objects.<id>.keys[i] has unknown field "rott"; did you mean "rot"?; a key is { f, pos: [x, y, z], rot: [x, y, z, w] } or { f, pos, aim: [x, y, z], roll? }`
- `objects.<id>.keys[i].f must be a whole frame, got 3.5`
- `objects.<id>.keys[i].f = 20 is outside grab..release (34..80); keys pose the object only while it is in hand` (no grab: 0; no release: the last frame)
- `objects.<id>.keys[i].f = 50: keys[0] is at that frame already; one key per frame`
- `objects.<id>.keys[i].pos must be [x, y, z], the world position of the object's base (a group: its root), got ...`
- `objects.<id>.keys[i].rot must be a unit quaternion [x, y, z, w], got ...` (length within 0.01 of 1; with neither rot nor aim it adds `; or give aim [x, y, z], the world direction its +Y points`)
- on a hinge: `objects.<id>.keys: only a carried object (prop) takes keys; a hinge turns by its channel "door", keyed in spec.keys`

**Between keys** (`object-keys.js`):

- Position: a cubic Hermite.
- Rotation: `q_i * exp(v(u))`, with `v` a Hermite in the frame of `q_i`, from 0 to `log(q_i^-1 q_i+1)`. This is squad-like.
- Inner keys take parabola (Catmull-Rom) tangents, so the object does not stop at them. The first and last key take zero tangents.
- With `fix.retime`, key frames go through `out.timeMap`.

**Blend.** The lead weight is 1 from the first to the last key. Over `KEY_BLEND` = 8 frames before the first key and after the last key it ramps by smoothstep, cut to grab..release. The hand blends from the plain carry: wrist position by lerp, hand rotation by slerp. Nothing jumps; QA finds no POP.

- A frame with weight 0 is bit for bit the take without keys.
- A carry without keys is bit for bit the take before C14 (`test/motion3/verify-motion3-carried.mjs` pins the hash).

**Hand from object** (`compiler/hold.js`, called by `pose.js` after the plain arm, wrist channels and fingers):

- `palm = key o attach^-1`. The palm frame is `carriedPose(..., { prop })` at the prop origin.
- `attach` is the plain carry's offset: the `at`/`along` transform, or the grab-frame palm offset solved without the keys (a group, or `grab` without `at`/`along`). The keys never feed back into it.
- The arm IK reaches for the wrist position that puts the grip on the key.
- **The whole arm follows the object (lane K8, `compiler/arm-orient.js`).** Before K8 the elbow stayed in the bend plane the channels gave it and the wrist alone turned the object, so most bat angles a person holds were out of reach (session 16d12ba9: the wrist deviation needed 121 deg). Now:
  - **Swivel.** The elbow swings about the shoulder-wrist axis. A pole is scored by the wrist strain it leaves (each turn's squared share of its half range, plus 400 times the squared share past a limit), a light pull toward the channels' bend plane (0.5 (1 - cos); a keyed `elbow_<side>` is a preference, no longer a rule) and the same steep price more than 100 deg from it (the upper arm's own roll). An arm the channels left straight (its elbow less than 5 mm off the shoulder-wrist midpoint) has no bend plane: it swivels from where its elbow would point if it bent, the upper arm's rest bend carried by the bone (lane N1). Before, a straight FK arm's 1 mm leftover (the Y Bot's upper arm is 2 mm shorter than the forearm, so the elbow sits up the arm) was the plane: it put the elbow "up", the limit 100 deg from it ruled out an elbow pointing down, and session d5c110a7's batting stance missed by 53.4 cm.
  - **Twist.** The turn about the forearm (pronation and supination, -85..85) is shared: the forearm bone turns half of it about its own axis, the hand the rest, so the skin twists along the forearm.
  - **Wrist.** The hand adds the rest within the limits, relative to its rest on the forearm: flex -70..70, deviation -35..20 (+ toward the thumb). The solve runs 3 times. Only what is still past a limit after the swivel and the twist is a residual.
  - **The elbow's path** (`hold-plan.js`). On every frame the keys lead, the soft minimum of 72 poles (5 deg apart) is read on the plain pose of that frame; the path then minimises, over the whole keyed span, each frame's cost plus 1000 times the squared elbow acceleration (Gauss-Newton, a 5-diagonal solve). The best pole can move 20 deg a frame while a bat whips through the zone; following it would jerk (POP). Every frame reads the same plan, so a frame still solves on its own (windowed compiles, frames solved on demand) and the same spec gives the same take.
  - **The path never jumps** (lane Q1, `hold-plan.js` `steadyPath`). Where the cheap poles of two frames in a row lie on either side of a ridge of the landscape, the solve from each frame's soft minimum stays in a local optimum that jumps across it. A jump: the pole turns more than 45 deg in a frame while the elbow moves more than 2x as far as in the frames around and more than 5 cm (QA POP's floor). The path is then solved again from the cheapest path over the 72 poles that never turns more than 45 deg a frame (dynamic programming), and if the cost pulls it back into a jump, with the smoothing 16x stronger within 4 frames of it. Session 4db5d447: at the follow-through the elbow could hold the bat down-forward to f43 and up-forward from f44; the planned elbow went 22 cm in one frame (POP RightForeArm 17.1 cm/f^2, FLIP 78 deg). Now it goes over in steps of at most 10 cm, the plane at most 26 deg a frame, with no REACH. A path that does not jump, and one these do not free of its jump (the keys jerk the hand there), is the plan as before, bit for bit.
  - **Blend.** The swing from the channels' bend plane scales with the lead weight `w`, so the elbow eases out of and back into the plain arm.
- **The second hand** (`second-hand.js`). A left hand with a weight on a `kind: "prop"` anchor of the carry's prop (the right hand holds it), with or without a fit, turns with the keyed object too. Its grip is the holding hand's mirrored across the plane of the object's +Y and the holding fingers (the object's +Y runs through the left palm frame as through the right one, knuckles in line), turned about +Y to the roll its wrist holds most easily (36 rolls; the roll's path is planned like the elbow's, on the frames solved with the holding hand). The anchor keeps its meaning: the wrist stays where it put the hand (with a fit, the palm, the fit's effector). The elbow swivels like the holding elbow (lane N1; it stayed in the plane the anchor's IK gave it, and the default pole, down and back, bent a left arm reaching across the chest into the torso: session d5c110a7, BODY hand_l into torso): each roll is scored by the wrist strain at the best of 36 poles, plus 1 per squared centimetre the upper arm, the forearm or the hand goes into the torso capsules (the BODY check's), plus 100 per squared centimetre the hand goes past what QA allows a hand (lane Q1): into the torso past the BODY allowance (0.5 cm), into the holding hand past the SELF one (1 cm). At 1 alone, session 4db5d447 put the hand 0.9 cm into torso_lo at f35 to save 1 of strain (BODY). The elbow's path is planned at the planned rolls like the holding elbow's. A grip the arm cannot hold fades out (weight `exp(-max(0, cost - 3) / 10)`, smoothed over the frames), so the hand stays nearer the plain arm instead of flipping at a limit. QA excuses that hand against the object on the frames it grips (COLLIDE, `diag.hold_l.second`): at weight 0.5 or more, or with its palm (between the index and middle finger) inside the object (lane Q1: a grip that fades still holds the handle; session 6262a69c allowed hand_l x empty 5 cm at f37-40 for it).
  - **A wrist anchor does not grip** (lane Q1, measured, not changed). Without a fit the anchor puts the wrist on its point, and the palm, 8 cm on, goes round it with the roll: anchored at `low` the palm is 8 cm off the bat, and a world `offset` stays fixed while the bat turns. Session 4db5d447 moved the offset over seven compiles to dodge the collisions this made: its palm is 10-24 cm off the bat axis, its forearm crosses the bat (COLLIDE farm_l, allowed), and at f29 and f41 the anchor is 7-11 cm from the right palm (SELF hands overlap, real). A fit (`reachGrip`, or `fits` with the palm as effector) puts the palm on the point: session 6262a69c's palm is within 1 cm of the axis, the hands 8.5 cm apart along it (the kit's `low`, a real grip: hand capsules 8-10 cm apart, no SELF).
- On keyed frames the hand ignores `hand_<side>` and a fit on the holding hand.
- `diag.hold_<side> = { w, miss, twist, flex, dev, swivel, fold?, second? }` holds what the hand needed: metres, then degrees before the clamp, and the degrees the elbow swung from the channels' bend plane (`fold`: the flexion the wrist asked when past 145 deg, C13 "The elbow's stop"; `second`: the object a second hand grips). `diag.arm_miss_<side>` is scaled by `1 - w`.
- Frames the keys do not lead (`w` 0) and takes without object keys are bit for bit the takes before K8.

**The object stays in the hand.** The take track, refs, probes, goals and QA read `palm o attach` (`object-pose.js`). What the hand could not reach shows as a residual on the object, not as a gap between hand and object.

**QA** (`qa/key-checks.js`, from the first to the last key). The residual is the farthest part-box corner between the keyed pose and the drawn pose:

- `REACH "<id>: 6.2 cm off its keys"`, `limit` = `checks.limits.reach` (0.01 m).
- `cause` = `"objects.<id>.keys[2] f47"`, the key nearest the worst frame.
- `hint` names the reason: `the arm is 6.0 cm short`, or `the grip is 10.9 cm inside the forearm's reach (the elbow would fold 171deg; it bends to 145deg and stops at 150deg)` (then `key a pose farther from the shoulder, or turn or move the body away from it (root, yaw, spine_yaw)`), or what the wrist still needs once the arm turned, `the wrist twist about the forearm needs -94deg (limit -85..85) after the elbow swung 40deg and the forearm turned`; then `key a pose nearer the hand, or bring the body to it (root, yaw, spine_yaw)`, and for a rot key or an aim key with roll `; an aim key without roll takes the roll the arm holds most easily`. No fix and no patch: only the user or the agent decides the pose.

**`motion.keyObject`** (job, not readOnly):

```jsonc
{ "characterId": "char-a", "objectId": "cylinder", "frame": 47, "pos": [x, y, z], "rot": [x, y, z, w] }   // carry
{ "characterId": "char-a", "objectId": "door", "frame": 30, "angle": -40 }                                 // hinge: angle, or rot
{ "characterId": "char-a", "objectId": "cylinder", "frame": 47, "remove": true }
// output: what motion.compile answers (frames, fps, installed: true, specId, qa, observations, ...) plus
"keyed": { "objectId": "cylinder", "kind": "carry", "f": 47, "keys": [40, 47], "removed"?: true }
       | { "objectId": "door", "kind": "hinge", "channel": "door", "f": 30, "angle": -40 | "removed": true }
```

- It edits a copy of the installed take's `spec` (`key-edit.js`) and compiles it leniently. It installs whatever QA says: this is a user edit. That makes one undo entry, and `affectedIds` is `[characterId]`.
- **Carry:** the key is upserted at `frame`, keys stay sorted, and `pos` and `rot` are rounded to 0.1 mm and 1e-5. Removing the last key drops `keys`, so the spec is again the one it started from (same specId).
- **Hinge:** `angle` (degrees), or the turn of `rot` about the hinge axis from the scene pose (the drawn world rotation; `pos` is ignored). It is written as `spec.keys[{ f, set: { <channel>: angle } }]`, and a user key already at `frame` takes the channel. `remove` drops the channel from that key, and the key too when nothing is left.
- The frames are the spec's absolute frames. They equal the take's unless `fix.retime` moved keys.
- Refusals (`INVALID_ARGUMENT`), with the exact text:
  - `frame 120 is outside the take (0..95)`
  - `"<id>" is in hand only f30..f95 (grab..release); at f20 the take does not hold it, so drag it as a scene object, or change objects.<id>.grab/release first`
  - `keying "<id>" (carried) needs pos [x, y, z] and rot [x, y, z, w] or aim [x, y, z] (+ roll), one of the two: the world pose of its base (a group: its root)` (aim: C16)
  - `"<id>" follows landmark:mouth (spec.objects.<id>); it has no keys: change its follow, offset or aim` (a follow entry, C16)
  - `keying "<id>" (a hinge on channel "door") needs angle (degrees) or rot [x, y, z, w] (its drawn world rotation; the turn about the hinge axis is kept)`
  - `"<id>" has no key at f47; its keys: f40, f53`, and for a hinge: `"<id>" (hinge, channel "door") has no key at f20; door is keyed at f0, f40`
  - `"cube-6" moves with "empty-2" (spec.objects.empty-2); key "empty-2" with its root pose` (a part of a moved group)
  - `"<id>" is not in this take's spec.objects (cylinder, cube): the take neither carries nor hinges it, so drag it as a scene object`
- `TARGET_NOT_READY` when the character has no compiled take.

## C15. Switch entries, levels, kits and smokeCigarette args.kit (lane K4)

A take shows, hides and dims scene records, not only moves them. Kits are props built to be carried.

### Switch entries and level

```jsonc
spec.objects[id] = { "visible": "flame_vis", "level": "flame" }        // switch: no prop, no pivot/axis/channel
                 | { "prop": "cig", ..., "visible": "cig_vis", "level": "ember" }   // a carry takes level too
```

- **A switch moves nothing.** It names any record: a body, a group, or a record with no box (an Empty, a light, an effect). `motionScene` lists the box-less records in `scene.others` (`{ id: { renderer, ancestors } }`, kept by saved take sources) and marks a glowing body `glow: true`.
- `visible` shows the record while the channel is above 0.5 (an unkeyed channel hides it). `level` is the record's strength, the channel value clamped 0..4: 0 dark, 1 as authored; it scales a light's intensity, a glow and an effect's birth rate (lanes K2, K3). An unkeyed level channel reads 1. Both channels count as declared channels (no `spec.channels` needed).
- Validation (exact messages):
  - `objects.<id> needs visible or level (a channel): a switch shows, hides or dims "<id>" without moving it; a carry needs prop, a hinge pivot and channel`
  - `objects.<id> (switch) has unknown field "visibel"; did you mean "visible"?; fields: visible, level`
  - `objects.<id>.level must name a channel (the record's level 0..4: 0 dark, 1 as authored; it scales its light, glow and effect rate)`
  - an id the scene does not have: the C3 message, with the box-less records among the suggestions.
  - Any of pivot, axis or channel makes the entry a hinge (C3 messages); prop makes it a carry.
- **The take.** A switch bakes `vis` (Uint8) and `lvl` (Float32) only, no `pos`/`quat`. A carry with `level` adds `lvl`. A carry without `level` bakes exactly as before (the C14 hash stays).
- **Motion.** A switch never moves its record: the movers (compile, `object-pose.js`, `key-edit.js`, the OBJECT check) skip it, and `src/object-travel.js` treats a track without `pos` as no motion of its own, so a parent's carry still applies to a switched part. `motion.keyObject` on a switched part answers the C14 "moves with" message for its carried group.
- **`trackLevel(id, frame, take)`** (`src/object-travel.js`): the `lvl` value at the frame, else 1.
- **Inherited visibility.** `trackShown(id, frame, take, records?)`: with the authored records (a Map by id or the list), the record is hidden while it or any ancestor has a `vis` track that hides it. `sceneObjectsAt` and the props renderer (`SceneObject.place()`) pass the records, so hiding a group hides its parts.
- **Timeline.** A show/hide event per object a channel shows: `{ f, object: <id>, event: "show" | "hide" }` for every carry and switch on that channel.
- **GRAB.** An object whose `visible` channel hides it the frame before `grab` appears in the hand (a cigarette out of a pocket): there is nothing to pick up, so no GRAB issue.

### at/along on a group (amends C3)

`at`/`along` now pin a group's root too: the root sits at the prop origin plus `at` (palm axes), its +Y along `along`, its +X toward the palm's d axis. A group without them keeps its grab-frame offset as before. Kits use this so the root (the grip) rides the prop origin.

### Kits (`src/kits/`, `object.createKit`)

```jsonc
object.createKit { "kit": "cigarette", "name"?: "Smoke", "position"?: { "x": 0.5, "y": 0, "z": 0.4, "rot": 0 } }
-> output { "rootId": "empty-3", "parts": { "body": "sculpt-2", "ember": "sphere", "smoke": "effect" },
            "bind": { "empty-3": { "prop": "cig", "at": [0, 0, 0], "along": [0, 0, 1], "visible": "cig_vis" },
                      "sphere": { "visible": "ember_vis", "level": "ember" }, "effect": { "visible": "ember_vis" } },
            "skill": "smokeCigarette" }      // kits with no skill answer props (the grip prop) instead
```

- One job, one undo entry: an Empty root (the grip) and its parts parented to it. `y` is lifted so no part is under the floor. The answer's `bind` is the `spec.objects` snippet: the root's carry and the parts' switches.
- `inspect_studio { scope: "catalogue" }` lists `kits: [{ kit, parts, prop, description }]`.

| Kit | Parts (role) | Root, carry |
|---|---|---|
| cigarette | body (sculpt: filter, paper; 8.4 cm x 7.8 mm), ember (1 cm sphere, glow), light (faint point light; a glow lights nothing), smoke (effect at the tip); ember, light and smoke are `showOnlyInTake` | prop `cig`: origin between RightHandIndex2/Middle2; +Y along the palm normal, filter at y -0.026, tip at y 0.058; at [0, 0, 0], along [0, 0, 1] |
| lighter | body (sculpt: body, hood, wheel), flame (sphere, glow), light (point, flicker 0.6); flame and light are `showOnlyInTake` | prop `lighter`: origin LeftHand/LeftHandMiddle1; +Y toward the thumb, flame at the prop point flame [0.01, 0.036, 0]; along [0, 1, 0] |
| exhale (C16) | puff (an exhale effect on the root, `showOnlyInTake`) | no hand: the root's bind is `{ follow: "landmark:mouth", aim: "face", visible: "exhale" }`; the catalogue row has `follow` in place of `prop` |
| bat | body (sculpt: knob, handle, taper frustums, barrel, end cap; 0.84 m), trail (effect on the barrel, width 0.3 along it) | root at the knob, +Y along the bat; props.batGrip of the swing fixture, at -0.14 u, along u = [0, 0.5, 0.866] |
| ball | body (7.4 cm sphere) | props.ballGrip |
| sword | body (sculpt: pommel, grip, guard, blade, tip; 1 m), trail | root at the grip; props.swordGrip |
| pistol | body (sculpt), flash (glow), light | root at the grip, barrel along +X; props.gunGrip; flash and light switch on `muzzle_vis` and are `showOnlyInTake` (hidden in a static scene) |

A part whose kind the build does not have is left out and named in `skipped`.

A part marked `showOnlyInTake` (a record field the normalizer keeps, `object-look.js`) draws only on the frames a take's visible channel shows it: its own channel, or one of a group above it (the exhale root's `visible: "exhale"` shows the puff). With no take, or a take that binds no visible channel on it or above it, it is hidden: a light, glow or effect included (`object-travel.js` `trackShown`, `sceneObjectsAt`, `effects/emitter.js`). The bodies and the bat and sword trails (a still trail draws nothing) are not marked.

A glowing part (the ember, the flame, the muzzle flash) casts no shadow: any record with `glow` is self-lit (lane K9), so a light inside it shines out. A light that renders a shadow from inside a record that casts one lights almost nothing; the receipt that places, switches or moves either says `LIGHT_BLOCKED` with the light's id and `Blocked: inside <name> (<id>), which casts shadows, so it lights almost nothing. Move it out or set shadow false.` (`src/light-blockers.js`; primitives by their drawn shape, other records by their box).

### smokeCigarette: args.kit, channels, any posture

- `args.kit: { cig: <rootId>, lighter: <rootId>, exhale?: <the exhale kit's rootId, or an effect id> }`. The skill adds the `spec.objects` entries itself: the cigarette root `{ prop: "cig", grab: f0+28, at: [0, 0, 0], along: [0, 0, 1], visible: "cig_vis" }`, the lighter root `{ prop: "lighter", grab: f0+35, release: f0+102, at: [0, 0, 0], along: [0, 1, 0], visible: "lit_vis" }`, and switches found by what the parts are: under the cigarette a glowing body and a light `{ visible: "ember_vis", level: "ember" }` and an effect `{ visible: "ember_vis" }`; under the lighter a glowing body and a light `{ visible: "flame_vis" }`; the exhale `{ follow: "landmark:mouth", aim: "face", visible: "exhale" }` (C16, amended by lane K6: it was a switch on an emitter the agent placed at the mouth, which a moving or squatting head left behind).
- The exhale emitter needs no placing: `object.createKit { kit: "exhale" }` (an Empty root and an exhale effect part on it) answers the rootId to pass, and the follow entry puts the root on the mouth every frame. It also allows the kits 3 cm (cigarette, right thigh) and 4.5 cm (lighter, left thigh) into the thigh their pocket is on.
- Refusal: `use[i] smokeCigarette: args.kit.cig "<id>" is not a group in the scene; object.createKit { kit: "cigarette" } answers its rootId` (and for lighter, an unknown field), and `use[i] smokeCigarette: args.kit.exhale "<id>" is not a scene object; object.createKit { kit: "exhale" } answers its rootId (it follows the mouth)`.
- New channels (in `spec.channels` of the expanded spec): `exhale` (1 over f0+116..137 and f0+238..259) and `ember` (0 before f0+73, 1 when it catches, 2 on each drag f0+80..90 and f0+200..212, 0.6 between).
- **Pacing (lane K9).** The skill runs f0..f0+264 (265 frames, 11.0 s). When `args.until` (default: the spec's last frame) leaves a span of 198..263 frames after f0 (199..264 frames, at least 75%), every beat's frame is scaled by span / 264 and rounded: the keys keep their order, the switch steps are not stretched, and the frames above (and the kit's grab/release) scale the same way. The answer says so in `output.observations.paced` (`["smokeCigarette paced 0.90 to fit f1..f239"]`) and `output.skills[i].paced`. A shorter span is refused: `use[i] smokeCigarette: needs frames f1..f199 at least: 199 frames, 8.3 s at 24 fps, paced 0.75 (265 frames, 11.0 s, at its own pace); it has f1..f198, so set frames >= 200 or frames: "auto"` (with `args.until`: `so set args.until >= 199`). `motion.describe` skills: `frames: "265 nominal; fits 199..264 by pacing"`. With 265 frames or more after f0 nothing changes: the takes bake bit for bit as before.
- Any posture keyed before f0 (`needs: a stand or squat keyed before f0`):
  - head_pitch keys are offsets from the head pitch keyed before f0 (standing: 0, unchanged);
  - the right arm's elbow poles (to the lips, holding) turn with the torso lean, `pitch + spine_pitch`, so the reach to the lips comes from the body (the lighter arm stays upright);
  - a squat (the hips below 0.7 of the rig's standing height) rests the cigarette hand over the right knee (`anchors.hold` from the knee joint at f0, pulled in to 0.88 of the arm's reach), moves the hand between the lips and the knee through `anchors.mouthOut` (20 cm straight ahead of the mouth), and brings the lighter back to the pocket over 20 frames instead of 16. The hand's detour circle around the torso (`detourRadius`) jumps where a path leaves it sideways, which a straight lips-to-knee move does over a leaning torso. The compiler is unchanged: standing takes compile bit for bit as before.



1. `resolveFrames` (`skills/frames-auto.js`).
2. Open parameters are searched (`search.js`).
3. `nameChecks` (`qa/check-names.js`, on a copy): an unnamed `contacts`, `orient`, `below`, `clearance` or `appear` entry is named by its place in the agent's spec, `contacts[0]`. The QA subject reads `"contacts[0]: 100.0 cm apart"`, and two unnamed checks are two groups.
4. Skills expand, then `validateSpec(full, { sk, scene, lenient })`.
5. Compile, then `runMotionQa(sk, out, spec, { userSpec })` and `observeMotion(sk, out, spec.checks)` (C13).
6. `timelineOf` and, with `opts.probes`, `runProbes`.

It answers `{ out, qa, observations, spec, expanded, used, fixed, search, timeline, probes?, ms }`. `opts`: `checks` (replace every check), `lenient`, `probes`.

## C16. Follow entries and aim keys (lane K6)

Two live runs showed the same gap: the agent could only place a record where a hand holds it or where it stands. An exhale puff the agent placed at a guessed point floated above a squatting smoker's head (session da8760fa), and bat keys took a hand-written direction-to-quaternion script per call (session 6912547c, 13 scripts in 25 calls).

### Follow entries (`follow.js`)

```jsonc
spec.objects[id] = { "follow": "landmark:mouth", "offset"?: [x, y, z], "aim"?: "face" | "up" | [x, y, z] | <ref>, "visible"?: "exhale", "level"?: "puff" }
```

- **Any record:** a body, a group root, or a record with no box (an effect, a light, an Empty), like a switch (C15). `follow` makes the entry a follow; `prop` still makes it a carry, and any of pivot, axis or channel a hinge.
- **The ref** is any point ref (C2): `landmark:mouth`, `joint:<Bone>`, `bone:<Bone>`, `prop:<prop>.<point>`, `anchor:<name>`, `object:<id>[.center|.top|.base]`. An `object:` ref may not name an object a follow entry moves (it would follow itself).
- **aim** sets the record's +Y (effects emit along local +Y). The record turns the shortest way from upright onto it.
  - `"up"` (default): world up.
  - `"face"`: the face's forward direction, the Head bone's rest +Z (as `checks.orient` "face").
  - `[x, y, z]`: a world direction.
  - a ref: toward that point.
- **offset** is metres along the record's own axes after aim (+Y along aim), from the ref point.
- **The take** bakes `pos`, `quat` and `hold` on every frame, plus `vis`/`lvl` from its channels. The track is world space throughout, so `src/object-travel.js` cuts the carry of the record's own parents, and a following group's parts ride its root. The effects lane births a particle at the emitter's pose at its birth frame, so a puff leaves the mouth while the head moves.
- **Motion and QA.** `rootPoseAt` and `objectBoxesAt` answer the follow pose, so refs, probes and goals see it. A follow entry is not an obstacle: `compile.js` marks its bodies `carried`, so the body capsules, the scene-object check and the auto-fixes skip them. `qa/object-checks.js` checks only carries, so a following body, light or effect makes no COLLIDE issue.
- **Validation** (exact messages):
  - `objects.<id>.follow "<ref>" ...`: the C2 `checkRef` messages, for example `objects.puff.follow "mouth" must be joint:<Bone>, bone:<Bone>, prop:<prop>.<point>, anchor:<name>, landmark:mouth, object:<id>[.center|.top|.base]; did you mean "landmark:mouth"?`
  - `objects.<id>.follow "object:lid.top": "lid" moves with the follow entry objects.crate; a follow entry rides a joint, landmark, prop or anchor point, or an object no follow entry moves` (the same for `aim`)
  - `objects.<id>.offset must be [x, y, z], metres along the record's own axes after aim (+Y along aim), got ...`
  - `objects.<id>.aim must be "face", "up", a world direction [x, y, z] or a point ref (toward it), where the record's +Y points; got ...`
  - `objects.<id>.aim must be a non-zero world direction [x, y, z], got ...`
  - `objects.<id> (follow) has unknown field "ofset"; did you mean "offset"?; fields: follow, offset, aim, visible, level`
  - `visible` and `level` take the C15 messages.
- **motion.keyObject** refuses a follow entry: `"<id>" follows landmark:mouth (spec.objects.<id>); it has no keys: change its follow, offset or aim`.
- **smokeCigarette** `args.kit.exhale` gets `{ follow: "landmark:mouth", aim: "face", visible: "exhale" }` (C15, amended). The exhale kit makes the emitter with no placing.
- **The exhale look** (`src/effects/`): the preset now throws the breath forward and a little down (`droop` 0.25 of the speed, a look parameter, not a record field), then it rises and spreads. Defaults: size 0.035 m, grow 8, speed 0.9 m/s, spread 0.35, gravity -0.35, opacity 0.3.

### Aim keys (`key-aim.js`, amends C14)

```jsonc
{ "f": 47, "pos": [x, y, z], "aim": [x, y, z], "roll"?: 0 }     // in place of rot
```

- **aim** is the world direction the object's +Y points (a bat: knob to barrel; a kit root's +Y). It is named like the follow `aim` (where +Y points). A spot light's `light.aim` (K2) is a world point, which is different.
- **The turn** is the shortest turn from where the plain carry (no keys) holds the object at that key's frame onto aim, then **roll** degrees about aim (right-handed). A given roll (0 included) is used exactly.
  - The orchestrator asked for "the minimal twist from the previous key". Over a swing that piles the roll up: the J2 fixture's four keys written as 2-decimal aims missed by 45.5 cm (REACH, 32.4 deg off at f53) when each key turned from the key before it. Turned from the plain carry, the same aims draw every key within 0.0 deg and 0.0 cm, with the same QA as the rot keys.
- **No roll: the roll the arm holds most easily** (lane K8, `key-aim.js`). Roll 0 kept the plain carry's roll, and a wrist that cannot reach it left session 16d12ba9 at 77.0 cm REACH. Now 24 rolls 15 deg apart are scored by the arm that would hold them at that key's frame (`compiler/hold.js` `holdCost`: the strain at the soft-minimum pole of C14's swivel with each wrist limit 15 % of its half range tighter, so the frames between keys keep some room, plus 1 per squared centimetre the arm is short or the wrist nearer the shoulder than an elbow folds, 145 deg; lane N1); a pass over the keys in order (dynamic programming) picks one per key with 0.2 times the squared turn (radians) from the key before, so equally easy rolls do not alternate; a golden-section search settles each pick within its 15 deg. On 16d12ba9 every key is then drawn within 1 deg (REACH 5.3 cm where three keys are beyond the arm's reach, QA 115 -> 65); the same keys with `roll: 0` stay at 75.6 cm.
- **Hemisphere continuity and grid.** The quaternion is rounded to 1e-5 (the grid `motion.keyObject` writes) and kept on the hemisphere of the key before it. `rot` keys are used as given, so every rot-key take bakes bit for bit as before.
- **Validation** (exact messages):
  - `objects.<id>.keys[i] gives both rot and aim; give one: rot [x, y, z, w], or aim [x, y, z] (the world direction its +Y points) with roll`
  - `objects.<id>.keys[i].aim must be a non-zero world direction [x, y, z] for the object's +Y (a bat: knob to barrel), got ...`
  - `objects.<id>.keys[i].roll must be degrees about aim (a number), got ...`
  - `objects.<id>.keys[i].roll turns the object about aim; give aim [x, y, z] with it, or leave roll out (rot fixes the roll)`
- **Readback, measured not judged** (`output.observations.held`, `qa/key-checks.js` `heldReadings`). Every key of every keyed carry is drawn as `{ f, deg, cm, got?, rot? }`:
  - `deg`: the drawn +Y off the asked direction (aim, or rot's +Y).
  - `cm`: the drawn base off `pos`.
  - `got`: the drawn +Y, when 1 deg off or more.
  - `rot`: the quaternion an aim key used.
  - `observations.units` says so. REACH (C14) still judges the residual.
- **motion.keyObject** takes `aim` (+ `roll`) in place of `rot` and upserts `{ f, pos, aim, roll? }` (aim 1e-5, roll 0.01 deg). The J1 gizmo still writes `pos` + `rot`.

## C17. Free entries: keys and falls (lane objkeys)

An object nobody holds can move. `spec.objects[id]` with no `prop`, `follow` or hinge field (`pivot`, `axis`, `channel`) and with `keys` or `fall` is a **free** entry (`free-motion.js` `isFree`). It takes a body or a group (Empty) id, like a carry.

```jsonc
spec.objects.can = {
  "keys": [{ "f": 30, "pos": [0, 1.3, 0.45], "rot": [0, 0, 0, 1] },    // world pose of its root (a body's base pivot, a group's origin)
           { "f": 36, "pos": [0, 1.1, 0.45], "aim": [0, 1, 0] }],      // aim (+ roll) as C16: turned from the scene pose
  "fall": [{ "at": 40 }, { "at": 90, "onto": "table", "bounce": 0 }], // one fall or a list
  "visible": "can_vis"                                                // and level, as a switch (C15)
}
spec.objects.cup = { "prop": "cupGrip", "grab": 60, "release": 80, "fall": { "at": 82 } }   // a carry: before grab or from release on
```

- **Keys.** The curve of held keys (C14 `keyedPose`, `object-keys.js` `curveOf`), at any frame `0..frames-1`, one per frame. Before the first key of a run it stays where it was (its scene pose, or where it landed); after the last it holds the last key. An aim key turns the scene pose's +Y onto `aim`, then `roll` degrees about it (no arm, so no roll search).
- **Fall.** `{ at, onto?, bounce? }`. From where it is at frame `at` it drops straight down under gravity (`G` = 9.8 m/s^2, no tumbling) onto the top of the highest still body under the centre of its parts (`landingOf`); `onto` restricts that to one object (its top even when it is not right below); nothing below: the floor (y 0). It lands `sqrt(2h/g)` after `at`, bounces at most once (`bounce` 0..0.6 is the share of the landing speed it bounces back with, default 0.25, never higher than `BOUNCE_MAX` = 0.03 m; 0 lands dead) and rests there, never inside the support. Bodies a spec.objects entry moves are no support.
- **Order.** Keys and falls chain in frame order: a fall starts from the pose the keys before it leave (a key on the fall's own frame comes first); keys after a fall take over at their first key.
- **A carry's fall.** Before its grab (it lies where it landed: the GRAB check, the grab-frame offset of a carry without `at`/`along`, a keyed carry's `attach` and the carrying hand's own object anchor all read that pose, `object-pose.js` `restingAt`) or from its release on (it falls from the release pose). A fall while in hand is refused.
- **Who sees it.** `objectTracks` (`compiler/compile.js`) moves a free entry's bodies like a hinged one's: an obstacle at its pose that frame for the body checks and the fixes. `objectPoseAt` / `objectBoxesAt` / `rootPoseAt` read it, so refs, goals, probes, `observations.near`, contacts and the timeline do. The take bakes `pos`/`quat` in world space with no `hold` (and `vis`/`lvl` when it names them), so `src/object-travel.js` draws it in the viewport and in exports, its parts riding the group root.
- **Retime.** Keys and fall frames go through `out.timeMap` like the body's keys; a fall's duration is physics and is not stretched.
- **Validation.** Free keys outside the take, a fall without `at`, two falls on one frame, `bounce` outside 0..0.6, an unknown `onto`, an unknown fall field (`FALL_FIELDS`), and keys or a fall on a hinge entry are refused with the reason. `motion.describe { topic: "objects" }` lists the free entry; `essentials` shows it as "as carry".

## Fixture

`test/motion3/fixtures/bat-swing.mjs` holds the baseball swing of session 294ac65a (C14): the bat `cylinder`, the plate `cube`, the installed spec `spec-3a5803641a71` and four bat keys.

`test/motion3/fixtures/bat-aim-swing.mjs` holds the bat-kit swings of sessions 16d12ba9 (`spec-c66116660dc4`, nine aim keys without roll) and 6912547c (`spec-86cfd6cf7fae`, 38 rot keys), rebuilt from the logs (lane K8).

`test/motion3/fixtures/bat-stance.mjs` holds the bat-kit swings of sessions d5c110a7 (`spec-f46b8389f1fc`, installed at QA 110, REACH 53.4 cm) and f0f2be59 (`spec-765240635845`, QA 0), both with a straight FK right arm the aim keys lead (lane N1).

`test/motion3/fixtures/bat-fold.mjs` holds the bat-kit swing of session df6acdcc (`spec-9879beb1f6ce`, installed at QA 4 without `checks.limits`): the load folds the right elbow flat (171 deg at f34) as the wrist passes the shoulder, and the left hand reaches the handle over the first 10 frames (lane P2). With the elbow's stop (lane P3) the elbow stays at 150 deg and QA says REACH `"empty: 10.9 cm off its keys"` f15-36, the grip inside the forearm's reach.

`test/motion3/fixtures/bat-robust.mjs` holds the bat-kit swings of the final build's sessions 6262a69c (`spec-72eaf5116c0a`, QA 0, reachGrip) and 4db5d447 (`spec-f77f28d4b845`, installed at QA 17, the left hand anchored by its wrist), rebuilt from the logs (lane Q1). With the flat-foot hold, the steady elbow path and the second hand's prices the QA-17 spec is QA 2: SELF hands overlap at f29 and f41, where its wrist anchor sits next to the right palm.

`test/motion3/fixtures/cup-scene.mjs` holds the table group `empty` (top `cube`, legs `cube-2` to `cube-5`), the cup group `empty-2` under it (`cylinder`, handle `cube-6/7/8`) and `char-a` (Y Bot at the origin, yaw 0), with the ids and values of the baseline session.

## Amendment procedure

1. The lane stops and reports the change it needs and why.
2. Lane I lands a small amendment PR on `v3` that changes this file, the stub JSDoc and `test/motion3/verify-motion3-contracts.mjs` together.
3. Every lane rebases on `v3`.
