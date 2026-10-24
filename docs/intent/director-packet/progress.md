# Director Packet: Progress

- Working under rev: 1
- Worker: cloud worker agent (director-packet)
- Current step: done; every acceptance row met or ready for review
- Next step: none; squash-merge after Codex review
- PR: #16

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met (gate) | `node test/verify-director-packet.mjs` -> `# pass 4 # fail 0`: `PASS A1 5 rows; checks cuts: 4 cuts, 0 flagged; coverage: enough to edit: 5 shots, 2 cast; motivation: 1 move, 1 flagged; structure: intensity builds from 0.20 at beat 1 to a peak of 0.52 at beat 4, then releases to 0.49 by beat 5`; beats only when present, a range, cut flags on a mirrored camera, the shot model check, byte-identical JSON on three runs (step 1, 4) |
| A2 | met (gate; ui:shot accepted, R1) | same file: `PASS A2 master and coverage {"cameras":5,"moving":1,"lines":1,"marks":2,"walks":0,"legendRows":4}`, with a walk `"marks":6,"walks":1`, `PASS A2 triangle {"cameras":13,"moving":0,"lines":3,"marks":3,...}`, every point on the A4-landscape page. Shots: `proofs/plan-master-coverage.png`, `proofs/plan-triangle-dialogue.png` (step 6) |
| A3 | met (gate) | `node test/verify-director-packet-zip.mjs` -> `# pass 1 # fail 0`: `PASS A3 39 entries, packet/: 7 files; unzip -t: No errors detected in compressed data of .../cozyclay-sequence-rooftop.zip.` (index.html, shot-list.csv, shot-list.md, packet.json, plan.png, contact-sheet.png, intensity.png; CSV/MD/HTML/JSON checked against the data; keyframe pack entries unchanged). `node test/verify-keyframe-pack.mjs` passes in the suite (step 7) |
| A4 | met (ui:qa; ui:shot accepted, R1) | `test/verify-director-packet-browser.mjs` exit 0, 33 PASS, `director packet browser QA passed` (step 6): the dialog previews 18/13/5 shots, the downloaded zip passes `unzip -t` with the 7 packet files. Shots: `proofs/packet-preview-master-coverage.png`, `proofs/packet-preview-triangle-dialogue.png` |
| A5 | met (gate) | `node mcp/verify-director-packet.mjs` -> `11 passed, 0 failed`; live half in the A4 QA: `cclay live run export.directorPacket` -> `Exported cozyclay-sequence-coverage.zip: 1 shot with packet/ (...)`, the written zip checked with `unzip -t`; `cclay live tool render_packet` answers the editor's five shots |
| A6 | met (gate, known exception) | step 7: `npm run lint` exit 0 (`knip: 138 findings, 0 new`, `loc: ... 0 violations`, `eslint: ... 0 regressions`, no baseline changed); `npm run build` built; `SUITE-ALL: 471 files, 469 passed, 2 failed` (the two known timing checks only) |
| A7 | met (review R1) | `mcp/README.md` (37 tools, `render_packet` row, Director packet section), `docs/agent-cli.md` (Director packet), `docs/studio-ui-ia.md` (Export menu item and dialog test ids), `CHANGELOG.md` Unreleased > Export (step 5) |

## Steps

1. A1-A3 data, commit below: `src/director-packet/` (`packet.js` directorPacket, `checks.js` PACKET_CHECKS over camera.checkCuts / checkCoverage / checkMotivation and the shot model check, `plan.js` plan primitives on an A4-landscape page, `plan-draw.js` canvas painter, `shot-list.js` CSV and Markdown, `page.js` index.html, `files.js` packet/ entries), `test/verify-director-packet.mjs`, `test/verify-director-packet-zip.mjs`, `test/director-packet-fixture.mjs` (both in NODE_FILES).
   - `node test/verify-director-packet.mjs` -> `# pass 4 # fail 0`: `PASS A1 5 rows; checks cuts: 4 cuts, 0 flagged; coverage: enough to edit: 5 shots, 2 cast; motivation: 1 move, 1 flagged`; `PASS A2 master and coverage {"cameras":5,"moving":1,"lines":1,"marks":2,"walks":0,"legendRows":4}; with a walk {...,"marks":6,"walks":1,"legendRows":5}`; `PASS A2 triangle {"cameras":13,"moving":0,"lines":3,"marks":3,"walks":0,"legendRows":3}`.
   - `node test/verify-director-packet-zip.mjs` -> `# pass 1 # fail 0`: `PASS A3 38 entries, packet/: 6 files; unzip -t: No errors detected in compressed data of .../cozyclay-sequence-rooftop.zip.`

