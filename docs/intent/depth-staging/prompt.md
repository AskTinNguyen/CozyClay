# Depth Staging

- Rev: 1
- Status: active
- Waits for: `group-coverage` completed (both edit `src/camera-coverage/composition.js` and the shot checks) and `camera-polish` completed (it solves the dirty OTS that A3 builds on). Fourth in the cinematic-atlas plan.
- Area: Camera and Shots
- Owner: TinNguyen
- Skill: `none`
- Branch: `intent/depth-staging`
- Worktree: `../CozyClay-wt/depth-staging`, port slot n=10 (dev 5210, live hub 5310, CDP 9310)

## Goal

Proposal 4 of the cinematic-atlas review (L-1). Previs exists to catch, before final art, the problems a camera has with the set: a face hidden behind a pillar, a camera inside a wall, a frame edge cutting a figure at the knee. Staging in depth also gives a frame its layers: a foreground shoulder, the subject, the room behind.

CozyClay already has the geometry pieces: `segmentIntersectsAabb` and `occludersOf` in `src/studio-geometry-facts.js`, and `entityWorldBounds`. Today they serve only as one-frame facts for the agent. `camera-polish` (D2, D6) makes the over-the-shoulder dirty by solving the foreground shoulder's cover.

This intent adds:

- per-shot camera checks over sampled frames;
- a foreground composition that generalises that solve to a named prop or character;
- a depth-layer report.

## Non-Goals

- Render-based (pixel) occlusion. The checks use bounds, so they run in Node and match every surface.
- Moving props or cast. Fixes suggest camera changes only.
- Re-solving the over-the-shoulder. `camera-polish` owns `shoulderFraming`; this intent reuses it.

## Decisions

- D1 (rev 1): `camera.checkShots` uses the same report shape as `camera.checkCuts` (issues with rule, severity, frames, fix) and is report-only. Source: orchestrator, following camera-coverage D2.
- D2 (rev 1): each shot is sampled at its first and last frame plus every k frames (k from the shot length, capped), so a move that passes behind a prop is caught. Source: orchestrator.

## Acceptance

- A1: Shot checks. `camera.checkShots` (read-only) flags these rules:
  - `occluded`: the subject's eye point is blocked by a prop's bounds or another character at the first or last frame, or for more than a set share of samples;
  - `inside`: the camera is inside a prop's bounds or nearer to geometry than the near-clip distance;
  - `crop`: a frame edge falls at a joint (ankle, knee, waist, neck), placed from the figure's proportions.

  Each issue carries a severity, frames and a fix (raise or lower by d m, slide left or right by d m, change size one step). Proof: gate: `node test/verify-camera-shot-checks.mjs` with constructed good and bad cases per rule.
- A2: No false flags. The check reports zero issues on the camera-coverage and group-coverage pattern fixtures in an empty set. A pillar placed between camera and subject is flagged with the right frames. Proof: gate: the same verify file.
- A3: Foreground composition. Composition gains `foreground: { id, share }`: a named prop or character takes a target share of frame width from the near edge, measured by projecting its bounds. It is solved the way `camera-polish` solves the OTS shoulder, reusing its code rather than a second solver. "Put the lamp in the foreground" resolves to it, and the OTS framing keeps its `camera-polish` result. Proof: gate: `node test/bus/verify-camera-composition.mjs` extended with the measured share within tolerance, and the `camera-polish` OTS verify unchanged.
- A4: Depth layers. Each shot's receipt lists the cast and props in its foreground, midground and background (distance bands around the subject). The sequence brief names them in a beat ("Joon's shoulder soft in the foreground, the window behind"), and the plan diagram marks foreground objects. Proof: gate: verify file for the bands and `node test/bus/verify-sequence-prompt.mjs` (byte-identical).
- A5: Controls. Flagged shots are marked on the timeline, and the readout explains each flag and its fix. Proof: ui:qa, a browser QA script that places a pillar, reads the `occluded` flag, applies the suggested camera change and re-checks; plus ui:shot of a prop held in the foreground through the lens and of the flagged timeline.
- A6: Agents. An MCP `check_shots` tool and `cclay live run` reach the checks. Phrases reach the actions: "is anything blocking her face?", "is the camera inside the wall?", "put the lamp in the foreground". `director-evals` gains at least 6 core scenarios. Proof: gate: `node mcp/verify-camera-shot-checks.mjs` and `node test/verify-director-evals.mjs`.
- A7: The repository gates hold. Proof: gate: `npm run lint` (no baseline raised), `npm run build`, and `node tools/run-tests.mjs --jobs 4` from Git Bash with no dev server running, under the contract's known exception.
- A8: Docs updated: `mcp/README.md`, `docs/agent-cli.md`, `docs/studio-ui-ia.md`, `CHANGELOG.md` Unreleased. Proof: review.

## Constraints

- `CLAUDE.md`: the 250-line ratchet, knip and eslint baselines; new files stay under 250 lines.
- Edits go through the command bus; never write domain stores directly.
- Reuse `src/studio-geometry-facts.js` rather than a second ray-box test; the agent facts and the checks must agree on the same frame.
- The Studio agent prompt cap (13,400, shot-prompt-engine D5) holds unless raised as a recorded decision.
- Keep the owner's own studio on ports 5180 / 5184 untouched; use slot n=10.
- Keep the branch merged with `origin/main` and pushed after every step (contract, Git And Merge).
- Source material: the cinematic-atlas repo is reference only; nothing from its books is committed or quoted.

## Changelog

- rev 1 (2026-10-24): written as a planned intent from the cinematic-atlas review (L-1, L-2).
- rev 1 (2026-10-24): the dirty OTS left to `camera-polish` (D2, D6), which started meanwhile; A3 reuses its solve for any foreground object. Port slots shifted to n=7–14 across the plan because `camera-polish` holds n=6.
