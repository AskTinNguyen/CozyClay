# Director Evals

- Rev: 1
- Status: planned
- Waits for: the owner's go-ahead. First of the cinematic-atlas plan; every later intent in it adds scenarios here.
- Area: Camera and Shots
- Owner: TinNguyen
- Skill: `none`
- Branch: `intent/director-evals`
- Worktree: `../CozyClay-wt/director-evals`, port slot n=7 (dev 5207, live hub 5307, CDP 9307)

## Goal

Proposal 1 of the cinematic-atlas review (L-1). The owner's cinematic-atlas study site poses directing problems as scenarios: a wide that pushes toward one character during a secret admission, a branching conversation that needs edit-safe coverage, a chase whose screen direction must hold. CozyClay's director layer turns requests like these into camera actions:

- `parseRequest` / `resolveTechnique` in `src/camera-techniques/resolve.js`;
- `resolveCameraRequest` / `parseComposition` in `src/camera-coverage/resolve.js`;
- the bus actions `camera.applyTechnique`, `camera.cover` and `camera.checkCuts`.

Today that layer is tested on a handful of phrases per intent (`test/verify-camera-coverage-resolve.mjs`, `test/verify-camera-techniques.mjs`). This intent builds a scenario eval set in a director's words, each scenario with the expected resolution and, where it applies, the expected measured result in the document. Later intents add scenarios, so it guards everything after it.

## Non-Goals

- Calling an LLM or a paid API. The evals drive the deterministic resolvers and the bus in memory.
- New camera features. Resolver fixes that the eval set exposes are in scope; new techniques or patterns are not.
- Copying the atlas quizzes. The scenarios are CozyClay's own words.

## Decisions

- D1 (rev 1): two tiers. `core` scenarios must all pass (a gate). `stretch` scenarios are reported as a score with the failing ids listed, and are not a gate. A stretch scenario moves to core when it passes. Source: orchestrator.
- D2 (rev 1): scenarios are data (`test/fixtures/director-evals/*.json`), not code, so later intents add rows without touching the runner. Source: orchestrator.

## Acceptance

- A1: Eval data. At least 60 scenarios across these categories: shot size and intimacy, angle and power, motivated moves, lens, coverage patterns, composition, cut checks, and negatives (a non-camera "shot": a drink, a gunshot, a basketball shot). Each scenario has an `id`, a `request`, the `cast`, a `tier`, a `category`, the `expected` resolution (action, technique ids, pattern, composition, cut rule, or `none`), and a one-line `why` in CozyClay's words. Every category has at least 5 rows, and no request repeats. Proof: gate: `node test/verify-director-evals.mjs` schema pass line.
- A2: Runner. `node test/verify-director-evals.mjs` resolves every scenario and prints one result line per category plus a total. It exits non-zero when any core scenario fails, and lists the failing stretch ids. It is registered in `tools/run-tests.mjs`. Proof: gate: the runner's result lines with `core: N/N`.
- A3: Applied outcome. Scenarios marked `apply` are applied on a fixture scene through the bus in memory. The runner asserts the measured result, not only the resolved name:
  - the move classifier verdict (`checks.moveVerified`);
  - the size step;
  - the side of the line;
  - the composition within tolerance (`measureComposition`);
  - the `camera.checkCuts` flags.

  Proof: gate: runner lines for the applied scenarios.
- A4: Negatives and evidence. Non-camera uses of "shot" resolve to no camera action, following the atlas generator's explicit false-positive list (rewritten). Every receipt states the words it matched and a confidence (`high`, `medium`, `low`). Proof: gate: runner negatives line and a receipt check.
- A5: Resolver fixes. Every core failure found while writing the set is fixed in the resolvers, and each fix is listed in `progress.md` with its scenario id. Proof: gate: `core: N/N`, plus the existing resolver verify files still passing.
- A6: Live parity. At least 10 scenarios run through the MCP tools in memory (`apply_camera_technique`, `cover_scene`, `check_cuts`) and give the same resolution as the runner. Proof: gate: `node mcp/verify-director-evals.mjs`.
- A7: Authoring note. `test/fixtures/director-evals/README.md` says how a later intent adds scenarios and when a stretch row moves to core. Proof: review.
- A8: The repository gates hold. Proof: gate: `npm run lint` (no baseline raised), `npm run build`, and `node tools/run-tests.mjs --jobs 4` from Git Bash with no dev server running, under the contract's known exception.
- A9: Docs updated: `CHANGELOG.md` Unreleased; `mcp/README.md` if a tool's receipt changes. Proof: review.

## Constraints

- `CLAUDE.md`: the 250-line ratchet, knip and eslint baselines; new files stay under 250 lines.
- Edits go through the command bus; never write domain stores directly.
- Do not change the frozen motion files.
- Keep the owner's own studio on ports 5180 / 5184 untouched; use slot n=7.
- Keep the branch merged with `origin/main` and pushed after every step (contract, Git And Merge).
- Source material: the owner's cinematic-atlas repo (a local study site over published film-directing books) is reference only. No book text, page images, PDFs or quiz wording is committed or quoted (contract Never list).

## Changelog

- rev 1 (2026-10-24): written as a planned intent from the cinematic-atlas review (L-1, L-2).
