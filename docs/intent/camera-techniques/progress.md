# Camera Technique Library: Progress

- Working under rev: 1
- Worker: `camera-techniques-worker`
- Current step: A4 agent, MCP and CLI access
- Next step: A7 prompt sync (shot-prompt, keyframe pack, render_prompt), then A6 picker and A5 live captures
- PR: none yet

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | `node test/verify-camera-techniques.mjs` -> `12 checks passed` (65 names resolve, ids/aliases unique, every field present) |
| A2 | met | same file: `ok - the resolver maps 32 phrases to the right technique`, mood search and sentence-to-stack checks pass |
| A3 | met | `node test/bus/verify-camera-techniques-apply.mjs` -> `pass 5, fail 0`; `PASS 59 techniques` with classifyMove equal to the expected move for each |
| A4 | open | |
| A5 | open | |
| A6 | open | |
| A7 | open | storage round trip covered in the A3 file; prompt text still to do |
| A8 | open | |
| A9 | open | |

## Steps

1. Setup: `npm ci` and `npm --prefix mcp ci` in the worktree (exit 0). Baseline `npm run lint` on b6806868: `knip: 139 findings, 0 new`, `loc: 72 files over 250 (baseline 72), 0 violations`, `eslint: 399 errors across 20 rules (baseline 403), 0 regressions`.
2. A1/A2: catalog in `src/camera-techniques/` (`entry.js`, `catalog-framing.js` 13 sizes + 11 angles, `catalog-moves.js` 21 moves and lens moves, `catalog-rigs.js` 7 rail moves, 9 coverage, 4 modifiers; `index.js` lookups and the compact index; `resolve.js` names, aliases, word-by-word spelling tolerance, moods, sentence-to-stack). Descriptions written fresh (D1). `node test/verify-camera-techniques.mjs` -> `12 checks passed`.
3. A3: `framing.js` (sizes, levels, views, group, OTS, POV, reverse), `moves.js` (keyed moves and rails), `compile.js` (stack -> keys or rail, expected move, label, prompt-only parts), `readback.js` (classify keys and the integrated rail track, prompt phrase), `storage.js` (persisted shape, signature). `src/commands/camera.js` registers `camera.techniques`, `camera.describeTechnique` (read-only jobs) and `camera.applyTechnique` (mutation, one bus run: clears keys, nested `shot.frame` per key, eases, or nested `shot.setCameraRail`; stores `shot.technique`). Key `ease` (`linear`, `in`, `out`) added to `cameraMoveAt`, the shot document repair and the cameraKey patch schema. Receipt check fields added to the protocol schema. `node test/bus/verify-camera-techniques-apply.mjs` -> `tests 5, pass 5, fail 0`.

## Decisions

- Rail and follow techniques (tracking, smooth tracking, follow, Steadicam, dolly shot, helicopter, one-er) compile to a rail laid from the subject's framing, never free follow: a rail runs on a still subject and its camera track is pure (`camera-follow.js buildRailFollowTrack`), so the classifier can read the real result. Lateral rails are short enough to read as `tracking`; the one-er is a 120 degree arc and reads as `orbit`.
- Roll techniques (Dutch angle, canted frame) fill a separate `roll` slot so "low angle with a Dutch tilt" stacks; they apply as prompt words only (`requires: roll`).
- Constant-speed ease is a per-key `ease` field ("linear" | "in" | "out", absent = the old ease in and out) on the key that starts a segment. Crash zoom and whip pan hold, then snap in a few frames at constant speed; a 360 runs linear on all segments; an arc over 90 degrees eases in on its first segment and out on its last.
- The applied stack is stored as `shot.technique { stack, label, phrase, move, promptOnly, signature }` without a document version bump (an optional field; older bodies stay byte-identical). The signature fingerprints the keys and rail; once the camera is edited by hand the stack no longer shows or speaks for the shot (`currentTechnique`).
- Speed sets how much of the shot a keyed move takes (slow: all of it, medium: 65 %, fast: 35 %); for rails it scales the rail length.
- A still keeps the first framing of a move and states the move in the prompt.

## Reconciliations
