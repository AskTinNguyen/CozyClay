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
    "at": [d,l,n], "along": [d,l,n], "visible": "cup_vis" }
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

- GRAB issues: kind `"GRAB"`, subject `"<id>: hand 12.0 cm from it at grab"`, `worstFrame` = grab, `limit` = `checks.limits.grab` (default 0.03 m). The distance runs from the prop origin to the part boxes' surface.
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
  "planted": { "l": [[12, 31], [52, 86]], "r": [[12, 40]] },   // heel and ball < QA_LIMITS.plantH and still, >= 3 frames, <= 4 per foot
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

- Exactly one predicate: `near` (distance <= `tol`, default 0.05), `above` (a.y - b.y >= `by`, default 0), `moved` (the object base moved at least `by`, default 0.05, from the scene pose).
- `moved` accepts a bare object id: `"empty-2"` means `"object:empty-2"`. Every other ref needs its prefix.
- `mode` is `"all"` (default) or `"any"`.
- A GOAL issue's value is the shortfall and its limit is 0. A failed goal makes `qa.ok` false. `qa.goals` is there when `spec.goals` is.
- Issue frames index `out.frames`. `goals[].at` is absolute.
- Validation: `compiler/validate-goals.js` `validateGoals(spec, err, opts)`.

## C9. describe (`describe.js` `describe(topic, name?)`)

- `motion.describe { topic, name? }` answers `{ topic, schema (JSON Schema 2020-12 fragment), example (passes validation), notes[] }`.
- `topic: "skills"` answers `{ topic, skills: [{ name, args, needs, frames, adds }] }`. With `name` it answers that skill's full args schema and a `use` example.
- `topic: "essentials"` answers `{ topic, types, skills, notes }` in one call: `types` has one type line per topic and per shared shape (vec3, key, ref, ...), built from the same schemas (`schema/brief.js`); `skills` lists each skill with typed args, needs, frames and adds. The full topics stay one call each for meanings, examples and notes.
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
| hard (`qa.groups`, `qa.total`, `qa.ok`, search and repair cost) | COLLIDE (body, carried object), OBJECT (hinged object), GROUND, REACH, SLIDE, FLIP, LENGTH, FACE, BODY, SELF, KNEE (bends backward), GRAB, POP, FLOAT, the spec's checks (CONTACT, ORIENT, BELOW, CLEARANCE, APPEAR), GOAL | penetration, a pose that is not the one asked for, a planted foot that skates, a pole that flips, a stretched bone, a one-frame artifact, a body held up by nothing, a failed declared check or goal |
| style (`output.observations`) | SPEED, ACC (sustained acceleration), KNEE (bend past `knee`), BALANCE | fast, hard, deep or off-balance is a choice: a swing, a throw, a deep squat, a lunge |

- **POP** (hard): a one-frame event. The acceleration of a joint at frame f (second difference, m/frame^2) is above `accLimb` (`accCore` for Hips and Head) and more than 2x the largest acceleration of the frames 2 and 3 away (f-3, f-2, f+2, f+3). A one-frame event shows in up to three neighbouring frames (a step key in f and f+1, a one-frame glitch in f-1..f+1), so the frames next to f are not read. A smooth motion spreads its acceleration over 4 frames or more, so it is never a pop however fast it is. Subject `"<joint> accel 8.66 cm/f^2 in one frame"`. `qa/style.js` `isPop(a, f, floor)`.
- **FLOAT** (hard): 4 or more frames with both soles 2 cm or more above the floor and no declared support (`checks.supports`), in which the hips do not fall. Over the run the hips' vertical speed must drop by gravity; `value` is the share of g missing (1 = no fall), `limit` 0.75. A jump or a drop passes; a body held in the air does not. Subject `"no foot on the ground f27-f33, hips fall at 9% of g"`.
- **Opt-in.** A spec whose `checks.limits` names a style limit (its own key, also from `motion.qa { checks }`) makes that quantity a check again, with these kinds: `speedCore`/`speedLimb` -> SPEED (m/frame), `accCore`/`accLimb` -> ACC (m/frame^2, pop frames excluded), `knee` -> KNEE `"<side> knee bent 152deg"`, `balance` (new, default 0.08 m) -> BALANCE (`value` = metres of the centre of mass outside the feet, or `"no foot on the ground"`). The agent decides this on purpose; the defaults in `QA_LIMITS` are only the opt-in values.
- `fix.retime` stretches only what QA reports: pops, and the speed and acceleration limits the spec opted into (`qa/style.js` `speedExcess`). A smooth fast motion keeps its speed.

