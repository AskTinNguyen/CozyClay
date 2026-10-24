# Shot Prompt Engine

- Rev: 1
- Status: active
- Area: Export
- Owner: TinNguyen
- Skill: `none`
- Branch: `intent/shot-prompt-engine`
- Worktree: `../CozyClay-wt/shot-prompt-engine`, port slot n=4 (dev 5204, live hub 5304, CDP 9304)
- Started: 2026-10-24

## Goal

Turn what CozyClay already knows about a sequence into prompts a video model can follow, for short films and game cinematics. The inputs are the shots, the measured camera, the cast's motion, the coverage and transitions, and the camera capabilities. Today `src/shot-prompt.js` writes one shot at a time with qualitative words. The owner's Prompt Edition collection (reviewed in L-1) shows what works in practice:

- **Structure:** a whole-sequence brief with numbered beats.
- **Camera:** camera language with real speeds and angles.
- **References:** a manifest of reference images by role.
- **Delivery:** per-model limits for length, aspect and what each model can and cannot do.

This intent builds that engine, and raises the agent prompt budget that the camera phases hit (camera-techniques F-1).

## Non-Goals

- Calling any paid video model API, or signing in anywhere. Prompts are text and files only.
- Copying Prompt Edition prompts or guides verbatim into the product: the structure and lessons are learned, the words are CozyClay's (contract Never list).
- New camera features (phases 1–3 are done) or motion compiler changes (frozen).

## Decisions

- D1 (rev 1): The engine is pure and deterministic, a function of the document. The same document gives the same prompt text, so it can be tested byte for byte and diffed between versions. Source: orchestrator.
- D2 (rev 1): Model profiles are data (`src/model-presets.js` or a sibling), each with limits, preferred phrasing and a `checkedAt` date with its source. Model facts that cannot be confirmed from a public page without signing in are marked unverified rather than guessed. Source: orchestrator under D3.
- D3 (rev 1): Owner is away and asked not to wait; reserved calls are decided by the orchestrator on the recommended option and recorded. Source: camera-techniques L-3.

## Acceptance

- A1: Sequence prompt. A `buildSequencePrompt(document, { range, profile })` writes one brief for a range of shots:
  - A header: format, total length, aspect, look.
  - The cast, with stable descriptors.
  - Numbered beats per shot, with timecodes, carrying size, angle, move, lens, the capabilities (roll, focus, shake, speed, blur), the composition, the coverage role and the transition into the shot.
  - A closing continuity line covering the line of action and screen direction.

  Shot-level prompts stay available and agree with it. Proof: gate: a new verify file on a fixture sequence (built with `camera.cover`) asserting beat count, timecodes, each beat's camera words matching `moveSequencePhrase` / the receipts, transitions present, and byte-identical output on two runs.
- A2: Measured camera language. Each move is stated with its measured values from the sampled camera: distance travelled in m, speed in m/s, pan and tilt in °/s, focal change in mm, roll in °, focus pull from and to in m. Hold or still shots say so. Proof: gate: verify file comparing stated numbers against `sampleAt` within rounding, for a push-in, a pan, a dolly zoom, a whip pan and a held shot.
- A3: Beats from motion. The brief marks story beats from the cast's motion (start and end of a walk, a reach or grab, a turn, a jump or landing), using the deterministic motion compiler's report and QA data read-only (no frozen-file edits). Each beat names its frame or timecode. Proof: gate: verify file on a fixture take with known actions asserting the beats and their frames within ±2 frames.
- A4: Reference manifest. Next to the prompt, a manifest lists the reference stills a model can be given, by role: first frame, last frame, character sheet per cast member, set or location, and the composition guide per shot. Each entry gives the file name inside the keyframe pack and the beat it serves. The keyframe pack writes `sequence-prompt.txt` and `references.json`. Proof: gate: verify file opening a generated keyframe pack (Git Bash `unzip -t` like `verify-keyframe-pack`) and checking the manifest against the files present.
- A5: Model profiles. Profiles for the presets the studio offers are updated and checked against public docs, with dates:
  - Kling: the current version replacing the stale 2.0 entry.
  - Veo: its allowed durations (the review noted a 4–8 s range against today's fixed 8 s).
  - MiniMax H3: the review noted 15 s against today's 10 s.
  - Every profile states its aspects.

  The profile shapes the brief (length limits, aspect, phrasing such as how each model wants camera moves, cuts in one clip or not, words to avoid). A shot or sequence that breaks a profile limit gets a warning with a fix (split here, trim to N s). The output aspect comes from the shot's or project's aspect, never a hardcoded value. Proof: gate: verify file per profile (limits, warnings, aspect carried through) plus a finding listing each fact with its source URL and date, or `unverified`.
- A6: Agents and the budget. MCP `render_prompt` gains `scope: shot | sequence` and a `profile`; `cclay live` reaches the same. The Studio agent system prompt budget is raised deliberately (camera-techniques F-1) with a matching update to `test/motion3/verify-motion3-prompt.mjs`, and the `shot.setCameraMode` sentence comes back alongside a short camera-library paragraph covering techniques, capabilities, coverage and cut checks. The budget change is recorded as a decision with its new number and why. Proof: gate: `node mcp/verify.mjs`, the motion3 prompt verify with the new budget, and a verify file for `render_prompt` sequence scope in memory.
- A7: UI. Export has a Sequence prompt view (or the existing prompt panel gains it) showing the brief for the selected shots or the whole sequence, with a profile picker, the warnings, and a copy button. Proof: ui:qa, a browser QA script selecting a range, switching profiles and checking the brief and warnings change; plus ui:shot of the view with a real brief.
- A8: The repository gates hold. Proof: gate: `npm run lint` (no baseline raised), `npm run build`, and `node tools/run-tests.mjs --jobs 4` from Git Bash with no dev server running, under the contract's known exception.
- A9: Docs updated: `mcp/README.md`, `docs/agent-cli.md`, `docs/studio-ui-ia.md`, `CHANGELOG.md` Unreleased. Proof: review.

## Constraints

- `CLAUDE.md`: the 250-line ratchet, knip and eslint baselines; new files stay under 250 lines.
- Edits go through the command bus; never write domain stores directly.
- Do not change the frozen motion files; read the motion report and QA data only.
- Keep the owner's own studio on ports 5180 / 5184 untouched; use slot n=4.
- Keep the branch merged with `origin/main` and pushed after every step (contract, Git And Merge).
- The Prompt Edition review notes are reference only and are never committed or quoted.

## Changelog

- rev 1 (2026-10-24): created from the Prompt Edition review (L-1) and camera-techniques F-1.
