# Camera Capabilities

- Rev: 2
- Status: completed
- Area: Camera and Shots
- Owner: TinNguyen
- Skill: `none`
- Branch: `intent/camera-capabilities`
- Worktree: `../CozyClay-wt/camera-capabilities`, port slot n=2 (dev 5202, live hub 5302, CDP 9302)
- Started: 2026-10-24

## Goal

Phase 2 of the camera technique library (`docs/intent/camera-techniques/`). Six techniques in the catalog apply as prompt words only, because the camera lacks the capability (`PLANNED_CAPABILITIES` in `src/camera-techniques/entry.js`): roll, focus and depth of field, handheld shake, body mount, shot speed and motion blur. This intent gives the shot camera those six capabilities, from the document through the viewport, the shot camera preview, captures and every export. Then the catalog applies Dutch Angle, Canted Frame, Rack Focus, Handheld Shot, Snorricam, Slow Motion and Whip Pan (with blur) for real, and the receipts stop calling them prompt-only.

## Non-Goals

- `coverage-generator` (Shot-Reverse-Shot as a generator), composition rules and editing-rule QA: the planned intent `camera-coverage`.
- The whole-sequence prompt engine and the agent prompt budget (finding camera-techniques F-1): the planned intent `shot-prompt-engine`.
- Physically based bokeh shapes, lens distortion or chromatic aberration; a simple depth-of-field pass that reads correctly is enough.
- Fixing `tools/headless-studio.mjs` (camera-techniques F-2).

## Decisions

- D1 (rev 1, amended rev 2 from F-1): Each capability is a document field on the shot camera (static value, plus a per-key value on the camera's rig keys where it animates: roll and focus distance; rig keys are separate from the framing keys so a rack focus or roll change never alters the move), written only through the command bus, migrated so older documents load unchanged (absent means today's behaviour). Source: L-3, contract.
- D2 (rev 1): Shake is procedural and deterministic (seeded, the same frame gives the same offset), applied at sample time on top of the keyed camera, never baked into keys, so editing keys keeps the shake. Source: orchestrator, D3.
- D3 (rev 1): Owner is away and asked not to wait; reserved calls are decided by the orchestrator on the recommended option and recorded. Source: L-3.
- D4 (rev 2): F-2 option (a): the body mount follows the character's per-frame placement with bone height from proportions (deterministic in every surface); walk bob from baked bone tracks is a possible follow-up. F-3 option (a): shot speed is a constant per-shot time factor in its own module; speed ramps may later reuse the envelope grammar. Source: orchestrator under D3.

## Acceptance

- A1: Roll. The shot camera carries roll in degrees, static or keyed (keys interpolate with the existing eases). It shows in the viewport camera, the shot camera preview and captures, and in `camera.json` of the keyframe pack, the USD camera (`src/usd-camera.js`) and OTIO metadata (`src/otio.js`). `classifyMove` / `moveSequencePhrase` name a roll change. Proof: gate: a new verify file covering storage round-trip, sampling, and each export carrying roll.
- A2: Focus and depth of field. The shot camera carries an aperture (f-stop) and a focus distance or a focus target (a cast member or object, resolved per frame), keyed so a rack focus moves focus between two subjects over a frame range. The shot camera preview and captures render depth of field from those values (off when aperture is unset). Exports carry focal distance and f-stop (USD `focusDistance` / `fStop`, `camera.json`). Proof: gate: verify file for storage, focus-target resolution, rack interpolation and exports.
- A3: Handheld shake. A shake setting (amplitude, frequency, a seed, a style such as handheld or vehicle) adds deterministic sample-time motion (position and rotation) on the shot camera, the same in preview, capture and export (exports bake the shaken result per frame where they bake frames). Proof: gate: verify file asserting determinism (same seed, same frame, same pose), zero shake when off, and amplitude bounds.
- A4: Body mount (Snorricam). The shot camera can mount to a character bone (for example the chest) with an offset and a look-back at the face, following the bone per frame, so the character stays fixed in frame while the world moves. Proof: gate: verify file asserting the subject's screen position is near-constant across a moving take while the background moves.
- A5: Shot speed and motion blur. A shot carries a speed factor (slow motion below 1) that retimes how the shot samples the take (check `src/speed-envelope.js` first and reuse it), reported in the timeline and stated in the prompt; and a motion-blur setting (shutter angle) that the preview or capture renders for fast camera moves, at least for a whip pan. Proof: gate: verify file for speed mapping and the shutter value in exports; plus the A7 captures.
- A6: Catalog and agents. Dutch Angle, Canted Frame, Rack Focus, Handheld Shot, Snorricam, Slow Motion and Whip Pan apply their capability through `camera.applyTechnique`, the receipt reads back what was achieved (roll degrees, focus subjects, shake amplitude, mount bone, speed, shutter) and no longer lists them as prompt-only; `PLANNED_CAPABILITIES` keeps only `coverage-generator`. The MCP tools and `cclay live run` reach the new fields; the prompt (`src/shot-prompt.js`, keyframe pack `prompt.txt`, MCP `render_prompt`) states them. Proof: gate: the camera-techniques verify files updated and passing, plus a new verify for the six techniques.
- A7: Visual proof through the lens. Proof: ui:shot, captures committed under `docs/intent/camera-capabilities/proofs/`: a Dutch angle (tilted horizon), a rack focus at its start and end frames (focus visibly moves between two characters), a handheld take (two nearby frames differ slightly), a snorricam take at two frames (character fixed, world moved), and a whip pan with motion blur.
- A8: Controls. The Camera panel shows the new settings (roll, aperture and focus, shake, mount, speed, shutter) with their keys on the timeline camera lane where they animate, and the technique picker applies the seven techniques. Proof: ui:qa, a browser QA script setting each control and checking the document changed; plus ui:shot of the panel.
- A9: The repository gates hold. Proof: gate: `npm run lint` (no baseline raised), `npm run build`, and `node tools/run-tests.mjs --jobs 4` under the contract's known exception, run from Git Bash (some checks call `unzip`).
- A10: Docs updated: `mcp/README.md`, `docs/agent-cli.md`, `docs/studio-ui-ia.md`, `CHANGELOG.md` Unreleased. Proof: review.

