# Depth Staging: Progress

- Working under rev: 1
- Worker: cloud worker agent (depth-staging)
- Current step: done; every row met or ready for review
- Next step: orchestrator review (A8 docs, the proofs, F-1)
- PR: none yet

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
| A8 | ready for review | `mcp/README.md` (`check_shots` row, Depth staging section, `foreground` in composition, 37 tools), `docs/agent-cli.md` (Shot checks section, foreground words), `docs/studio-ui-ia.md` (Shot check section, Shots-lane bars, FG ring), `CHANGELOG.md` Unreleased |

## Steps

1. A3 foreground composition. The OTS shoulder solve moved into `solveForeground` (`src/camera-techniques/framing.js`), and `shoulderFraming` now calls it. A probe compared 54 OTS setups (sides, sizes, distances, scales) against main: byte-identical. `src/camera-techniques/foreground.js` `foregroundFraming` runs the same solve with a box measure (`boxCover`: the vertical edges of the world box inside the frame height, projected). It uses three options the OTS leaves off: `reach`, `slide` and `settle`. `composition.foreground { id, share }` is normalized in `composition.js`, solved in `compile.js` and resolved to a prop or cast member by `camera.applyTechnique` (`src/camera-depth/scene.js` `resolveNear`). The phrase "put the lamp in the foreground" goes through `src/camera-depth/resolve.js` `parseForeground` in `route.js`. Proof in the table.

2. A1/A2 shot checks and fixes (c489496c): `src/camera-depth/shot-checks.js`, `fixes.js`, `layers.js`, `scene.js`, `resolve.js`; `camera.checkShots` and `camera.fixShot` in `src/commands/camera-depth.js`. Phrases route through `route.js`.
3. Merged origin/main (intensity-curve #15) keeping both sides (6213cec2): route, camera commands, sequence brief, registry count 138, sequence-prompt test.
4. A4 tests through the bus (da6da07e).
5. A6 agents (accb84f7): MCP `check_shots` (`mcp/camera-depth-tools.mjs`, 37 tools), a `depth` director-evals category (10 core rows and 1 stretch row: "are we clipping into the bookcase?" does not resolve yet), and the redirect from `apply_camera_technique`.
6. A5 controls (cf1f5aed): `ShotCheckMarks` on the Shots lane and the Shot check readout with Apply fix in the Coverage panel. QA found that a fix could hand an unnamed shot to the other person, because the most central person changes when the camera slides. The fix search now keeps the subject (`keeps`), with a unit check that fails without it.
7. Merged origin/main (director-packet #16, 27dd3e63), keeping both sides: 38 MCP tools, 139 registry actions. Following the packet's prompt, the "Depth" entry is now in `PACKET_CHECKS` (`src/director-packet/checks.js`). A pillar flags the shot it blocks, with the fix (`test/verify-director-packet.mjs`, `# pass 5`). The packet's expected check lists gain `depth`. MCP `render_prompt` and `render_packet` now pass the scene's objects, so the brief's Depth line and the packet's depth flags work in memory too.

## Decisions

- A foreground the stack cannot take is not solved: an over-the-shoulder, group, POV or reverse keeps its own framing, and a note says so. A composition that names a foreground never re-aims the keys, so the OTS keys stay identical (tested).
- A share that cannot be reached is reported, not forced. Example: a prop 1.5 m from the subject in a wide shot. The setup that comes nearest is kept, with a TECHNIQUE_NOTE that names the share it covers.
- Receipt checks gain `foregroundShare` and `flagged` in the protocol checks schema. They are added on the existing line, so `studio-agent-protocol.js` does not grow.

- The timeline and readout compute the check in the page from the shell's cast, props and filmback (as the cut flags do). The bus action adds the bounds port and the sampled cast state, so an imported mesh or a keyed walk can read slightly differently there. The bus answer is the authority for agents.
- `camera.fixShot` moves only the camera keys. A rail or follow shot is refused and pointed at its rail.

## Reconciliations
