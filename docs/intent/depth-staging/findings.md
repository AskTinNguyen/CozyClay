# Depth Staging: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

## F-1: walk-and-talk's leading single is truly blocked when the pair stands face to face

- Found in: A2 (`test/verify-camera-shot-checks.mjs`, zero-false-flag sweep over every coverage and group pattern across the cut-rule blockings).
- What: walk-and-talk's head-on "Leading single" pulls the camera back along the walking line. In the `facing` and `diagonal` blockings, the partner stands in front of the subject on that line. The camera's sight line to the subject's eyes passes through the partner's torso and head, so `camera.checkShots` flags `occluded` (by the partner) on 4 shots. Measured, not a false positive: the partner's figure box sits between the lens and the eyes on every sample. Of the 382 pattern shots, no other shot is flagged.
- Why it matters: walk-and-talk assumes the pair walks side by side. Laid over a pair standing face to face, the pattern's leading single is unusable as planned. The check is right to say so, and its fix (a slide or raise) clears it.
- Options:
  1. Keep the flag (current). The test lists these 4 as true blocks. The director sees the problem and the fix on the timeline.
  2. Make walk-and-talk's planner refuse, or warn when laid over a pair that faces each other (`camera.cover` note).
  3. Make the planner offset the leading single laterally when the partner is on the walking line.
- Recommendation: 1 now (the check is correct and the fix is one click). Take 2 as a small follow-up in camera-coverage, because the pattern's premise (walking side by side) is what is violated. 3 changes the pattern's framing for every blocking, so it needs its own review.
- Resolution (cloud orchestrator, 2026-10-24): option 1. The 4 flags are measured blocks, not false positives. A2's "zero issues" holds for every pattern laid as its premise intends; walk-and-talk over a face-to-face pair breaks the premise. Option 2 stays a candidate follow-up in camera-coverage.

## F-2: action ports carry no `sampleStateAt`, so the camera checks place a walking subject at its stored position

- Found in: the PR #17 review fix (P2-2). The commands get `appContext.actionPorts`. `bounds` is now forwarded there, but `sampleStateAt` is still only on the binding's `ports`.
- What: `camera.checkCuts`, `checkMotivation`, `checkStructure`, `checkShots` and `export.directorPacket` each build `placeAt` from `ports.sampleStateAt?.(at)`. In the live editor that is undefined, so they fall back to the stored row and read the stored position, not the sampled one. A subject walking on its take root is read where it was placed, not where it is at the cut.
- Options:
  1. Forward `sampleStateAt` through `actionPorts` the way `bounds` now is. That is one line, but it changes what five checks report for walking subjects, so their verifies need a look.
  2. Leave it and document that the checks read stored positions.
- Recommendation: 1, as its own small change with its own verifies (it touches coverage, motivation, structure and the packet, not only depth-staging).
- Resolution (2026-10-24): option 1, in `fix(app): commands sample the cast at each frame through the action ports` (branch `fix/action-ports-sample-state`): `actionPorts.sampleStateAt` forwards lazily to the current binding ports; `test/bus/verify-camera-shot-checks.mjs` covers a walking subject.
