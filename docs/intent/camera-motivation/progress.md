# Camera Motivation: Progress

- Working under rev: 2
- Worker: cloud worker agent (camera-motivation)
- Current step: done; every acceptance row met or ready for review
- Next step: orchestrator review of A5 shots and A9 docs; PR
- PR: https://github.com/AskTinNguyen/CozyClay/pull/13

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met (gate) | `node test/bus/verify-story-beats.mjs` -> `# pass 3 # fail 0` (story.addBeat / moveBeat / removeBeat one undo each; documents without beats load and save unchanged; OTIO `Marker.2` per beat; brief `Story` lines at delivery timecodes). Timeline ticks: A5 QA `the timeline draws the beat` |
| A2 | met (gate) | `node test/verify-camera-motivation.mjs` -> `# pass 3 # fail 0` (unmotivated high; starts-off-beat medium at 20 frames, low at 10; clean within tolerance; motion-beat take-off and landing, settles-off-beat with "settle on the landing at f166"; fixes carry camera.alignMove args) |
| A3 | met (gate) | same file: every camera.cover pattern 0 issues, follow cam of a walking subject 0, keyed tracking and pan-with 0; `PASS A3 flag: The push over f38-76 has no story beat, motion beat or travelling subject to answer to.` |
| A4 | met (gate) | `node test/bus/verify-camera-align-move.mjs` -> `# pass 3 # fail 0` (100-140 -> 120-160 one undo, re-check clean; request form; settle squeezed at the shot edge; rig keys; technique kept; refusals) |
| A5 | met (ui:qa, ui:shot reviewed R1) | `test/verify-camera-motivation-browser.mjs` exit 0, `camera motivation browser QA passed` (step 4); shots `proofs/timeline-flagged-move.png`, `proofs/timeline-fixed-move.png` |
| A6 | met (gate) | `node mcp/verify-camera-motivation.mjs` -> `12 passed, 0 failed`; `node test/verify-director-evals.mjs` -> `core: 91/91` (motivation core 15/15; stretch miss `cuts-jump-the-line` pre-existing); `node mcp/verify-director-evals.mjs` -> `79 passed, 0 failed`; `cclay live run camera.checkMotivation` in the A5 QA run |
| A7 | met (gate) | `node test/bus/verify-sequence-prompt.mjs` -> `# pass 4 # fail 0` (`Motive: the camera pushes in as Mara makes her admission.`; walk-and-talk `tracks with Mara`; byte-identical across runs) |
| A8 | met (gate) | step 7: `npm run lint` 0 new / 0 violations / 0 regressions; `npm run build` built; `SUITE-ALL: 464 files, 461 passed, 3 failed` with only CPU-timing failures (exitcar, repair as in the base; motion3-life "critic is cheap" 255 ms vs 250 ms, passes alone) |
| A9 | met (review R1) | `mcp/README.md` (34 tools, `check_motivation` / `story_beats` rows, Camera motivation section), `docs/agent-cli.md` (Camera motivation), `docs/studio-ui-ia.md` (Motivation section, Shots lane marks), `CHANGELOG.md` Unreleased > Camera; 3f3669d5 |

## Steps

