# Shot Prompt Engine: Progress

- Working under rev: 1
- Worker: `shot-prompt-engine-worker`
- Current step: 5. A4 reference manifest and pack files
- Next step: 6. A6 MCP render_prompt scope/profile, live, agent prompt budget
- PR: none yet

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | `node test/bus/verify-sequence-prompt.mjs` -> `PASS A1 brief: 5 beats, 3451 characters`, `PASS A1 ranges: from/to and shotIds`, `pass 2 fail 0` (fixture from `camera.cover` master-coverage, push-in, dissolve, roll; byte-identical second run) |
| A2 | met | `node test/bus/verify-sequence-measure.mjs` -> `PASS A2 measured camera` (push-in `travels 6.24 m at 3.19 m/s`, pan `pans right 45° at 37.2°/s`, dolly zoom `focal 64 to 28.8 mm (-35.2 mm)`, whip pan `pans left 77.6° at 372.4°/s`, held `holds still for 2s`), `PASS A2 roll and focus`, `pass 2 fail 0` |
| A3 | met | `node test/bus/verify-sequence-motion-beats.mjs` -> `PASS A3 motion beats: walk-start f27, walk-end f83, turn f111, jump f155, land f166, grab f34, release f80` (known f26, f82, f110, f155, f166, f34, f80; all within 2), `PASS A3 brief actions: ...`, `pass 2 fail 0` |
| A4 | open | |
| A5 | open | `node test/bus/verify-sequence-profiles.mjs` -> `pass 3 fail 0`; facts in F-1. Waits for the A8 suite run |
| A6 | open | |
| A7 | open | |
| A8 | open | |
| A9 | open | |

## Steps

0. Setup (95dde06f): `npm ci`, `npm --prefix mcp ci` -> exit 0. Baseline `npm run lint` -> `knip: 138 findings, 0 new, 1 fixed (baseline 139)`, `loc: 72 files over 250 (baseline 72), 0 violations`, `eslint: 396 errors across 20 rules (baseline 403), 0 regressions`.
1. A5 profiles: `src/model-presets.js` refreshed (Kling 3.0, Veo 3.1 4/6/8 s, MiniMax H3 hosted 15 s, Seedance 2.5 4-30 s; `checkedAt`, `sources`, `unverified`; old ids `kling-2`/`veo-3` read as their successors, also in `shot-authoring.js`); `src/model-profiles.js` (phrasing, clip grouping, warnings with fixes). `node test/bus/verify-sequence-profiles.mjs` -> `PASS A5 profiles ...`, `PASS A5 warnings: split, trim, extend, whole seconds, too short, too long, aspect`, `PASS A5 brief shaping: kling 3640 chars, veo 5 warnings, h3 tags, aspect 9:16/2.39:1`. Updated `node test/verify-model-presets.mjs` -> `PASS model presets: inventory, grids and checkShotAgainstPreset verified`; `node test/verify-shot-meta.mjs` -> `PASS shot meta: targetModel feeds checkShotAgainstPreset directly`.
2. A2 measured camera: `src/shot-prompt-engine/measure.js` (every frame through `sampleAt`, rail fallback, shake left out). Evidence in the table.
3. A1 sequence brief: `src/shot-prompt-engine/{sequence,beat,continuity,references,motion-beats}.js`, fixture `test/bus/sequence-fixture.mjs`. Evidence in the table. Related suites still pass: `verify-shot-prompt`, `verify-camera-technique-prompt`, `verify-shot-authoring`, `test/bus/verify-camera-transitions`, `test/bus/verify-camera-coverage`.
4. A3 motion beats: `src/shot-prompt-engine/motion-beats.js` (walk from the timeline's planted runs, reach/grab/release from its events and the spec's objects, turns from the baked take's hips heading, jump/landing from `observations.balance.air`), `src/shot-prompt-engine/document.js` (`takeYaw`, `motionEntry`, `sequenceDocument`). Frozen files only imported (`pipeline.js` compileSpec in the test), never edited. Evidence in the table.

## Decisions

- The engine lives in `src/shot-prompt-engine/` (pure, one module per concern, each under 250 lines); profile phrasing in `src/model-profiles.js` beside the limits (D2).
- Measured numbers use the exact sampled focal length; a technique's words keep the slate's nearest prime (shot.js `nearestPrime`), so the Frame line says both (`40 mm, normal (slated 35mm)`).
- Kling 2.0 and Veo 3 ids are aliases, not removed, so stored `targetModel` values survive (read as `kling-3` / `veo-3.1`).
- A take plays from timeline frame 0 (`startFrame` 0); take edits (`take-edit.js` segments) are not remapped in this intent.
- MiniMax H3: the hosted API (15 s) is a new preset; the self-hosted 10 s preset stays, marked unverified (F-1).

## Reconciliations