2. A5 agents, commit below: MCP `render_packet` (`mcp/director-packet-tool.mjs`; 36 tools; `promptDocument` shared with render_prompt, which now also passes the story beats story_beats keeps in memory), registered in `tools/run-tests.mjs` MCP list. An empty range now briefs nothing (`packet.js`).
   - `node mcp/verify-director-packet.mjs` -> `11 passed, 0 failed` (memory: head, shot-list.md rows, data fields, same bytes twice, csv, range, include_plan false, past-the-end; live stand-in over the bus fixture equals directorPacket and names export.directorPacket and the six packet files).
   - `node mcp/verify.mjs` -> `all checks passed` (36 tools); `mcp/verify-tool-annotations.mjs` `36 tools; deterministic order`; `test/verify-tool-handlers.mjs` `36 tools`; `mcp/verify-live.mjs` exit 0; `mcp/verify-render-prompt-sequence.mjs` `18 passed, 0 failed`.

3. A4 controls and the live export, commit `feat(export): director packet export, dialog and export.directorPacket`: `src/director-packet/studio.js` (renders plan.png on a canvas and contact-sheet.png through the export path, one frame per shot at its middle, numbered), `sequencePackExporter` takes extra entries and answers `{ name, files }`, `src/commands/director-packet.js` (`export.directorPacket`, a job registered by commands/export.js; registry 136 -> 137 after the merge), `src/shell/DirectorPacketDialog.jsx` + `director-packet-open.js` + `director-packet.css`, Export menu item, App wiring (+2 pure lines, the refs lint count unchanged). `test/verify-director-packet-browser.mjs` in BROWSER_FILES.
4. Merged origin/main bd0a6f56 (intensity-curve #15), commit c669769f: conflicts in the MCP tool lists and counts (now 37), `test/bus/verify-command-registry.mjs` (137, export module ids), `tools/run-tests.mjs` (both sides' files kept). Then wired the landed feature (70de8838): `structure` in `PACKET_CHECKS` (an issue on one shot is its flag, a flat run is a note), `packet.intensity` (words, peak, curve per shot, beats, issues) and each row's `intensity`, `src/director-packet/intensity.js` (`stripImage` over the range) and `packet/intensity.png`. A range of one shot has no curve, so the section and the picture are left out. Reran: verify-director-packet `# pass 4`, zip `# pass 1`, mcp director-packet `11 passed`, mcp intensity-curve `12 passed`, verify-intensity-curve `# pass 4`, sequence-prompt `# pass 6`, mcp/verify `37 tools registered`, tool annotations / handlers / verify-live 37 tools, command registry and declarations exit 0.
5. A7 docs and proofs, commit c2f4e76d (plan labels: shot runs "1-5", whole mm, kept on the page).
6. A4 ui:qa and ui:shot: dev server `COZYCLAY_LIVE_PORT=5312 npm run dev -- --port 5212`; `COZYCLAY_LIVE_PORT=5312 QA_SHOT_DIR=docs/intent/director-packet/proofs QA_CHROME_FLAGS='--no-sandbox --proxy-server=http://127.0.0.1:8444 --ignore-certificate-errors' CDP_PORT=9312 QA_URL=http://127.0.0.1:5212/app/ CHROME_PATH=/opt/pw-browsers/chromium node tools/qa-browser.mjs -- node test/verify-director-packet-browser.mjs` -> exit 0, 33 PASS, `director packet browser QA passed`. Triangle over Dialogue (13 shots, `every cut clean`) and master and coverage over Exchange with a push-in; dialog 18 rows / 18 cameras; triangle range 13 cameras, 3 lines, no cut flags; master range 5 cameras, 1 line, push-in row `motivation/unmotivated`; Download -> `cozyclay-sequence-coverage.zip exported`, 23 entries, `unzip -t` clean, packet/ 7 files, shot-list.csv 2 rows; `cclay live run export.directorPacket {from:16,to:16}` -> 15 entries, packet/ 6 files (one shot: no intensity.png), `unzip -t` clean; `cclay live tool render_packet` -> `Director packet: COVERAGE, shots 14-18 of 18, 10s; ...`. The proofs PNGs are from the run on the final plan-draw.js. Dev server stopped.
7. A6 gates on 71c6ca25, no dev server running: `npm run lint` exit 0 (`knip: 138 findings, 0 new, 1 fixed (baseline 139)`, `loc: 72 files over 250 (baseline 72), 0 violations`, `eslint: 396 errors across 20 rules (baseline 403), 0 regressions`); `npm run build` built; `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_CA_BUNDLE node /home/claude/local-tools/suite-all.mjs --jobs 4` -> `SUITE-ALL: 471 files, 469 passed, 2 failed`: `test/motion3/verify-motion3-exitcar.mjs` (`compile + QA stay fast (< 3 s CPU)`, 3617 ms) and `test/motion3/verify-motion3-repair.mjs` (`exit car, hips sunk: under 10 s`, 23075 ms), the base's known timing failures. origin/main still bd0a6f56.

## Decisions

- D1 as built: `directorPacket(document, { range, placeAt })` over the sequence document; the shot rows reuse the brief's beats (`buildSequencePrompt`), so the packet and the brief say the same thing. A range is `{ from, to }` or `{ shotIds }`; an empty range is empty (not every shot).
- Sections: `PACKET_CHECKS` (checks.js) lists the checks the packet reports and `PACKET_PICTURES` (files.js) the pictures; a check that has nothing to say answers null and is left out (the shot model check without `targetModel`, structure with one shot). A feature that has not landed has no entry; intensity-curve was wired in on its merge; depth-staging is the next to add here.
- Coverage gaps with a shot are that shot's flags; the rest (no master, sizes, a line change at a cut) are notes. Structure: one-shot issues are flags, flat runs notes.
- Plan: cameras at their first frame (frustum 2.5 m), a path sampled every 4 frames when it travels >= 0.05 m, the arrowhead read 0.25 m back; lines are authored lines plus the pair each cut is judged against (two people and no cut: their pair); a mark per place a cast member starts a shot from (within 5 cm and 5 deg); a walk when the cast travels >= 0.1 m. The page is 1600 x 1131 (A4 landscape) with a 280 px legend column.
- The Studio export runs `export.directorPacket` with the cast placed by `sampleStateAt` (walks from takes); the dialog preview uses the authored placement (castAt), as the Motivation panel does.
- `export.directorPacket` has `open` exposure so `cclay live` can write the pack (F-1). timeoutMs is the registry's 300 000 maximum.
- `render_prompt` now shares `promptDocument` with `render_packet`, so in memory it also reads the story beats `story_beats` keeps.
- No Studio agent system prompt text added.

## Reconciliations

## Reviews

- R1 (cloud orchestrator, 2026-10-24, at f83dbe4a): opened the four proof images.
  - `proofs/plan-master-coverage.png`: an A4-landscape plan on a 1 m grid. It shows cameras 1-5 with lens and frustum, the Mara-Joon line dashed, and Mara, Joon and Sela as cast marks with their facing. Camera 2's 6.24 m move is drawn with its path and arrow. The legend has four rows.
  - `proofs/plan-triangle-dialogue.png`: 13 numbered cameras and the three pair lines (Mara-Joon, Joon-Sela, Sela-Mara). Each pair's singles and OTS sit on one side of their line. It is dense where the frustums overlap in the middle, but the numbers and lenses stay readable.
  - `proofs/packet-preview-master-coverage.png`: the File > Export > Director packet dialog. It has From/To pickers, a summary line (5 shots, 3 cast, 6 flags; cuts, coverage, motivation and structure), the plan, and the shot table. Flags link to their check, for example "cuts/line, coverage/line-change, motivation/unmotivated" on shot 2.
  - `proofs/packet-preview-triangle-dialogue.png`: the same dialog over the triangle dialogue.
  - A7: `mcp/README.md`, `docs/agent-cli.md`, `docs/studio-ui-ia.md` and CHANGELOG describe `render_packet`, `export.directorPacket` and the dialog.
  - F-1 is resolved as option 1 (see findings).
