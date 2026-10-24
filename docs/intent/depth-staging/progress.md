# Depth Staging: Progress

- Working under rev: 1
- Worker: cloud worker agent (depth-staging)
- Current step: done; every row met or ready for review
- Next step: none; squash-merge after Codex review
- PR: #17

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met (gate) | `node test/verify-camera-shot-checks.mjs` -> `9 checks passed`: occluded (a pillar on every sample, high, the fix clears it; it agrees with `studio-geometry-facts` occludersOf), a truck move past a screen (medium, the frames listed), inside (a wall, the near clip, an enclosure skipped), crop at knee/ankle/waist with a size step fix, and a fix that keeps the subject of a shot that names none |
| A2 | met (gate) | same file: "382 pattern shots, 0 false flags; 4 true blocks (F-1)"; a pillar on a pattern camera is flagged with the right frames, and `rule: occluded` keeps that rule only |
| A3 | met (gate) | `node test/bus/verify-camera-composition.mjs` -> `# pass 4 # fail 0`, "PASS foreground shares right/0.2=0.202 ... left/0.4=0.400" (measured with three.js, within 0.02); `node test/verify-camera-dirty-ots.mjs` -> `9 checks passed` (unchanged file; the OTS output is byte-identical to main over 54 setups) |
| A4 | met (gate) | `node test/verify-camera-depth-layers.mjs` -> `2 checks passed` (bands, words, report layers, plan diagram FG ring); `node test/bus/verify-sequence-prompt.mjs` -> `# pass 7 # fail 0` ("Depth: Joon's shoulder soft in the foreground, the window behind.", byte-identical across two builds); `node test/bus/verify-camera-shot-checks.mjs` -> `# pass 2` (receipt `output.layers`) |
| A5 | met (ui:qa, ui:shot) | `node tools/qa-browser.mjs -- node test/verify-shot-checks-browser.mjs` (dev 5210, hub 5310, CDP 9310) -> "shot checks browser QA passed", exit 0: a pillar flags BLOCKED on the Shots lane, `cclay live run camera.checkShots` agrees, the readout explains the flag and the fix, Apply fix clears it and the hub re-check is clean. Shots: `proofs/shot-check-flagged.png`, `proofs/shot-check-readout.png`, `proofs/foreground-lamp-lens.png` (a lamp held at share 0.3 through the lens) |
| A6 | met (gate) | `node mcp/verify-camera-shot-checks.mjs` -> `11 passed, 0 failed` (in memory and live over a bus fixture); `node test/verify-director-evals.mjs` -> "depth: core 10/10, stretch 0/1", "core: 119/119"; `node mcp/verify-director-evals.mjs` -> `104 passed, 0 failed`; `cclay live run camera.checkShots` exercised by the A5 QA |
| A7 | met (gate) | After the director-packet merge (42c14da2): `npm run lint` -> "knip: 138 findings, 0 new", "loc: 72 files over 250 (baseline 72), 0 violations", "eslint: 0 regressions" (no baseline raised); `npm run build` exit 0; `suite-all.mjs --jobs 4` (AWS vars unset) -> "475 files, 473 passed, 2 failed", only the known timing failures verify-motion3-exitcar and verify-motion3-repair |
| A8 | met (review R1) | `mcp/README.md` (`check_shots` row, Depth staging section, `foreground` in composition, 38 tools after the merges), `docs/agent-cli.md` (Shot checks section, foreground words), `docs/studio-ui-ia.md` (Shot check section, Shots-lane bars, FG ring), `CHANGELOG.md` Unreleased |

## Steps

1. A3 foreground composition. The OTS shoulder solve moved into `solveForeground` (`src/camera-techniques/framing.js`), and `shoulderFraming` now calls it. A probe compared 54 OTS setups (sides, sizes, distances, scales) against main: byte-identical. `src/camera-techniques/foreground.js` `foregroundFraming` runs the same solve with a box measure (`boxCover`: the vertical edges of the world box inside the frame height, projected). It uses three options the OTS leaves off: `reach`, `slide` and `settle`. `composition.foreground { id, share }` is normalized in `composition.js`, solved in `compile.js` and resolved to a prop or cast member by `camera.applyTechnique` (`src/camera-depth/scene.js` `resolveNear`). The phrase "put the lamp in the foreground" goes through `src/camera-depth/resolve.js` `parseForeground` in `route.js`. Proof in the table.

