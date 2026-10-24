# Director Packet: Progress

- Working under rev: 1
- Worker: cloud worker agent (director-packet)
- Current step: 1, A1/A2 data and plan primitives (`src/director-packet/`, `test/verify-director-packet.mjs`)
- Next step: A3 files, A4 controls, A5 agents
- PR: none yet

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | open | |
| A2 | open | |
| A3 | open | |
| A4 | open | |
| A5 | open | |
| A6 | open | |
| A7 | open | |

## Steps

1. A1-A3 data, commit below: `src/director-packet/` (`packet.js` directorPacket, `checks.js` PACKET_CHECKS over camera.checkCuts / checkCoverage / checkMotivation and the shot model check, `plan.js` plan primitives on an A4-landscape page, `plan-draw.js` canvas painter, `shot-list.js` CSV and Markdown, `page.js` index.html, `files.js` packet/ entries), `test/verify-director-packet.mjs`, `test/verify-director-packet-zip.mjs`, `test/director-packet-fixture.mjs` (both in NODE_FILES).
   - `node test/verify-director-packet.mjs` -> `# pass 4 # fail 0`: `PASS A1 5 rows; checks cuts: 4 cuts, 0 flagged; coverage: enough to edit: 5 shots, 2 cast; motivation: 1 move, 1 flagged`; `PASS A2 master and coverage {"cameras":5,"moving":1,"lines":1,"marks":2,"walks":0,"legendRows":4}; with a walk {...,"marks":6,"walks":1,"legendRows":5}`; `PASS A2 triangle {"cameras":13,"moving":0,"lines":3,"marks":3,"walks":0,"legendRows":3}`.
   - `node test/verify-director-packet-zip.mjs` -> `# pass 1 # fail 0`: `PASS A3 38 entries, packet/: 6 files; unzip -t: No errors detected in compressed data of .../cozyclay-sequence-rooftop.zip.`

2. A5 agents, commit below: MCP `render_packet` (`mcp/director-packet-tool.mjs`; 36 tools; `promptDocument` shared with render_prompt, which now also passes the story beats story_beats keeps in memory), registered in `tools/run-tests.mjs` MCP list. An empty range now briefs nothing (`packet.js`).
   - `node mcp/verify-director-packet.mjs` -> `11 passed, 0 failed` (memory: head, shot-list.md rows, data fields, same bytes twice, csv, range, include_plan false, past-the-end; live stand-in over the bus fixture equals directorPacket and names export.directorPacket and the six packet files).
   - `node mcp/verify.mjs` -> `all checks passed` (36 tools); `mcp/verify-tool-annotations.mjs` `36 tools; deterministic order`; `test/verify-tool-handlers.mjs` `36 tools`; `mcp/verify-live.mjs` exit 0; `mcp/verify-render-prompt-sequence.mjs` `18 passed, 0 failed`.

## Reconciliations
