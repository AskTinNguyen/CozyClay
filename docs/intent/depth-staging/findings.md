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
