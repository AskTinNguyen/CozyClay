# Intensity Curve: Progress

- Working under rev: 1
- Worker: cloud worker agent (intensity-curve)
- Current step: 2, docs (A7) and the repository gates (A6)
- Next step: merge origin/main when it moves (group-coverage #14), suite gate
- PR: none yet

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met (gate) | `node test/verify-intensity-curve.mjs` -> `# pass 4 # fail 0`: `PASS A1 master coverage climbs: 0.204 -> 0.391 -> 0.35 -> 0.49 -> 0.495`, `PASS A1 all-medium same lens is flat: 0.33 0.33 0.33 0.33` (cuts 0, 0, 0); seven components per shot and per cut; byte-identical JSON on a second run |
| A2 | met (gate) | same file: flat (the only rule without beats; its stack `medium-close-up {focalMm 50} + low-angle` applied through the bus breaks the run), peak-off-beat (reveal in the medium, peak in the close-ups), no-build (decision on Joon's medium under Mara's; an event asks for none unless named), each with frames and a technique-stack suggestion |
| A3 | ready for review (ui:qa passed, ui:shot) | `test/verify-intensity-curve-browser.mjs` exit 0, 17 PASS, `intensity curve browser QA passed` (step 1); shots `proofs/strip-flat.png`, `proofs/strip-master-coverage.png` |
| A4 | met (gate) | `node test/bus/verify-sequence-prompt.mjs` -> `# pass 5 # fail 0` (`STRUCTURE: intensity builds from 0.20 at beat 1 to a peak of 0.52 at beat 4 on 'the letter', then releases to 0.49 by beat 5.`, byte-identical); strip image dimensions in `test/verify-intensity-curve.mjs` (`PASS A4 strip image: 960x160, 400x80`) |
| A5 | met (gate) | `node mcp/verify-intensity-curve.mjs` -> `12 passed, 0 failed`; `node test/verify-director-evals.mjs` -> `structure: core 8/8`, `core: 99/99`; `node mcp/verify-director-evals.mjs` -> `87 passed, 0 failed`; `cclay live run camera.checkStructure` in the A3 QA run |
| A6 | open | |
| A7 | ready for review | `mcp/README.md` (35 tools, `check_structure` row, Intensity curve section), `docs/agent-cli.md` (Intensity curve), `docs/studio-ui-ia.md` (Structure section, Intensity strip), `CHANGELOG.md` Unreleased > Camera, `test/fixtures/director-evals/README.md` (structure.json, camera.checkStructure); step 2 |

## Steps

1. A1-A5, commit below. `src/intensity-curve/` (weights.js: the D1 data module, curve.js `sequenceIntensity`, structure.js `checkStructure` and `structureWords`, resolve.js, strip.js: one layout for the SVG strip and the RGBA image), `src/commands/camera-structure.js` (`camera.checkStructure`, read only; registry 133 -> 134 actions), router asks `resolveStructureRequest` after the motivation resolver, brief `STRUCTURE:` line before `CONTINUITY:`, MCP `check_structure` (`mcp/intensity-curve-tools.mjs`, 35 tools; `strip: true` adds the PNG), `test/fixtures/director-evals/structure.json` (8 core rows), the strip on the Shots lane (`src/motion/intensity-strip.jsx`, mounted line-neutral in timeline.jsx) and the Structure panel (Camera mode, below Motivation, Apply suggestion -> camera.applyTechnique).
   - Gates: `node test/verify-intensity-curve.mjs` `# pass 4 # fail 0`; `node test/bus/verify-sequence-prompt.mjs` `# pass 5 # fail 0`; `node mcp/verify-intensity-curve.mjs` `12 passed, 0 failed`; director evals `core: 99/99`; MCP evals `87 passed`; `mcp/verify.mjs` all checks passed (35 tools); `mcp/verify-tool-annotations.mjs`, `test/verify-tool-handlers.mjs`, `mcp/verify-live.mjs`, command registry / declarations (134), camera-motivation, coverage-resolve and motion3-prompt (prompt cap) exit 0. `npm run lint` -> `knip: 138 findings, 0 new`, `loc: ... 0 violations`, `eslint: ... 0 regressions`; `npm run build` built.
   - ui:qa: dev server `COZYCLAY_LIVE_PORT=5311 npm run dev -- --port 5211`; `COZYCLAY_LIVE_PORT=5311 QA_SHOT_DIR=docs/intent/intensity-curve/proofs QA_CHROME_FLAGS='--no-sandbox --proxy-server=http://127.0.0.1:8444 --ignore-certificate-errors' CDP_PORT=9311 QA_URL=http://127.0.0.1:5211/app/ CHROME_PATH=/opt/pw-browsers/chromium node tools/qa-browser.mjs -- node test/verify-intensity-curve-browser.mjs` -> exit 0, 17 PASS: SRS laid by `cclay live run camera.cover` flagged FLAT on the strip; `cclay live run camera.checkStructure` -> `flat words`, flat issue; the size toggle draws its line; Apply suggestion -> `Applied LOW · CU · 85mm to SRS 3 · OTS Mara`; curve `0.396 0.463 0.463 0.463 0.089 -> 0.396 0.463 0.562 0.437 0.089`, flag gone, hub re-check `No flat issue.`; master and coverage `0.204 0.371 0.35 0.49 0.495 0.104` with a reveal on CU Mara. Dev server stopped.

2. A7 docs, commit below: `mcp/README.md`, `docs/agent-cli.md`, `docs/studio-ui-ia.md`, `CHANGELOG.md`, the director-evals README. `node test/verify-mcp-invariants.mjs` exit 0.

## Decisions

- D1 module `src/intensity-curve/weights.js`: size (6 - rung) / 6 at 0.30; height |elevation from the eyes| / 45 deg at 0.10; lens ln(mm/18)/ln(135/18) at 0.15; movement max(m/s / 1.5, pan or tilt deg/s / 60, zoom mm/s / 30) at 0.15; cutting (6 - s) / 5 at 0.15; roll |deg| / 20 at 0.05; screen jump |dx| / 0.5 at 0.10. Size, height, lens and roll read both ends of a shot (the shot's value is their mean; the cut's jump is outgoing last frame to incoming first frame). Limits: flat 3+ shots with every cut under 0.08 total contrast; no-build needs a 0.03 rise over the shot before; peaks within 0.01 count as peaks.
- The strongest beat is by kind (threat, reveal, decision 3; disclosure 2; event, input 1), the later on a tie. "Follows" means the shot right after the beat's shot. A beat named by `beat` (or "build to X") gets the no-build rule whatever its kind.
- Suggestions: the issue's shot (the middle shot of a flat run, the beat's shot otherwise) one rung tighter on the next prime at least 1.2x its focal, plus low-angle unless already 10 deg below the eyes; shorter shots stay words (trim to about half when over 2 s), since no technique shortens a shot.
- No new Studio agent system prompt text: the action is reached through its description and the router (camera.applyTechnique's request routes to it), so the 13,400 cap holds.
- The strip draws with 2+ shots; the Shots track grows by 40 px only while it is drawn (CSS `:has`), so the timeline is unchanged for a single shot. The component toggles are page-wide (one strip).

## Reconciliations
