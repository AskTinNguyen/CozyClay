# Camera Motivation

- Rev: 1
- Status: planned
- Waits for: `director-evals` completed (its eval set takes this intent's scenarios). Second in the cinematic-atlas plan.
- Area: Camera and Shots
- Owner: TinNguyen
- Skill: `none`
- Branch: `intent/camera-motivation`
- Worktree: `../CozyClay-wt/camera-motivation`, port slot n=8 (dev 5208, live hub 5308, CDP 9308)

## Goal

Proposal 2 of the cinematic-atlas review (L-1). A camera move should have a reason: a story event, a player input, a disclosure, or a subject it follows. It should also start and settle on the beat that motivates it.

CozyClay already measures every move (`measureShotCamera` in `src/shot-prompt-engine/measure.js`) and finds motion beats in the cast's takes (`motionBeats` / `beatsIn` in `src/shot-prompt-engine/motion-beats.js`). This intent adds three things:

- authored story beats for what motion cannot show, such as a line of dialogue or a reveal;
- a report-only check that names unmotivated moves and moves that start or settle off their beat;
- a fix command that aligns a move to a beat when asked.

## Non-Goals

- Retiming moves on its own. The check reports, and only `camera.alignMove` changes a shot, when it is asked to.
- Dialogue or audio import. Story beats are authored marks.
- Choosing cut points (the camera-coverage non-goal stands).

## Decisions

- D1 (rev 1): the check is a pure function of the document and report-only, like camera-coverage D2. Source: orchestrator.
- D2 (rev 1): a move counts as motivated when one of these holds:
  - a story beat or motion beat falls within a tolerance window of the move's start, or inside the move;
  - the camera's travel follows the subject's travel (follow cam, tracking, mount) within tolerance.

  Holds and static framings are never flagged. Source: orchestrator.
- D3 (rev 1): authored story beats are new document data. That is a product call, so F-1 puts it to the owner; the acceptance below assumes the recommended option.

## Acceptance

- A1: Story beats. A beat is `{ frame, label, kind }`, with kind one of disclosure, reveal, threat, decision, input or event. Bus actions add, move and remove beats, each as one undo entry. Beats are drawn on the timeline and written to OTIO as markers, and the sequence brief's beats name them. Older documents load unchanged. Proof: gate: `node test/bus/verify-story-beats.mjs`.
- A2: Check. `camera.checkMotivation` (read-only) splits each shot's measured camera into move segments and classifies each one: motivated by a beat, motivated by a subject, or unmotivated. It also reports `starts-off-beat` / `settles-off-beat` when the motivating beat is more than a tolerance away from the move's start or end. Each issue carries a severity, the frames and a suggested fix ("hold", "start the push at f120 on 'admission'", "settle on the landing at f166"). Proof: gate: `node test/verify-camera-motivation.mjs` with constructed good and bad moves.
- A3: No false flags. The check reports zero issues on every `camera.cover` pattern's fixture shots and on a follow-cam shot of a walking subject. It flags a push-in laid in a beatless window. Proof: gate: the same verify file.
- A4: Fix. `camera.alignMove { shotId, beat }` retimes the move's keys or rig keys so it starts or settles on the beat, as one undo entry. A re-check is clean. Proof: gate: `node test/bus/verify-camera-align-move.mjs`.
- A5: Controls. The timeline marks unmotivated moves the way it marks flagged cuts, and the cut inspector (or a Camera-mode readout) explains them and offers the fix. Proof: ui:qa, a browser QA script that adds a beat, lays a push-in off it, reads the flag, applies the fix and checks the document; plus ui:shot of the flagged timeline.
- A6: Agents. Resolver phrases ("is this move motivated?", "start the push on the reveal", "add a beat 'confession' at 120") reach the new actions, and an MCP `check_motivation` tool and `cclay live run` reach the check. Through MCP memory, where takes are not installed, the check uses story beats and subject travel only and says so in its answer. `director-evals` gains at least 8 core motivation scenarios. Proof: gate: `node mcp/verify-camera-motivation.mjs` and `node test/verify-director-evals.mjs`.
- A7: Prompt. The sequence brief states a motivated move's reason ("pushes in as Mara makes her admission"). Output stays byte-identical across runs. Proof: gate: `node test/bus/verify-sequence-prompt.mjs` updated.
- A8: The repository gates hold. Proof: gate: `npm run lint` (no baseline raised), `npm run build`, and `node tools/run-tests.mjs --jobs 4` from Git Bash with no dev server running, under the contract's known exception.
- A9: Docs updated: `mcp/README.md`, `docs/agent-cli.md`, `docs/studio-ui-ia.md`, `CHANGELOG.md` Unreleased. Proof: review.

## Constraints

- `CLAUDE.md`: the 250-line ratchet, knip and eslint baselines; new files stay under 250 lines.
- Edits go through the command bus; never write domain stores directly.
- Do not change the frozen motion files; read the motion report and QA data only.
- The Studio agent system prompt cap is 13,400 characters (shot-prompt-engine D5) with about 45 spare. A new sentence either raises the cap as a recorded decision, or the capability is reached through action descriptions alone.
- Keep the owner's own studio on ports 5180 / 5184 untouched; use slot n=8.
- Keep the branch merged with `origin/main` and pushed after every step (contract, Git And Merge).
- Source material: the cinematic-atlas repo is reference only; nothing from its books is committed or quoted.

## Changelog

- rev 1 (2026-10-24): written as a planned intent from the cinematic-atlas review (L-1, L-2).