2. A1/A2 shot checks and fixes (c489496c): `src/camera-depth/shot-checks.js`, `fixes.js`, `layers.js`, `scene.js`, `resolve.js`; `camera.checkShots` and `camera.fixShot` in `src/commands/camera-depth.js`. Phrases route through `route.js`.
3. Merged origin/main (intensity-curve #15) keeping both sides (6213cec2): route, camera commands, sequence brief, registry count 138, sequence-prompt test.
4. A4 tests through the bus (da6da07e).
5. A6 agents (accb84f7): MCP `check_shots` (`mcp/camera-depth-tools.mjs`, 37 tools), a `depth` director-evals category (10 core rows and 1 stretch row: "are we clipping into the bookcase?" does not resolve yet), and the redirect from `apply_camera_technique`.
6. A5 controls (cf1f5aed): `ShotCheckMarks` on the Shots lane and the Shot check readout with Apply fix in the Coverage panel. QA found that a fix could hand an unnamed shot to the other person, because the most central person changes when the camera slides. The fix search now keeps the subject (`keeps`), with a unit check that fails without it.
7. Merged origin/main (director-packet #16, 27dd3e63), keeping both sides: 38 MCP tools, 139 registry actions. Following the packet's prompt, the "Depth" entry is now in `PACKET_CHECKS` (`src/director-packet/checks.js`). A pillar flags the shot it blocks, with the fix (`test/verify-director-packet.mjs`, `# pass 5`). The packet's expected check lists gain `depth`. MCP `render_prompt` and `render_packet` now pass the scene's objects, so the brief's Depth line and the packet's depth flags work in memory too.
8. PR #17 review (Codex, two P2 findings).
   - P2-1: a prop on an authored path was clamped to frame 0. The bounds state and the sample state that `blockersAt` uses had no `frameCount`, and `studioBounds` times the path over it. `propBoxes` and `checkShot` now carry the timeline length, from `scene.frameCount`. `shotLayers`, the brief, the plan diagram and `camera.applyTechnique` pass it too.
   - P2-2: the timeline flags built their scene without the bounds port, so attached and path-driven props had no box. `checkScene` (`src/camera-depth/scene.js`) now builds the scene for both the command and `useShotChecks`. The hook passes the editor's `ports.bounds` and the shot document's `frameCount`.
   - P2-2 had a second cause, found by the browser QA: commands receive `actionPorts`, which had no `bounds`. So in the live editor `camera.checkShots` never measured an attached or path-driven prop either. `actionPorts.bounds` now forwards to the editor's evaluated bounds (`src/app-context.js`).
   - Unit checks that fail on the old code: `test/verify-camera-shot-checks-ports.mjs` (3 checks). With `frameCount` left out of the bounds state, the path check fails ("at frame 95 the cart is on the line"). With it left out of the sample state only, the issue list is empty. `checkScene` did not exist before.
   - Bus check: `test/bus/verify-camera-shot-checks.mjs` gains a cart on a path, measured through the real `studioBounds`. It fails ("# fail 1") without `actionPorts.bounds`, and again without `frameCount` in the sample state.
   - Browser QA adds a cart that rolls onto Mara's sight line. The Shots lane and `cclay live run camera.checkShots` both flag frames 96-191 and name the same issue.

## Decisions

- A foreground the stack cannot take is not solved: an over-the-shoulder, group, POV or reverse keeps its own framing, and a note says so. A composition that names a foreground never re-aims the keys, so the OTS keys stay identical (tested).
- A share that cannot be reached is reported, not forced. Example: a prop 1.5 m from the subject in a wide shot. The setup that comes nearest is kept, with a TECHNIQUE_NOTE that names the share it covers.
- Receipt checks gain `foregroundShare` and `flagged` in the protocol checks schema. They are added on the existing line, so `studio-agent-protocol.js` does not grow.

- The timeline and readout compute the check in the page with the command's scene (`checkScene`): the shell's cast, props and filmback, the editor's bounds port and the timeline length. The command also has a `placeAt` from `ports.sampleStateAt`. Neither placement uses that port in the live editor today, so both put the cast at its stored position (see F-2).
- `camera.fixShot` moves only the camera keys. A rail or follow shot is refused and pointed at its rail.

## Reconciliations

## Reviews

- R1 (cloud orchestrator, 2026-10-24, at 8f5f13db): opened the three proof images.
  - `proofs/shot-check-flagged.png`: the Shots lane with a red BLOCKED bar under both shots (Dialogue and Exchange), next to the JUMP cut tag.
  - `proofs/shot-check-readout.png`: the Shot check readout, "2 shots, 2 flagged". It reads "Blocked · high: Pillar hides Mara's eyes from the lens on 17 of 17 sampled frames", lists the frames, gives "Fix: slide the camera 2.8 m right" with an Apply fix button, and a depth line ("the pillar soft in the foreground, Joon level with Mara, ... behind").
  - `proofs/foreground-lamp-lens.png`: through the lens, a prop held large at the near left edge, the character at mid frame and the other props behind. These are the three layers A3/A4 describe.
  - A8: `mcp/README.md`, `docs/agent-cli.md`, `docs/studio-ui-ia.md` and CHANGELOG describe `camera.checkShots`, `camera.fixShot`, `check_shots`, `foreground` composition and the depth layers.
  - F-1 is resolved as option 1 (see findings).
  - The packet's new `depth` entry in `PACKET_CHECKS` matches director-packet's prompt, which says the packet carries depth-staging output when it has landed.
