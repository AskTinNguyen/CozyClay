# Depth Staging: Progress

- Working under rev: 1
- Worker: cloud worker agent (depth-staging)
- Current step: A1/A2 shot checks (`src/camera-depth/shot-checks.js`, `camera.checkShots`)
- Next step: A4 depth layers, then A6 agents, A5 controls, A8 docs, A7 gates
- PR: none yet

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | open | |
| A2 | open | |
| A3 | met (gate) | `node test/bus/verify-camera-composition.mjs` -> `# pass 4 # fail 0`, "PASS foreground shares right/0.2=0.202 ... left/0.4=0.400" (measured with three.js, within 0.02); `node test/verify-camera-dirty-ots.mjs` -> `9 checks passed` (unchanged file; the OTS output is byte-identical to main over 54 setups) |
| A4 | open | |
| A5 | open | |
| A6 | open | |
| A7 | open | |
| A8 | open | |

## Steps

1. A3 foreground composition. The OTS shoulder solve moved into `solveForeground` (`src/camera-techniques/framing.js`), and `shoulderFraming` now calls it. A probe compared 54 OTS setups (sides, sizes, distances, scales) against main: byte-identical. `src/camera-techniques/foreground.js` `foregroundFraming` runs the same solve with a box measure (`boxCover`: the vertical edges of the world box inside the frame height, projected). It uses three options the OTS leaves off: `reach`, `slide` and `settle`. `composition.foreground { id, share }` is normalized in `composition.js`, solved in `compile.js` and resolved to a prop or cast member by `camera.applyTechnique` (`src/camera-depth/scene.js` `resolveNear`). The phrase "put the lamp in the foreground" goes through `src/camera-depth/resolve.js` `parseForeground` in `route.js`. Proof in the table.

## Decisions

- A foreground the stack cannot take is not solved: an over-the-shoulder, group, POV or reverse keeps its own framing, and a note says so. A composition that names a foreground never re-aims the keys, so the OTS keys stay identical (tested).
- A share that cannot be reached is reported, not forced. Example: a prop 1.5 m from the subject in a wide shot. The setup that comes nearest is kept, with a TECHNIQUE_NOTE that names the share it covers.
- Receipt checks gain `foregroundShare` and `flagged` in the protocol checks schema. They are added on the existing line, so `studio-agent-protocol.js` does not grow.

## Reconciliations