`output.observations` (every `motion.compile` and `motion.qa`, after `qa`; frames are absolute):

```jsonc
"observations": {
  "units": "[value, frame]; speed m/s, accel m/s^2, balance m inside the feet (< 0 outside), bend deg (0 straight)",
  "peaks": { "RightHand": { "speed": [9.27, 24], "accel": [149.98, 24] } },   // SPEED_JOINTS that move (peak >= 0.05 m/s)
  "balance": { "min": [-0.09, 18], "outside": [18, 59], "air": [[27, 33]] },   // min margin; outside = first/last frame < 0; air = up to 4 runs
  "bend": { "knee_l": [18, 0], "knee_r": [17, 0], "elbow_l": [0, 0], "elbow_r": [10, 25] } }
```

- Peak acceleration includes the centripetal part: a swing's wrist peaks near its fastest frame.
- `balance.min` skips frames carried by a declared support and frames where no foot counts; `air` lists the runs with both soles 2 cm or more above the floor.
- Budget (C7): observations are tier 1 (always kept) and bounded (10 joints, 4 limbs, at most about 1 KB).

## C14. Held-object keys and motion.keyObject (lane J2)

A carried object can be posed while it is in hand. The object leads; the holding hand follows.

```jsonc
spec.objects[id] = { "prop": "batGrip", "grab": 30, "release": 90,
  "keys": [{ "f": 40, "pos": [x, y, z], "rot": [qx, qy, qz, qw] }, ...] }    // carry entries only
```

