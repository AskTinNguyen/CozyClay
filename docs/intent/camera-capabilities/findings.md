# Camera Capabilities: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

## F-1: Roll and focus keys live on their own rig keys, not on the framing keys (blocking: no)

- Evidence: D1 asks for "a per-key value where it animates: roll and focus distance". A framing key eases the camera in and out, so the camera slows to a stop at every key (`shot.frame` description in `src/commands/shot.js`; `easeInOut` in `src/camera-move.js`). A rack focus over frames 77-105 of a moving shot would need framing keys at 77 and 105 holding the sampled framing, and those keys would stop the move twice. A static Dutch angle on a held shot is the same problem in reverse: a roll key needs a framing to sit on.
- What I did: the per-key values are `camera.rigKeys: [{ offset, rollDeg?, focus?, ease? }]` on the camera block (offset = frames from the shot's first frame, so reflowing or moving a shot carries them). They ease with the camera-key eases (`KEY_EASES`, absent = in and out) and never touch the framing. `camera.setKey` writes them, the Camera rig panel keys them at the playhead, and the timeline camera lane draws them as round dots beside the framing-key diamonds. `test/verify-camera-roll.mjs` and `test/verify-camera-focus.mjs` assert the eased interpolation.
- Options: (a) keep rig keys (recommended: a rack focus or a roll change never alters the move, and older documents are untouched); (b) put `rollDeg` / `focus` on the framing keys, accepting that a rack focus inserts stopping keys.
- Proposed amendment: D1 reads "a per-key value on the camera's rig keys where it animates".
- Resolution (orchestrator, 2026-10-24): option (a) accepted; D1 amended in rev 2.

## F-2: The body mount follows the character's placement per frame, with the bone's height from the figure's proportions (blocking: no)

- Evidence: `sampleAt` is pure and frame-addressed (no skeleton); the viewport, captures and the USD/OTIO exports all read it, and only the live viewport has posed bones. A mount read from the live rig would differ between the preview and an export of the same frame.
- What I did: `src/camera-capabilities/mount.js` places the mount from the character's placement at the (retimed) frame: the take root for the camera subject, the walked path for a proxy figure, the shot override for a still, else its stage placement, plus its heading; the bone's height is a share of its stature (`BONE_HEIGHT`; proxy figures use their own head height). The camera rides that frame and looks at the face, so the subject holds its place in frame while the world moves (`test/verify-camera-mount.mjs`: face spread 1.4e-14 NDC across frames 1-89 while a set landmark sweeps 4.1 NDC; `proofs/snorricam-start.png`, `proofs/snorricam-end.png`).
- Options: (a) keep (recommended; deterministic and identical in every surface); (b) a later intent bakes per-frame bone tracks from the take (an evaluator rig, as `src/studio-agent-motion.js` has) into the scene envelope so the mount also carries the hips' bob and sway.
- Proposed amendment: none for this intent; (b) as a follow-up if the owner wants walk bob in the Snorricam.
- Resolution (orchestrator, 2026-10-24): option (a) accepted (D4, rev 2); (b) listed as a follow-up for the owner.

## F-3: Shot speed does not reuse src/speed-envelope.js (blocking: no)

- Evidence: A5 says to check `src/speed-envelope.js` first and reuse it. That module shapes speed along a route: normalized distance over time with conserved area between time-distance pins (the prop path and the camera dolly). A shot's speed is one constant time factor on how the shot samples its take, with no route and no conserved distance.
- What I did: `src/camera-capabilities/speed.js` (`retimeFrame`, `takeFrameAt`): each shot is a window on the take anchored at its first frame (take frame = start + (f - start) x speed), stills ignore speed, and every place the cast is posed or placed reads the retimed frame (`src/domains/playback.js`, the App posing effects and export frame, `src/stage-characters.jsx`, the follow subject track, `sampleAt`'s subject and `motionFrame`). The camera keeps timeline time, because its keys are authored there. Take frames are posed at whole frames (`applyTakeFrame`), so at 0.25x each take frame holds four timeline frames.
- Options: (a) keep (recommended); (b) a per-shot speed ramp could later reuse the envelope grammar (a normalized timing over the shot) if the owner wants ramps.
- Proposed amendment: none.
- Resolution (orchestrator, 2026-10-24): option (a) accepted (D4, rev 2).