## Constraints

- `CLAUDE.md`: the 250-line ratchet, knip and eslint baselines; new files stay under 250 lines.
- Edits go through the command bus; never write domain stores directly.
- Do not change the frozen motion files.
- Keep the owner's own studio on ports 5180 / 5184 untouched; use slot n=2.
- Exports stay readable by their consumers: existing fields keep their meaning; new fields are additive.

## Reviews

Orchestrator review of the ui:shot images and the docs, branch `intent/camera-capabilities` at 9b738d82, 2026-10-24.

| Item | Image or file | What it shows | Verdict |
| --- | --- | --- | --- |
| A7 | `proofs/dutch-angle.png` | The horizon and pillars tilted roughly 20° across the frame, two characters on the grid. | met |
| A7 | `proofs/rack-focus-start.png`, `rack-focus-end.png` | Start: the near character sharp, the far character and pillars soft. End: the near character soft, the far character sharp. Focus visibly moves between the two. | met |
| A7 | `proofs/handheld-a.png`, `handheld-b.png` | Two nearby frames of the same framing, offset by a small translation and rotation (pillars and figures shifted a few pixels). | met |
| A7 | `proofs/snorricam-start.png`, `snorricam-end.png` | The mounted figure's head and shoulders hold the same place in frame; the world behind changes (red and blue pillars at the start, purple and gold at the end). The proxy figure has no face, so which way the camera looks is read from the progress record, not the image. | met |
| A7 | `proofs/whip-pan-blur.png`, `whip-pan-no-blur.png` | With 180° shutter, a heavy horizontal smear across the frame; without, the same moment sharp. The blur shows visible sample banding (residual, see Close). | met |
| A8 | `proofs/camera-rig-panel.png` | Camera mode: the Camera rig section (Roll, Aperture, Focus, Shake, Amount, Mount, Speed, Shutter, Key roll / Key focus, two rig keys, a readback line), the timeline with Dutch, Rack, Snorricam, Whip and Handheld shots and rig-key dots on the camera lane, and a tilted Shot Camera preview. | met |
| A10 | `mcp/README.md`, `docs/agent-cli.md`, `docs/studio-ui-ia.md`, `CHANGELOG.md` (1985e572) | Capability tool, live verbs, rig controls and an Unreleased line. | met |

Gates re-run by the orchestrator in the worktree (Git Bash): `verify-camera-roll` 7, `-focus` 5, `-shake` 7, `-mount` 5, `-speed` 5 checks passed; `bus/verify-camera-capability-techniques` pass; the camera-techniques verify files pass (`12`, apply suite, `6`, MCP `14 passed, 0 failed`); `mcp/verify.mjs` `all checks passed`; `mcp/verify-camera-capabilities.mjs` `9 passed, 0 failed`; `npm run lint` exit 0 (`knip: 138 findings, 0 new`, `0 violations`, `eslint: 396 errors … 0 regressions`); `npm run build` exit 0; no diff to `tools/*-baseline.json` or the frozen motion files; `node tools/run-tests.mjs --jobs 4` (Git Bash, no dev server): only failure `FAIL exit car, hips sunk: under 10 s — 10829 ms` (known exception; base 6b751b6f fails it too, `— 10937 ms`, per the worker).

Residual risks recorded at close: the whip-pan motion blur shows visible sample banding at high pan speed (more sub-frame samples or a velocity blur would smooth it); the snorricam mount carries no walk bob (F-2 (b)); the suite crashes `verify-agent-routes` / `verify-agent-supervisor` when a dev server is running beside it (run the suite with no dev server).

## Changelog

- rev 1 (2026-10-24): created from camera-techniques Non-Goals and L-3.
- rev 2 (2026-10-24): F-1 folded into D1 (rig keys); F-2 and F-3 accepted as D4. No Acceptance change.
- rev 2 (2026-10-24): completed. Every Acceptance row met with orchestrator review; PR #4 squash-merged.
