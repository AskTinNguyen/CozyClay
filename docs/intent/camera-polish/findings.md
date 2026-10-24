# Camera Polish: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

## F-1 (2026-10-24, rev 1) | blocking: no | status: accepted

**Found:** a Snorricam on a character with a take v3 never left the start point. The mount read the placement and the legacy `rootPos` root only; a v3 take moves the body through its hips track (rig space under the character's placement), so the camera stayed where Mara started while she walked away (the live capture saw her at `visiblePixelCount 0`). Riding the raw hips then swung the frame with the pelvis: a 4.5° heading twist and about 3 cm of side sway per step (the head slid about 25 px between two captures).
**Proposed amendment:** D5: the mount rides the hips' path and heading, averaged over one stride (±20 frames, centred), with the rise per frame.
**Resolution:** accepted as D5, rev 2. `test/verify-camera-walk-bob.mjs` compiles a real walk: the body ends at the goal, heading twist 1.13° on the straight, bob 1.9 cm.

## F-2 (2026-10-24, rev 1) | blocking: no | status: accepted

**Found:** at 30 % cover of the modelled shoulder edge the rendered shoulder filled about 19 % of the frame (the rig's mesh is narrower at that height than 0.23 m).
**Proposed amendment:** D6: aim for 36 % of the modelled edge (renders as about a quarter); A2 checks 25–40 % of the modelled edge.
**Resolution:** accepted as D6, rev 2. Live captures: the shoulder fills about 24 % (Mara) and 32 % (Joon, with the head) of the frame.
