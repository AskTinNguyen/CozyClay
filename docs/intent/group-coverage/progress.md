# Group Coverage: Progress

- Working under rev: 1
- Worker: cloud worker agent (group-coverage)
- Current step: done; every item met or ready for review (A7 suite line below)
- Next step: orchestrator review (A4 ui:shot, A8 docs), PR
- PR: none yet

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met (gate) | `node test/verify-camera-cut-rules.mjs` -> `10 checks passed`, incl. "three people: the line is the pair the shots are about...", "...when the pair cannot be told the report says so...; two authored pairs are a line change", "three people, D2: a line change through a neutral shot or through an in-shot move is legal; the same cut straight across is flagged", "zero false flags: the group patterns over five blockings and two ranges cut clean". `camera.setLine` in `test/bus/verify-group-coverage.mjs` ok 5. Commit 3f0c61a5 |
| A2 | met (gate) | `node test/bus/verify-group-coverage.mjs` -> ok 1-5 (triangle 13 shots, group-singles 3 and 6, branching 3 branches, refusals, setLine + undo); shot counts, ranges, stacks, sides per pair, one undo entry, 0 cut flags. Commit 3f0c61a5 |
| A3 | met (gate) | `node test/verify-camera-coverage-check.mjs` -> `6 checks passed` (complete: triangle, group-singles, branching x2 and x3, master-coverage; gapped: no master, one size, line change without bridge, pair from both sides, branch missing/moved setup; every gap a technique stack; bus `camera.checkCoverage` read only). Commit 3f0c61a5 |
| A4 | met (ui:qa); ui:shot ready for review | `QA_CHROME_FLAGS='--no-sandbox --proxy-server=http://127.0.0.1:8444 --ignore-certificate-errors' COZYCLAY_LIVE_PORT=5309 CDP_PORT=9309 QA_URL=http://127.0.0.1:5209/app/ CHROME_PATH=/opt/pw-browsers/chromium QA_SHOT_DIR=docs/intent/group-coverage/proofs node tools/qa-browser.mjs -- node test/verify-group-coverage-browser.mjs` exit 0, "group coverage browser QA passed" (after the main merge too). Proofs: `docs/intent/group-coverage/proofs/coverage-group-controls.png`, `docs/intent/group-coverage/proofs/contact-triangle-dialogue.png`. Commits 15a15b5c, df04d8b5 |
| A5 | met (gate) | `node mcp/verify-camera-coverage.mjs` -> `21 passed, 0 failed`; `node test/verify-director-evals.mjs` -> core 86/86 (10 new core rows: 7 coverage, 3 cuts); `node mcp/verify-director-evals.mjs` -> `79 passed, 0 failed`; `node test/verify-camera-coverage-resolve.mjs` -> `5 checks passed`; MCP 33 tools (`mcp/verify.mjs`, tool-annotations, tool-handlers). Commit 9554e8b0 |
| A6 | met (gate) | `node test/bus/verify-sequence-prompt.mjs` -> ok 4 "with three cast the continuity line names each pair's line, byte-identical across runs". Commit 9554e8b0 |
| A7 | met (gate, known exception) | lint exit 0 (0 new / 0 violations / 0 regressions), build exit 0, `SUITE-ALL: 462 files, 459 passed, 3 failed`: the two timing checks plus a spawn timeout in verify-final-suite-compatibility that passes alone (Steps 6) |
| A8 | ready for review | `mcp/README.md` (33 tools, cover_scene group cast/branches, check_coverage row, line paragraph), `docs/agent-cli.md` (examples, group paragraph), `docs/studio-ui-ia.md` (cast checkboxes, Branches, Coverage check), `CHANGELOG.md` Unreleased > Camera. Commit e3e34a1e |

## Steps

1. A1-A3 core (3f0c61a5): `src/camera-coverage/cut-line.js` (D1 pair choice), `patterns-group.js`, `plan-group.js`, `completeness.js`, `src/commands/camera-coverage-group.js` (`camera.setLine`, `camera.checkCoverage`); cut rules judge per pair. Evidence in the table.
2. A5/A6 agents, evals, brief (9554e8b0): resolver rules, MCP `cover_scene` cast <= 6 + `branches`, `check_coverage`; 10 core eval rows; `continuity-group.js`.
3. A4 UI (15a15b5c): cast checkboxes, Branches, `CoverageReadout.jsx`; `test/verify-group-coverage-browser.mjs` registered in `tools/run-tests.mjs` BROWSER_FILES, `test/verify-camera-coverage-check.mjs` in NODE_FILES. QA needs the container's jsdelivr stub flags (worker-common).
4. A8 docs (e3e34a1e).
5. Merged origin/main 513ab7bf (df04d8b5): conflicts in CHANGELOG, CoveragePanel (FurtherReading + readout both kept), run-tests lists (both kept). Group patterns listed in `NO_REFERENCES.patterns` and the references generator count 71 -> 74 (F-1). Reran the key gates and the browser QA: all pass.
6. A7 gates: `npm run lint` exit 0 (knip 0 new, 1 fixed; loc 0 violations; eslint 0 regressions; no baseline changed); `npm run build` exit 0; suite (`env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_CA_BUNDLE node /home/claude/local-tools/suite-all.mjs --jobs 4`, after the main merge, no dev server): `SUITE-ALL: 462 files, 459 passed, 3 failed` - the two known timing checks (`test/motion3/verify-motion3-exitcar.mjs` 4896 ms CPU, `test/motion3/verify-motion3-repair.mjs` 22509 ms) and `test/bus/verify-final-suite-compatibility.mjs` (`spawnSync node ETIMEDOUT` under the shared-CPU load; rerun alone: `# fail 0`, exit 0).

## Decisions

- D1 as built: pair = authored `shot.line`, else the two subjects when they differ, else subject + gaze target (within 60 deg, a tie within 10 deg is unclear). Unclear is reported (`measures.line.unclear`), never guessed. Two different pairs across a cut are a line change (`measures.line.change`), not a crossing; the eyeline rule is skipped there.
- D2: sides are read at the cut frames only, so an in-shot move across the line is legal; a neutral (within 0.2 m of the line) or a cutaway shot clears a crossing in the coverage check.
- Group patterns live in `patterns-group.js`; `COVERAGE_PATTERNS` stays the six two-person ones (existing tests unchanged), `ALL_COVERAGE_PATTERNS` / `COVERAGE_PATTERN_IDS` span all.
- Each pair's side is outside the group (away from the others); a triangle tries the six member orders and keeps the first that cuts with 0 flags. A near-collinear trio can still raise an eyeline flag: a staging limit, reported by the plan's notes.
- `camera.setLine` is a single write, so its receipt has no `output`; matched words and confidence ride in `checks` (protocol checks schema extended additively).
- Group plans put brief cuts (no measures) in the receipt to stay under 8 KiB.
- Command registry 127 -> 129 actions; MCP 32 -> 33 tools. Studio agent prompt untouched (13,355 of 13,400): the new actions are reached through action descriptions and the router.
- Merge risks for camera-motivation: `test/bus/verify-command-registry.mjs` count, director-evals CAST (adds sela) and apply harness, `src/studio-agent-protocol.js` checks fields, `tools/run-tests.mjs` lists.

## Reconciliations