**A key** is the world pose of the object's root at absolute frame `f`: the body's base pivot, or the group root for a group id. `rot` is a unit quaternion in three.js order (the take track's `quat`).

**Validation** (strict; a lenient reload ignores only unknown key fields). The exact messages:

- `objects.<id>.keys must be an array of { f, pos: [x, y, z], rot: [x, y, z, w] }`
- `objects.<id>.keys[i] has unknown field "rott"; did you mean "rot"?; a key is { f, pos: [x, y, z], rot: [x, y, z, w] }`
- `objects.<id>.keys[i].f must be a whole frame, got 3.5`
- `objects.<id>.keys[i].f = 20 is outside grab..release (34..80); keys pose the object only while it is in hand` (no grab: 0; no release: the last frame)
- `objects.<id>.keys[i].f = 50: keys[0] is at that frame already; one key per frame`
- `objects.<id>.keys[i].pos must be [x, y, z], the world position of the object's base (a group: its root), got ...`
- `objects.<id>.keys[i].rot must be a unit quaternion [x, y, z, w], got ...` (length within 0.01 of 1)
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
- The arm IK reaches for the wrist position that puts the grip on the key. The elbow stays in the bend plane the channels gave it.
- The hand turns about the wrist within the limits, relative to its rest on the forearm. Twist about the forearm: -85..85. Flex: -70..70. Deviation: -35..20 (+ toward the thumb). The solve runs 3 times.
- On keyed frames the hand ignores `hand_<side>` and a fit on the holding hand. The other hand's fit to a prop point (`kind: "prop"` anchor) follows the keyed object.
- `diag.hold_<side> = { w, miss, twist, flex, dev }` holds what the hand needed: metres, then degrees before the clamp. `diag.arm_miss_<side>` is scaled by `1 - w`.

**The object stays in the hand.** The take track, refs, probes, goals and QA read `palm o attach` (`object-pose.js`). What the hand could not reach shows as a residual on the object, not as a gap between hand and object.

**QA** (`qa/key-checks.js`, from the first to the last key). The residual is the farthest part-box corner between the keyed pose and the drawn pose:

- `REACH "<id>: 6.2 cm off its keys"`, `limit` = `checks.limits.reach` (0.01 m).
- `cause` = `"objects.<id>.keys[2] f47"`, the key nearest the worst frame.
- `hint` names the reason: `the arm is 6.0 cm short`, or `the wrist twist about the forearm needs -94deg (limit -85..85)`. No fix and no patch: only the user or the agent decides the pose.

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
  - `keying "<id>" (carried) needs pos [x, y, z] and rot [x, y, z, w]: the world pose of its base (a group: its root)`
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
| cigarette | body (sculpt: filter, paper; 8.4 cm x 7.8 mm), ember (1 cm sphere, glow), light (faint point light; a glow lights nothing), smoke (effect at the tip) | prop `cig`: origin between RightHandIndex2/Middle2; +Y along the palm normal, filter at y -0.026, tip at y 0.058; at [0, 0, 0], along [0, 0, 1] |
| lighter | body (sculpt: body, hood, wheel), flame (sphere, glow), light (point, flicker 0.6) | prop `lighter`: origin LeftHand/LeftHandMiddle1; +Y toward the thumb, flame at the prop point flame [0.01, 0.036, 0]; along [0, 1, 0] |
| bat | body (sculpt: knob, handle, taper frustums, barrel, end cap; 0.84 m), trail (effect on the barrel, width 0.3 along it) | root at the knob, +Y along the bat; props.batGrip of the swing fixture, at -0.14 u, along u = [0, 0.5, 0.866] |
| ball | body (7.4 cm sphere) | props.ballGrip |
| sword | body (sculpt: pommel, grip, guard, blade, tip; 1 m), trail | root at the grip; props.swordGrip |
| pistol | body (sculpt), flash (glow), light | root at the grip, barrel along +X; props.gunGrip; flash and light switch on `muzzle_vis` |

A part whose kind the build does not have is left out and named in `skipped`.

### smokeCigarette: args.kit, channels, any posture

- `args.kit: { cig: <rootId>, lighter: <rootId>, exhale?: <effect id> }`. The skill adds the `spec.objects` entries itself: the cigarette root `{ prop: "cig", grab: f0+28, at: [0, 0, 0], along: [0, 0, 1], visible: "cig_vis" }`, the lighter root `{ prop: "lighter", grab: f0+35, release: f0+102, at: [0, 0, 0], along: [0, 1, 0], visible: "lit_vis" }`, and switches found by what the parts are: under the cigarette a glowing body and a light `{ visible: "ember_vis", level: "ember" }` and an effect `{ visible: "ember_vis" }`; under the lighter a glowing body and a light `{ visible: "flame_vis" }`; the exhale effect `{ visible: "exhale" }`.
- The exhale emitter is an effect record the agent places at the mouth (a `landmark:mouth` probe at the exhale frames gives the point). It is not carried: an emitter attached to a bone emits only from the bone's current pose (effects lane), and a squatting or standing smoker's head barely moves while breathing out. It also allows the kits 3 cm (cigarette, right thigh) and 4.5 cm (lighter, left thigh) into the thigh their pocket is on.
- Refusal: `use[i] smokeCigarette: args.kit.cig "<id>" is not a group in the scene; object.createKit { kit: "cigarette" } answers its rootId` (and for lighter, an unknown field, a missing exhale).
- New channels (in `spec.channels` of the expanded spec): `exhale` (1 over f0+116..137 and f0+238..259) and `ember` (0 before f0+73, 1 when it catches, 2 on each drag f0+80..90 and f0+200..212, 0.6 between).
- Any posture keyed before f0 (`needs: a pose keyed before f0: standing or squatting`):
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

## Fixture

`test/motion3/fixtures/bat-swing.mjs` holds the baseball swing of session 294ac65a (C14): the bat `cylinder`, the plate `cube`, the installed spec `spec-3a5803641a71` and four bat keys.

`test/motion3/fixtures/cup-scene.mjs` holds the table group `empty` (top `cube`, legs `cube-2` to `cube-5`), the cup group `empty-2` under it (`cylinder`, handle `cube-6/7/8`) and `char-a` (Y Bot at the origin, yaw 0), with the ids and values of the baseline session.

## Amendment procedure

1. The lane stops and reports the change it needs and why.
2. Lane I lands a small amendment PR on `v3` that changes this file, the stub JSDoc and `test/motion3/verify-motion3-contracts.mjs` together.
3. Every lane rebases on `v3`.
