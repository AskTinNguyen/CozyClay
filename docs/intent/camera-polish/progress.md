# Camera Polish: Progress

- Working under rev: 2
- Worker: control session (implements directly)
- Current step: all met
- Next step: merge
- PR: https://github.com/AskTinNguyen/CozyClay/pull/9

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | `node test/verify-camera-blur-sweep.mjs` -> `6 checks passed (camera-polish A1 blur sweep)` (after the review fix 2d42e7e5, which adds the smear-direction check): `whip 38.8° at 27° fov: sweep 1.44 frames, 96 sub-renders; medium 8°: 36`, slow and held keep 24, preview caps at 32; yaw and pitch smears add up to the sweep and each sub-render sits mid-slice spanning it; a held camera and depth of field alone carry no smear; two plans deep-equal. ui:shot: `proofs/whip-pan-blur-after.png` (this branch) beside `proofs/whip-pan-blur-before.png` (camera-capabilities), the same `test/qa-camera-capabilities-live-browser.mjs` run (`camera capabilities live path QA passed`). |
| A2 | met | `node test/verify-camera-dirty-ots.mjs` -> `9 checks passed (camera-polish A2 dirty OTS)`: 1.4 m and 2.4 m apart, right and left, 35 and 50 mm: eyes at ±0.33, 0.33 NDC, modelled shoulder 36 % from the near edge, its top in the lower half, the camera behind the listener within 1 m; automatic lens `46.4 mm` (shoulder 0.36). `node test/bus/verify-camera-coverage.mjs` -> `pass 4, fail 0` (every pattern's cuts clean, the camera behind the listener). ui:shot: `proofs/ots-mara.png`, `proofs/ots-joon.png` (live `camera.cover` shot-reverse-shot; `camera.checkCuts` reads the cut at 96 clean). |
| A3 | met | `node test/verify-camera-walk-bob.mjs` -> `6 checks passed (camera-polish A3 walk bob)`: the camera follows the hips within 1 mm a frame (1.576 / 1.516 m at the top and bottom of a step), the face still in frame while the set shifts 0.056 NDC, scale scales the bob, proxy / no take / no hips track stay level, a session take bobs too; on a compiled walk `walked to (-1.19, -4.97), heading 180° -> 180°, heading twist 1.13°, face spread 0.0000 NDC, bob 1.9 cm`. ui:shot: `proofs/snorricam-bob-f103.png` (hips lowest) and `proofs/snorricam-bob-f113.png` (highest), live `motion.compile` walk (`qa.ok`) + `camera.applyTechnique ["snorricam"]`. |
| A4 | met | Receipts and earlier camera files: `test/verify-camera-techniques.mjs` `12 checks passed`; `test/bus/verify-camera-techniques-apply.mjs` `pass 5, fail 0` (the OTS camera behind actor-b, looking at actor-a); `test/verify-camera-technique-prompt.mjs` `6 checks passed`; `test/bus/verify-camera-coverage.mjs` `pass 4, fail 0`; `test/bus/verify-camera-composition.mjs` `pass 3`; `test/verify-camera-cut-rules.mjs` `6 checks passed`; `test/bus/verify-camera-transitions.mjs` `pass 5`; `test/verify-camera-coverage-resolve.mjs` `5 checks passed`; `mcp/verify-camera-techniques.mjs` and `mcp/verify-camera-coverage.mjs` `14 passed, 0 failed`; `test/bus/verify-camera-capability-techniques.mjs` `pass 3` (snorricam receipt `mountBone chest`); `test/verify-camera-mount.mjs`, `-focus`, `-speed`, `-shake`, `-roll` pass; all again inside the A5 run. |
| A5 | met (known exception) | `npm run lint` exit 0 (`knip: 138 findings, 0 new`, `loc: 72 files over 250 (baseline 72), 0 violations`, `eslint: 396 errors across 20 rules (baseline 403), 0 regressions`); `npm run build` exit 0; `node tools/run-tests.mjs --jobs 4` (Git Bash, no dev server) stopped at the known `FAIL exit car, hips sunk: under 10 s — 11686 ms`; every RUN file then run to the end, 4 at a time: `files 457, ok 456, failed 1`, the only failure that same check (`— 10881 ms`). No change to `tools/*-baseline.json` or the frozen motion files. |
| A6 | met (review) | `CHANGELOG.md` Unreleased › Camera; camera-capabilities and camera-coverage residual-risk lines point here. |

## Steps

- S1 (rev 1, 955b2cef): A1. `lensPlan` measures the shutter's sweep (`blurSweep`), raises the sub-render count with it up to `maxSamples`, and gives each blur sub-render its slice of the shutter as `smear`; `lens-render.js` passes caps (preview 32, capture 96) and averages 8 taps along each smear.
- S2 (rev 1, 2ca91e30): A2. `shoulderFraming` steps back until the shoulder's top is in frame and slides across the back (bisection) until the shoulder covers the target share, aimed with composition's `aimFraming` so the eyes land on the far third. The existing "within 1 m of the listener" assertions in `verify-camera-techniques-apply` and `verify-camera-coverage` hold unchanged (lens height 1.55 m, shoulder top down to -0.75 NDC).
- S3 (rev 1, 1c8bb5af): A3 first cut, the hips' rise on the mount and face point.
- S4 (rev 1, live): the live proof found F-1 (the mount stayed at the start of a v3 walk). Fixed: the mount rides the take's hips path and heading, stride-averaged (b9cc2170 and the commits before it).
- S5 (rev 2, f8071156): F-2, cover 0.36; proofs captured through `tools/headless-studio.mjs` on slot 6 (`cclay live run motion.compile`, `camera.applyTechnique`, `camera.cover`, `operate --frame`, `capture --out`), and the capabilities QA script on a slot-6 dev server for the whip pan.

- S6 (rev 2): gates, evidence in A4 and A5.
- S7 (rev 2, 2d42e7e5): Codex P2, the smear's pitch sign; `smearUv` plus a direction check; lint and build exit 0.

## Reconciliations

- rev 1 -> 2: A1-A3 evidence still valid (D5 and D6 only refine A2's range and A3's mount, both re-verified above).
