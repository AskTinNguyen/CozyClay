# Unreal Bridge

- Rev: 1
- Status: planned
- Waits for: nothing. Start when a builder with Unreal Engine on the machine picks it up.
- Area: Agents and Live
- Owner: TinNguyen
- Skill: `none`
- Branch: `intent/unreal-bridge`
- Worktree: `../CozyClay-wt/unreal-bridge`, port slot n=15 (dev 5215, live hub 5315, CDP 9315, Unreal Remote Control HTTP 30015)

## Handoff

This intent was written by a cloud session that has no Unreal Engine. The builder is a local agent with Unreal Engine and this repository on the same machine. Everything on the CozyClay side was read on `main` at `c8056c3`; nothing on the Unreal side has been run. Treat every Unreal API named here as the plan, confirm it against the installed engine, and record what differs as a finding.

Read first, in this order:

1. [`docs/unreal-bridge.md`](../../unreal-bridge.md): the design. The space and time contract in it is binding; the module list and tool names are the plan.
2. `mcp/README.md` and `mcp/LIVE-PROTOCOL.md`: the MCP server the new tools join, and how in-memory and live modes differ.
3. The data the bridge converts: `src/director-packet/packet.js` (`directorPacket`), `src/usd-camera.js` (per-frame camera samples, the YXZ quaternion, the gate rule), `src/otio.js` (`shotMetadata`, blocking), `src/shot.js` (`usedSensorHeightMm`), `src/shot-prompt-engine/sequence.js` (`deliveryStart`), `src/camera-coverage/cut-geometry.js` (`castAt`), `src/camera-coverage/composition.js` (`eyePoint`, `projectPoint`).
4. `mcp/director-packet-tool.mjs` and `mcp/verify-director-packet.mjs`: the pattern for an in-memory MCP tool and its verify file.

## Goal

A CozyClay scene lands in Unreal Engine as a cinematic blockout: a Master Level Sequence that plays CozyClay's cut, one CineCamera per shot with CozyClay's lens and move, stand-ins for the cast walking their marks, the set as blockout geometry, and story beats as marked frames. An agent does it with one MCP call, either into a running Unreal Editor or as a folder imported by hand, and a second push updates the blockout instead of duplicating it.

This intent covers phases P0 and P1 of the design. P2 (motion retargeting, looks, director overlay) and P3 (round trip) become their own intents once this one completes.

## Non-Goals

- Retargeted character animation, the colour script lighting rig and the director overlay (P2).
- Reading edits back from Unreal (P3).
- Any change to the existing 39 MCP tools, or a second implementation of any CozyClay camera rule inside Unreal.
- Final lighting, render farm setup, MetaHumans.

## Decisions

- D1 (rev 1): The handoff document `unreal-handoff.json` is pure data in Unreal units, deterministic like `packet.json`, built in `src/unreal/`. The Unreal importer does no coordinate math. Source: design doc, recommendation 2.
- D2 (rev 1): Unreal-side code lives in this repository under `unreal/CozyClayBridge/` (an editor plugin: Python importer, thin C++ or Python menu shell). It is copied or symlinked into the test project's `Plugins/`. Source: orchestrator; keeps the contract and both ends in one PR.
- D3 (rev 1): Owner defaults from the design doc apply until the owner says otherwise: Unreal 5.4 or newer (target the installed version first), CozyClay owns cameras after handoff, the UE Mannequin as the stand-in with only its root keyed, cameras keyed every frame. Source: design doc, Decisions for the owner.

## Acceptance

