# Camera Coverage

- Rev: 1
- Status: active
- Area: Camera and Shots
- Owner: TinNguyen
- Skill: `none`
- Branch: `intent/camera-coverage`
- Worktree: `../CozyClay-wt/camera-coverage`, port slot n=3 (dev 5203, live hub 5303, CDP 9303)
- Started: 2026-10-24

## Goal

Phase 3 of the camera library (`docs/intent/camera-techniques/`, `docs/intent/camera-capabilities/`). Phases 1 and 2 frame and move one shot. Phase 3 thinks in sequences, the way a director covers a scene for short films and game cinematics:

- It lays several shots at once from a coverage pattern.
- It places subjects by composition rules rather than only centring them.
- It checks the cut between shots against the editing rules a script supervisor would flag.

Agents drive all of this from natural language ("cover this dialogue", "give me master and coverage", "is the cut at 96 crossing the line?").

## Non-Goals

- The whole-sequence prompt engine, measured camera language and per-model profiles: the planned intent `shot-prompt-engine`.
- Lighting and look presets.
- Automatic editing (choosing cut points from performance); cut points come from the user or the pattern's even split.

## Decisions

- D1 (rev 1): A coverage pattern compiles into existing primitives: shots (split / add through the existing shot commands), then `camera.applyTechnique` on each, inside one bus run, so the whole pattern is one undo entry with one receipt listing each shot. Source: L-1 of camera-techniques; follows its D2.
- D2 (rev 1): Editing-rule checks are pure functions of the document (camera poses and subject positions at the cut frames), report-only: they never change shots by themselves. A separate fix command may apply a suggested fix when asked. Source: orchestrator under D3.
- D3 (rev 1): Owner is away and asked not to wait; reserved calls are decided by the orchestrator on the recommended option and recorded. Source: camera-techniques L-3.

## Acceptance

- A1: Coverage generator. `camera.cover` takes a pattern, the cast and a frame range, and lays the shots in one bus run. Patterns:
  - `shot-reverse-shot`: OTS A, OTS B, alternating, with the reverse on the same side of the line.
  - `master-coverage`: a wide master, then a medium on each speaker, then close-ups.
  - `dialogue-singles`: clean singles A and B.
  - `walk-and-talk`: a tracking two-shot, with a leading single.
  - `action-coverage`: an establishing wide, a tracking medium, then an insert or close-up on the beat, then a reaction.
  - `establish-detail`: extreme wide, wide, medium, then close-up on a subject.

  `shot-reverse-shot` stops being listed as needing `coverage-generator`, and `PLANNED_CAPABILITIES` becomes empty or loses that key. Proof: gate: a new verify file applying each pattern to a test scene and asserting shot count, ranges, technique stacks, one undo entry, and that every reverse stays on its side of the line.
- A2: Composition. `camera.applyTechnique` and `shot.frame` accept a composition intent: rule of thirds (left or right third), centre, headroom (tight, normal or loose), and lead room in the facing or travel direction. The framing places the subject's eyes on the chosen line and leaves space ahead of the facing direction. It is measured by projecting the subject into the frame, and the receipt reports the achieved screen position. The existing `shot-guides.js` overlay shows the lines. Proof: gate: verify file asserting projected eye-line and horizontal position within tolerance for each composition option.
- A3: Editing-rule checks. A read-only `camera.checkCuts` (and an MCP tool) reports for every cut between consecutive shots:
  - 180° line crossings, using the line between the two principal subjects or the subject's travel direction.
  - Cuts that change angle by less than 30° and size by less than one step (a jump cut).
  - Screen-direction flips for a moving subject.
  - Eyeline mismatches in shot-reverse-shot.

  Each issue carries a severity, the frames and a suggested fix (move to the other side, change size, insert a neutral or cutaway). The timeline marks flagged cuts. Proof: gate: verify file with constructed good and bad cuts for each rule; zero false flags on the A1 patterns.
- A4: Transitions. Cuts carry an optional transition: cut, dissolve, fade to or from black, whip (a whip pan pair), match cut, J-cut or L-cut as an audio offset note. It is stored on the cut and written to OTIO as a transition where OTIO supports it (otherwise as metadata), and stated in the prompt. The shot camera preview shows a dissolve or fade during playback. Proof: gate: verify file for storage, OTIO output and prompt; plus an A6 capture of a dissolve midpoint.
- A5: Agents. The catalog resolver maps coverage requests ("cover this conversation", "master and coverage", "walk and talk", "reverse on Joon", "rule of thirds left", "more lead room", "check my cuts") to `camera.cover` / composition / `camera.checkCuts`. MCP tools and `cclay live run` reach them, with the agent context pointer within the prompt budget (camera-techniques F-1). Proof: gate: verify files for the resolver phrases and the MCP calls in memory.
- A6: Visual proof through the lens. Proof: ui:shot, captures committed under `docs/intent/camera-coverage/proofs/`:
  - A contact sheet or frame grab of each shot of a shot-reverse-shot and of a master-coverage pattern.
  - A rule-of-thirds framing with the guide overlay.
  - The timeline with a flagged line-crossing cut and its readout.
  - A dissolve midpoint.
- A7: Controls. In Camera mode:
  - A Coverage action that picks a pattern and cast and lays it on the selected range.
  - Composition controls in the technique popover.
  - A cut inspector for the transition and the rule readout.

  Proof: ui:qa, a browser QA script that lays a pattern, sets a composition and a transition, and checks the document; plus ui:shot of the controls.
- A8: The repository gates hold. Proof: gate: `npm run lint` (no baseline raised), `npm run build`, and `node tools/run-tests.mjs --jobs 4` from Git Bash with no dev server running, under the contract's known exception.
- A9: Docs updated: `mcp/README.md`, `docs/agent-cli.md`, `docs/studio-ui-ia.md`, `CHANGELOG.md` Unreleased. Proof: review.

## Constraints

- `CLAUDE.md`: the 250-line ratchet, knip and eslint baselines; new files stay under 250 lines.
- Edits go through the command bus; never write domain stores directly.
- Do not change the frozen motion files.
- Keep the owner's own studio on ports 5180 / 5184 untouched; use slot n=3.
- Exports stay readable by their consumers; new fields are additive.
- Keep the branch merged with `origin/main` and pushed after every step (contract, Git And Merge).

## Changelog

- rev 1 (2026-10-24): created from the camera library plan (camera-techniques L-1, L-3).
