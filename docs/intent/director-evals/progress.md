# Director Evals: Progress

- Working under rev: 1
- Worker: cloud worker agent (director-evals)
- Current step: 3. repository gates (A8)
- Next step: report
- PR: orchestrator opens on report

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | Step 1: 75 scenarios in `test/fixtures/director-evals/*.json`, 8 categories, each at least 8 rows; `node test/verify-director-evals.mjs` "ok - schema: 75 scenarios, 8 categories (size 10, angle 9, move 11, lens 8, coverage 9, composition 9, cuts 8, negative 11), ids and requests unique" (plus a schema self-check on broken rows) |
| A2 | met | Step 1: one line per category plus `core: 74/74  stretch: 0/1 (failing: cuts-jump-the-line)  total: 74/75`, exit 0; exits 1 on a core failure (62/74 on the pre-fix resolvers, step 1); registered in `tools/run-tests.mjs` (`--list`: "RUN node test/verify-director-evals.mjs") |
| A3 | met | Step 1: 46 rows marked `apply` run through the bus in memory (`test/director-evals-apply.mjs` on `test/bus/shots-fixture.mjs`): "applied: 46/46 measured results hold through the bus" (move verdict, size step, camera height, side of the line, composition by `measureComposition` on every key, `camera.checkCuts` flags) |
| A4 | met | Step 1: "negatives: 11/11 resolve to no camera action, 3 refused by the bus"; "receipts: 75/75 state their matched words and a confidence"; bus receipts carry `output.matched` and `output.confidence` (checked on every applied row) |
| A5 | met | Step 1: 12 core failures fixed (list below); `core: 74/74`; existing resolver verify files pass (step 1) |
| A6 | met | Step 2: `node mcp/verify-director-evals.mjs` exit 0, "67 passed, 0 failed": 65 core rows (all but composition rows) through `apply_camera_technique` 49, `cover_scene` 9, `check_cuts` 7, each `resolved` line equal to the runner's `routeCameraRequest` (action, ids, pattern, frame, matched words, confidence) and to the row |
| A7 | ready for review | `test/fixtures/director-evals/README.md` (row format, `apply` measures, adding rows, when stretch moves to core) |
| A8 | open | |
| A9 | ready for review | `CHANGELOG.md` Unreleased (Director evals line); `mcp/README.md` "Camera requests in words" (the `resolved` line, `output.matched` / `output.confidence`, the non-camera refusal) |

## Steps

### Step 1: eval data, runner, applied outcomes, resolver fixes (A1-A5)

