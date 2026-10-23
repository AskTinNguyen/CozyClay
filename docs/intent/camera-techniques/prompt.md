# Camera Technique Library

- Rev: 1
- Status: active
- Area: Camera and Shots
- Owner: TinNguyen
- Skill: `none`
- Branch: `intent/camera-techniques`
- Worktree: `../CozyClay-wt/camera-techniques`, port slot n=1 (dev 5201, live hub 5301, CDP 9301)
- Started: 2026-10-24

## Goal

Bring the camera techniques catalogued on grokfilm.app into CozyClay so they are easy to pick in the studio and drivable by agents from natural-language requests ("low-angle slow push-in on her", "make the reveal feel epic", "give me a vertigo shot"). This is Phase 1 of the proposal in log entry L-1: a technique catalog, one apply command that compiles a technique stack into the camera primitives CozyClay already has, agent / MCP / CLI access, a picker in the UI, and prompt sync.

The 65 camera technique names on grokfilm.app (general film vocabulary; the names only, never their definitions or reels):

Aerial Shot, Bird's Eye View, Close-Up Shot, Dutch Angle, Dolly Shot, Establishing Shot, Extreme Close-Up, Extreme Long Shot, Eye-Level Shot, Handheld Shot, Head-On Shot, Helicopter Shot, High Angle Shot, Insert Shot, Long Shot, Low Angle Shot, Master Shot, Medium Shot, Over-the-Shoulder Shot, Overhead Shot, Pan Shot, P.O.V. Shot, Rack Focus, Slow Motion, Steadicam Shot, Tracking Shot, Vertigo Effect, Crane Shot, One-er (Oner), Tilt Shot, Whip Pan, Two-Shot, Three-Shot, Cowboy Shot, Medium Close-Up, Choker Shot, Canted Frame, Zoom Shot, Push In, Pull Out, 360-Degree Shot, Static Shot, Crash Zoom, Snorricam, Locked-Down Shot, Worm's Eye View, Impossible Shot, Arc Shot, Boom Shot, Dolly-In, Dolly-Out, Dolly Zoom, Follow Shot, Jib Shot, Pedestal Shot, Smooth Tracking Shot, American Shot, Full Shot, Head Shot, Italian Shot, Profile Shot, Reverse Angle, Shot-Reverse-Shot, Trunk Shot, Wide Shot.

## Non-Goals

- New camera capabilities: roll (Dutch Angle, Canted Frame), focus distance and depth of field (Rack Focus), procedural handheld shake (Handheld Shot), camera-on-body (Snorricam), shot speed (Slow Motion), motion blur (Whip Pan blur). Those are the planned intent `camera-capabilities`. In this intent they exist in the catalog, marked with the capability they need, and apply as prompt-only (the receipt says so).
- Coverage patterns that create several shots (Shot-Reverse-Shot as a generator), composition rules, editing-rule QA: the planned intent `camera-coverage`.
- The whole-sequence prompt engine from the Prompt Edition review: the planned intent `shot-prompt-engine`.

## Decisions

- D1 (rev 1): Descriptions in the catalog are written fresh in CozyClay's voice. grokfilm.app is linked as further reading, never copied. Source: L-1, contract Never list.
- D2 (rev 1): The apply command compiles to existing primitives (`shot.frame` framing intent and keys, `shot.setCameraRail`, `shot.setCameraMode`, follow parameters) inside one bus run, so each request is one undo entry with one receipt. Source: L-1.
- D3 (rev 1): Owner is away and asked not to wait; reserved calls are decided by the orchestrator on the recommended option and recorded. Source: L-3.

## Acceptance

- A1: A catalog module (for example `src/camera-techniques/`) holds every one of the 65 names above as an entry with id, display name, aliases, kind (size, angle, move, lens, coverage, modifier), mood tags, a fresh one-to-two sentence description, parameters with defaults, a recipe, prompt wording, and a `requires` capability list for the techniques in the Non-Goals. Proof: gate: a new verify file (for example `node test/verify-camera-techniques.mjs`) asserting all 65 names resolve, ids and aliases are unique, and every entry has the fields.
- A2: A resolver maps natural phrases to techniques: exact names, aliases ("vertigo", "zolly", "Hitchcock zoom", "god's eye", "OTS", "POV", "worm's eye"), fuzzy spelling, and mood queries ("uneasy", "epic reveal", "intimate"). Proof: gate: the A1 verify file (or its own) with at least 20 phrase cases.
- A3: `camera.applyTechnique` applies a stack (size + angle + move + lens, with parameters such as speed slow/medium/fast, start and end size, degrees) to a shot on a named subject as one undo entry with a receipt that reads back what was achieved, reports framing checks, and lists any prompt-only parts. It supports: all size and angle framings; keyed moves (push in / pull out / dolly in / dolly out, zoom, crash zoom with a constant-speed ease, pan, tilt, whip pan without blur, pedestal, crane / boom / jib, arc, a full 360-degree orbit, dolly zoom); rail and follow techniques (tracking, follow, smooth tracking, steadicam, dolly shot, one-er, helicopter); group framing for two-shot, three-shot and over-the-shoulder; POV from a character's eye. Proof: gate: a new verify file applying each supported technique to a test scene, with `classifyMove` on the result equal to the technique's expected move for every move technique.
- A4: Agents can discover and call it: a read-only compact index (`camera.techniques`, within the 8 KiB receipt budget) and `camera.describeTechnique`; MCP tools for listing and applying; `cclay live run camera.applyTechnique …` works; the Agent panel's context tells the model the library exists and how to stack techniques. Proof: gate: `node mcp/verify.mjs` with the tool count updated, plus a verify file exercising the MCP apply in memory.
- A5: Natural-language path end to end: against a running studio (headless is fine), a request resolved through the resolver and applied through the live hub moves the real shot camera, and a capture through the lens shows the result. Proof: ui:shot, at least three captures (a static framing such as low-angle close-up, a move such as push-in at its start and end frames, and a group framing such as over-the-shoulder), committed under `docs/intent/camera-techniques/proofs/`.
- A6: A technique picker in Camera mode: searchable, with kind tabs, a mood filter, a short description and a small top-down diagram of the camera path drawn from the recipe; clicking applies to the selected shot, with a parameter popover; the timeline shot block shows the applied stack (for example "LOW · PUSH-IN · 35mm"). Proof: ui:qa, a browser QA script that opens the picker, searches, applies a technique and checks the shot camera changed; plus ui:shot screenshots of the picker and of the applied result.
- A7: The applied stack is stored on the shot (persisted, migrated, survives save and reload) and the export prompt (`src/shot-prompt.js`, keyframe pack `prompt.txt`, MCP `render_prompt`) states it in words the move classifier confirms. Proof: gate: a verify file covering storage round-trip and prompt text.
- A8: The repository gates hold. Proof: gate: `npm run lint` (no baseline raised), `npm run build`, and `node tools/run-tests.mjs --jobs 4` under the contract's known exception.
- A9: Docs updated: `mcp/README.md`, `docs/agent-cli.md`, `docs/studio-ui-ia.md`, `CHANGELOG.md` Unreleased. Proof: review.

## Constraints

- `CLAUDE.md`: the 250-line ratchet, knip and eslint baselines; new files stay under 250 lines (split modules).
- Edits go through the command bus; never write domain stores directly.
- Do not change the frozen motion files.
- Keep the owner's own studio on ports 5180 / 5184 untouched; use slot n=1.
- Descriptions are original text (D1).

## Changelog

- rev 1 (2026-10-24): created from L-1, L-2 and L-3.
