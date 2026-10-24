# Colour Script: Progress

- Working under rev: 1
- Worker: cloud worker agent (colour-script)
- Current step: 4, the suite gate (A8)
- Next step: review; merge origin/main when depth-staging (#17) lands, keeping both sides
- PR: none yet

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met (proof file per F-1) | `node test/verify-shot-look-merge.mjs`: pass 4 fail 0 (merge, frames, dissolve blend, older documents unchanged). The A7 browser run: Dialogue capture warmth -0.003 -> 0.119 with warm-safety, Exchange unchanged. |
| A2 | met | `node test/verify-palette-measure.mjs`: pass 3 fail 0. |
| A3 | met | `node test/verify-colour-script.mjs` A3 (columns, beats, 960x200 picture, packet colour check, `packet/colour-script.png` in packetFiles and index.html): pass. ui:shot `proofs/colour-script-warm-to-cold.png` (6 shots, hard measured cuts into 4 and 6). |
| A4 | met | `node mcp/verify-shot-look.mjs`: 16 passed, 0 failed. `node test/verify-director-evals.mjs`: look core 9/9; core 118/118. |
| A5 | met | `node test/bus/verify-sequence-prompt.mjs`: pass 7 fail 0 (byte-identical, profiles unaffected). |
| A6 | met | `node test/verify-colour-script.mjs`: constructed hard and soft cut, tone component (INTENSITY_VERSION 2 with looks, v1 path without): pass 3 fail 0. |
| A7 | met | ui:qa `test/verify-colour-script-browser.mjs` via tools/qa-browser.mjs on slot 13: 21 PASS, 0 FAIL. ui:shot `proofs/look-panel-warm-safety.png`. |
| A8 | pending | suite running |
| A9 | review | mcp/README.md, docs/agent-cli.md, docs/studio-ui-ia.md, CHANGELOG.md Unreleased, director-evals README (f46d700f). |

## Steps

1. 752f1feb: shot look (merge, preview, export relight), measured palette, recipes, colour script, resolver, shot.setLook / shot.colourScript, Look panel, File > Export > Colour script, MCP shot_look, sequence brief Look lines, tone component, packet colour check and picture, 9 eval rows. Evidence: the gates in A1-A6; lint knip 138 (1 fixed), loc 0 violations, eslint 0 regressions; build ok.
2. 603df496: browser QA (A7). Found and fixed: the Look panel measured a just-picked recipe before the 3D tree re-rendered (the scene's props lag the DOM by seconds under software GL), so shot.colourScript renders inside withDrawShots(document.shots) and the export draw compares the look's content; the Look section overflowed the sidebar (grid column pinned). 21 PASS, 0 FAIL; two proof shots.
3. f46d700f: docs (A9). `node test/motion3/verify-motion3-prompt.mjs`: all checks passed (prompt cap holds).

## Decisions

- The tone component joins the intensity curve only when a shot has a look (or tones are passed); INTENSITY_VERSION is 2, and a sequence without looks scores as before.
- The packet's `colour` check is present only when a shot has a look; a hard colour cut is a low-severity flag.
- An export frame relights the tagged lights, background, fog colour, exposure, haze and environment strength; the environment map and AO pass stay those of the look on screen.
- A preset look keeps the stage's HDR environment (applyLightingRecipe skips lighting.hdr).

## Reconciliations