1. A1-A4 core, 6a1f1068: `src/camera-motivation/` (story-beats, segments, check, align, resolve), `src/commands/camera-motivation.js` (story.addBeat / moveBeat / removeBeat, camera.checkMotivation, camera.alignMove; registry 127 -> 132 actions), storyBeats on the shot document (absent when empty), OTIO markers, brief Story lines. Gates as in A1-A4.
2. A6/A7 agents and brief, c35faafd: MCP `check_motivation` and `story_beats` (`mcp/camera-motivation-tools.mjs`, 34 tools), 15 core motivation eval rows (`test/fixtures/director-evals/motivation.json`), router asks `resolveMotivationRequest` first, `Motive:` lines in the sequence brief. `npm run lint` -> `knip: 138 findings, 0 new`, `loc: ... 0 violations`, `eslint: ... 0 regressions`; `mcp/verify-live.mjs` exit 0.
3. A5 controls, 305da039: `src/motion/motivation-marks.jsx` (story beat ticks and NO MOTIVE / OFF BEAT bars on the Shots lane, mounted line-neutral in timeline.jsx), `src/panels/MotivationPanel.jsx` (Camera mode, below Cut: add beat at the playhead, beat list, each move's reason, Apply fix -> camera.alignMove).
4. A5 ui:qa: dev server `COZYCLAY_LIVE_PORT=5308 npm run dev -- --port 5208`; `COZYCLAY_LIVE_PORT=5308 QA_SHOT_DIR=docs/intent/camera-motivation/proofs QA_CHROME_FLAGS='--no-sandbox --proxy-server=http://127.0.0.1:8444 --ignore-certificate-errors' CDP_PORT=9308 QA_URL=http://127.0.0.1:5208/app/ CHROME_PATH=/opt/pw-browsers/chromium node tools/qa-browser.mjs -- node test/verify-camera-motivation-browser.mjs` -> exit 0, 15 PASS, `camera motivation browser QA passed` (beat added from the panel at f60; push-in laid by `cclay live run camera.applyTechnique`; flag `starts-off-beat` on the lane and in the panel; `cclay live run camera.checkMotivation` -> 1 issue; Apply fix -> `Started the move in Dialogue [0, 192) on 'Mara makes her admission' at f60: f0-191 -> f60-191; re-check clean.`; live document keys start at 60; hub re-check `every move has its reason`). Shots: `proofs/timeline-flagged-move.png` (OFF BEAT bar under the Dialogue block, beat tick at 60, panel readout with Apply fix), `proofs/timeline-fixed-move.png`. Dev server stopped.
5. A9 docs, 3f3669d5. `npm run build` -> `built`, `sitemap: 6 urls`.
6. Merged origin/main 513ab7bf (#11 router fix, #12 technique-references), c8da09fe: conflicts only in the `tools/run-tests.mjs` manifest lines and `CHANGELOG.md` (both kept). Re-ran: director evals `core: 91/91`, MCP evals `79 passed`, `mcp/verify-camera-motivation.mjs` 12 passed, align-move and motivation pass, `mcp/verify.mjs` all checks passed, tool annotations / handlers 34 tools, technique-references 6 checks, mcp camera-techniques 19 passed; lint 0 new / 0 violations / 0 regressions.
7. A8 gate on c8da09fe, no dev server running: `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_CA_BUNDLE node /home/claude/local-tools/suite-all.mjs --jobs 4` -> `SUITE-ALL: 464 files, 461 passed, 3 failed`: `test/motion3/verify-motion3-exitcar.mjs` (`compile + QA stay fast (< 3 s CPU)`, 4515 ms) and `test/motion3/verify-motion3-repair.mjs` (the under-10 s checks), both the base's known timing failures, and `test/motion3/verify-motion3-life.mjs` (`the critic is cheap ... under 250 ms` at 255 ms, while another worker's suite shared the CPU); rerun alone `node test/motion3/verify-motion3-life.mjs` -> exit 0, `motion3 life: all checks passed`. No motion3 file is touched by this branch.

## Decisions

- Story beats live on the shot document as `storyBeats` (absent when empty, so older documents round-trip unchanged); ids are deterministic (`story-beat-N`).
- The subject is judged before beats: a follow, mount or rail camera, a stored tracking / walk-and-talk stack, or a camera keeping a travelling subject (>= 0.3 m) counts as motivated by its subject.
- Tolerance defaults to 6 frames; a settle beat may sit up to 2 x tolerance past the move's end; severity medium past 3 x tolerance, else low; unmotivated is high for a big move (>= 0.3 m, 5 deg or 5 mm), else medium.
- camera.alignMove keeps the move's length (squeezed at a shot edge), drops hold keys the move slides over, refuses rail and follow cameras and overlaps, and keeps a current technique stack current.
- No new Studio agent system prompt text: the actions are reached through their descriptions and the router. MCP reaches camera.alignMove through `studio_run` (live only).
- The timeline and panel compute the check in the page (same `checkMotivation` over `studioSequenceDocument`, takes cached), placing the cast from its authored layer; the bus action samples the evaluated state per frame. Both agreed in the A5 run.

## Reconciliations

## Reviews

- R1 (cloud orchestrator, 2026-10-24, at 30751aee): opened `proofs/timeline-flagged-move.png`. The Dialogue shot (0-191, MS, PUSH-IN) carries an orange OFF BEAT bar on the timeline, with the beat tick "Mara makes her admis..." at f60. The Motivation section lists the beat, shows "1 moves, 1 flagged", and the medium issue "Starts off the beat" reads "Fix: start the push at f60 on 'Mara makes her admission'" with Apply fix. `proofs/timeline-fixed-move.png` is after the fix: no bar, "1 moves, 0 flagged", the move is now f60-191, and the receipt reads "re-check clean". The suite's third failure (motion3-life "critic is cheap", 255 ms vs 250 ms under load) passes run alone (`motion3 life: all checks passed`), so it is accepted as a CPU-timing check. A9: `mcp/README.md`, `docs/agent-cli.md`, `docs/studio-ui-ia.md` and `CHANGELOG.md` are updated.