- Data: `test/fixtures/director-evals/{size,angle,move,lens,coverage,composition,cuts,negative}.json`, one row per line, in CozyClay's own words. Cast: Mara and Joon facing each other 4 m apart (`CAST` in `test/director-evals-data.mjs`).
- Router: `src/camera-coverage/route.js` `routeCameraRequest` (new): coverage, composition and cut words first, then the technique stack; a non-camera "shot" (drinks, gunshots, medical, sports, turns of phrase, after the cinematic-atlas generator's false-positive idea, rewritten) names no action unless a camera word sits beside it; every answer carries `matched` and `confidence` (high: named outright; medium: a spelling slip or a cut word without a question; low: a mood). `camera.applyTechnique` now routes through it and refuses a non-camera request with the words and confidence (`INVALID_ARGUMENT`); its receipt, `camera.cover`'s and `camera.checkCuts`' state `output.matched` and `output.confidence`.
- Runner: `test/verify-director-evals.mjs` (schema, resolution, receipts, applied outcome), helpers `test/director-evals-data.mjs`, `test/director-evals-apply.mjs`.
- Resolver fixes (A5), each with the core scenario that exposed it. Pre-fix run (route.js on the old resolvers): `core: 62/74`, these 12 failing:
  1. Everyday words left after dropping "shot" no longer name a technique (`EVERYDAY` in `src/camera-techniques/resolve.js`: floor, head, two, full, still, cover, ...): angle-dutch-spin, angle-gods-eye-tiles, lens-zolly-floor, move-360-joon.
  2. A spelling slip keeps the word's first letter ("right", "fight" are not "tight"; "best" not "bust"): comp-right-third, cover-fight, neg-best-shot.
  3. "Cover the fight / chase" name action coverage (`src/camera-coverage/patterns.js` aliases): cover-fight.
  4. Lead room "as she walks / runs / moves" is travel lead room (`src/camera-coverage/resolve.js`): comp-lead-walks.
  5. Non-camera shots resolve to no action instead of a mood technique (route.js): neg-gunshot-panic, neg-flu-weak, neg-was-shot, neg-best-shot.
  6. "slower" / "faster" set the speed (`SPEED_WORDS`): lens-dolly-zoom-slower (was stretch, passes now, moved to core per D1).
  - Also from the set: size-in-close passed once "close" was kept as a word (it was in the first `EVERYDAY` draft), so it moved to core (D1). Composition words are stripped before the technique parse, so "tight headroom" is not a tight shot (comp-tight-headroom).
- Engineering decisions: the bus fixture's loaded rigs answer to `actor-a` / `actor-b`, so the apply helper maps Mara and Joon onto them. Cut rows run `camera.checkCuts { request }` directly (findings F-1). Expected moves are the classifier's ids (`pan-left` for the whip pan on Joon, `tilt-up`, `orbit`, `zoom-in`), and comp-more-lead-joon expects the eyes at 0.275 because Joon's medium is laid from the far side of the line, where he faces frame right.
- Evidence (worktree, before the commit):
  - `node test/verify-director-evals.mjs`: exit 0; `core: 74/74  stretch: 0/1 (failing: cuts-jump-the-line)  total: 74/75`; `applied: 46/46 measured results hold through the bus`; `negatives: 11/11 resolve to no camera action, 3 refused by the bus`; `receipts: 75/75 state their matched words and a confidence`.
  - Existing resolver and camera files, each exit 0: `test/verify-camera-techniques.mjs` "12 checks passed", `test/verify-camera-coverage-resolve.mjs` "5 checks passed", `test/verify-camera-cut-rules.mjs` "6 checks passed", `test/verify-camera-technique-prompt.mjs` "6 checks passed", `test/bus/verify-camera-coverage.mjs` "# pass 4 # fail 0", `test/bus/verify-camera-composition.mjs` "# pass 3 # fail 0", `test/bus/verify-camera-techniques-apply.mjs` "# pass 5 # fail 0", `test/bus/verify-camera-transitions.mjs` "# pass 5 # fail 0", `test/bus/verify-camera-capability-techniques.mjs` "# pass 3 # fail 0", `mcp/verify-camera-techniques.mjs` "14 passed, 0 failed", `mcp/verify-camera-coverage.mjs` "14 passed, 0 failed", `mcp/verify-camera-capabilities.mjs` "9 passed, 0 failed".
  - `npm run lint`: "knip: 138 findings, 0 new, 1 fixed (baseline 139)", "loc: 72 files over 250 (baseline 72), 0 violations", "eslint: 396 errors across 20 rules (baseline 403), 0 regressions".
- Merged `origin/main` (b975c55, camera-polish) into the branch before this step.
- Commit: `5cfd3f1a` (pushed to `origin/intent/director-evals`).

### Step 2: MCP parity, docs (A6, A7, A9)

- `apply_camera_technique` (in memory) routes its request through `routeCameraRequest`: a non-camera request answers "No camera action in ...", a coverage or cut request names the tool to use, and every answer ends with `resolved  <action> <ids|pattern|frame> · matched "..." · confidence <level>` (`resolvedLine`, `mcp/camera-technique-tools.mjs`). `cover_scene` and `check_cuts` (in memory) end with the same line when given a request. Editor-connected answers are the editor's receipts (step 1: `output.matched`, `output.confidence`).
- `mcp/verify-director-evals.mjs` (new, registered in `tools/run-tests.mjs`): the eval cast in memory, then every core row except composition rows (in memory there is no shot to compose) through its tool.
- Docs: `test/fixtures/director-evals/README.md` (A7), `CHANGELOG.md` Unreleased and `mcp/README.md` "Camera requests in words" (A9).
- Evidence (worktree): `node mcp/verify-director-evals.mjs` exit 0 "67 passed, 0 failed" ("at least 10 scenarios ran through the MCP tools (apply_camera_technique 49, cover_scene 9, check_cuts 7)"); `mcp/verify.mjs` exit 0 "all checks passed"; `mcp/verify-tool-annotations.mjs` exit 0 "PASS G005 tools/list safety contract (32 tools; deterministic order)"; `mcp/verify-camera-techniques.mjs` "14 passed, 0 failed"; `mcp/verify-camera-coverage.mjs` "14 passed, 0 failed"; `mcp/verify-render-prompt-sequence.mjs` "18 passed, 0 failed".

## Reconciliations