- A1: Space. `src/unreal/space.js` converts positions, camera rotations, cast facing, filmback and frame ranges exactly as the design's contract states. A golden test projects every cast eye point at the first, middle and last frame of every shot through the CozyClay camera and through the converted camera with Unreal's projection formula, and they agree within 0.5 px at 1920×1080. Fixtures include a Dutch-angle shot (roll), a yaw past ±90°, a 2.39 and a 9:16 aspect, and a moving camera. Proof: gate: `node test/verify-unreal-space.mjs`.
- A2: Handoff. `unrealHandoff(document, { range })` returns the handoff document (sequence with Master, Action and shot entries, cameras, cast root tracks, set, beats, flags), byte-identical across three runs, on a `camera.cover` master-coverage fixture and a triangle-dialogue fixture. Overlapping coverage shots keep their own scene ranges. Proof: gate: `node test/verify-unreal-handoff.mjs`.
- A3: Export. An MCP `unreal_export` tool writes the handoff folder (`unreal-handoff.json`, `README.txt`, glTF for any sculpt or imported mesh) under `COZYCLAY_PROJECT_ROOT` with the same path rules as `save_project`, in memory with no editor. Proof: gate: `node mcp/verify-unreal-export.mjs`.
- A4: Import. The `CozyClayBridge` importer, run headless (`UnrealEditor-Cmd <project> -run=pythonscript -script=<repo>/unreal/CozyClayBridge/Content/Python/tests/run_import_test.py`, or the engine's equivalent), imports the A2 fixtures' folders and asserts: the Master sequence's shot sections at each shot's edit start and length; each shot sequence's play range `[start, end + 1)`; each CineCamera's filmback, focal length and aperture; the camera transform at the first, middle and last frame equal to the handoff values within 0.01 cm and 0.01°; one marked frame per story beat. Proof: ue:gate.
- A5: Same picture. For every shot of the master-coverage fixture, the importer test projects each stand-in's head socket through Unreal's own camera (the engine's projection, not the formula from A1) at the first, middle and last frame, and matches CozyClay's projection within 1 px at 1920×1080. A high-resolution screenshot from three shots is committed beside CozyClay's frame of the same shot. Proof: ue:gate for the numbers; ue:shot for the pictures.
- A6: Live push. With the editor running and the plugin enabled, `unreal_status` reports the engine version, open level and plugin handoff version; `unreal_sync` pushes the fixture and returns one receipt per module; `unreal_sync { dry_run: true }` changes nothing and lists the plan. Transport: Remote Control API on port 30015, with Python remote execution as the fallback when Remote Control is off. Proof: gate: `node mcp/verify-unreal-live.mjs` against a fake Unreal endpoint (the pattern of `mcp/verify-live.mjs`), and ue:gate for one real push.
- A7: Re-sync. Every created object carries `cozyclay:id`, `cozyclay:scene` and `cozyclay:hash` tags. A second identical push changes nothing; a camera moved by hand in Unreal survives a re-push and comes back as a conflict in the receipt, and is replaced only with `overwrite: true`; one push is one undo transaction. Proof: ue:gate.
- A8: The repository gates hold. Proof: gate: `npm run lint` (no baseline raised), `npm run build`, `node mcp/verify.mjs`, and `node tools/run-tests.mjs --jobs 4` under the contract's known exception.
- A9: Docs: `mcp/README.md` (the new tools and the Unreal section), `docs/unreal-bridge.md` (mark what was built, correct anything the engine contradicted), `CHANGELOG.md` Unreleased, and `unreal/CozyClayBridge/README.md` (install, enable Remote Control, run the importer by hand). Proof: review.

## Proof kinds this intent adds

The contract's proof table has no Unreal rows. For this intent:

- `ue:gate`: a command run against the local Unreal Editor (headless `-run=pythonscript` or a live editor) exited 0 and printed its pass count with zero failures. Quote the command with machine paths redacted, the engine version, and the result line in `progress.md`.
- `ue:shot`: a screenshot taken by a command inside Unreal (`HighResShot` or the plugin's capture), committed under `docs/intent/unreal-bridge/proofs/`, with the command, engine version and exit code in `progress.md`. The orchestrator opens the image and records what it shows as a `review` row before the item counts.

Neither runs in CI or in a cloud session. The Node gates (A1 to A3, A6's fake endpoint, A8) must not need Unreal.

## Constraints

- `CLAUDE.md`: the 250-line ratchet (new `.js`/`.mjs` files stay under 250 lines), knip and eslint baselines. New tests go into `NODE_FILES` in `tools/run-tests.mjs`.
- The space conversion has one home, `src/unreal/space.js`. The Python importer reads converted numbers and does not re-derive them. If the importer needs a conversion it cannot avoid (for example a quaternion), it gets it from the handoff document.
- Roll's sign is decided by the A1 and A5 tests, not by reasoning. If the design doc's formula is wrong, fix the doc in this PR and say so in `findings.md`.
- Existing exports stay as they are (`node test/verify-keyframe-pack.mjs`, `node test/verify-director-packet.mjs` and the USD and OTIO verify files keep passing).
- Do not commit Unreal project files, `.uasset` binaries, Intermediate, Saved or DerivedDataCache folders. Test levels are built by the test script.
- Keep the owner's studio ports 5180 / 5184 and Unreal's default Remote Control port 30010 untouched; use slot n=15.
- Keep the branch merged with `origin/main` and pushed after every step (contract, Git And Merge).

## Next intents (write when this completes)

- `unreal-bridge-motion` (P2): take export and the Mixamo X Bot / Y Bot to Manny retarget, sculpt and imported mesh export, the colour script lighting rig, the director overlay and flag panel.
- `unreal-bridge-roundtrip` (P3): `unreal_pull`, `unreal_check`, `unreal_capture`.

## Changelog

- rev 1 (2026-10-25): written as a planned intent from the Unreal bridge proposal (L-1, L-2), with a handoff to a local builder that has Unreal Engine.
