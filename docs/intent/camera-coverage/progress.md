# Camera Coverage: Progress

- Working under rev: 1
- Worker: `camera-coverage-worker`
- Current step: A7 controls
- Next step: A7 controls (Coverage action, composition fields, cut inspector, timeline marks), then A6 captures
- PR: none yet

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | `node test/bus/verify-camera-coverage.mjs` -> `tests 4, pass 4, fail 0`: all six patterns (`PASS shot-reverse-shot: SRS 1 · OTS Mara [0-47] ...`), one undo each, even ranges, stacks, coverage record, every camera on one side of the line, 0 cut issues; `PLANNED_CAPABILITIES` is `{}` (`node test/verify-camera-techniques.mjs` -> `12 checks passed`) |
| A2 | met (gate) | `node test/bus/verify-camera-composition.mjs` -> `tests 3, pass 3, fail 0`: three-js projection of the eyes through every stored key within 0.012 of each third/centre and each headroom line (`PASS 9 placements x 3 stacks`), lead room by facing and `more`, `shot.frame` the same; receipt `screenX`/`eyeLineY` |
| A3 | partly (gate met; timeline marks and MCP tool to come) | `node test/verify-camera-cut-rules.mjs` -> `6 checks passed` (good/bad cut per rule, `48 plans, 120 cuts, 0 flags`); `camera.checkCuts` in `test/bus/verify-camera-coverage.mjs` |
| A4 | partly (gate met; dissolve capture is A6) | `node test/bus/verify-camera-transitions.mjs` -> `tests 3, pass 3, fail 0` (storage, undo, reload, OTIO Transition.1 / metadata, prompt and prompt.txt, preview lens-plan weights) |
| A5 | met (gate) | `node test/verify-camera-coverage-resolve.mjs` -> `5 checks passed` (14 coverage, 8 composition, 6 cut-question phrases; technique phrases untouched; prompt pointer, length 12,789 <= 12,790); `node mcp/verify-camera-coverage.mjs` -> `14 passed, 0 failed` (cover_scene / check_cuts in memory); `node mcp/verify.mjs` -> `32 tools registered`, `all checks passed`; `node test/motion3/verify-motion3-prompt.mjs` -> `all checks passed`; live `cclay live run` in the A6 run |
| A6 | open | |
| A7 | open | |
| A8 | open | |
| A9 | open | |

## Steps

1. Setup: `npm ci` and `npm --prefix mcp ci` in the worktree (both exit 0). Baseline `npm run lint` on 7f92eaac: `knip: 138 findings, 0 new, 1 fixed (baseline 139)`, `loc: 72 files over 250 (baseline 72), 0 violations`, `eslint: 396 errors across 20 rules (baseline 403), 0 regressions`.
2. A1-A4 core (commit below): `src/camera-coverage/` (`patterns.js` six patterns, `plan.js` range split and side-of-line choice by compiling each stack both ways, `composition.js` thirds/centre/headroom/lead room by turning the aim and measuring the projected eyes, `cut-geometry.js` + `cut-rules.js` line/jump/screen/eyeline, `transitions.js`, `transition-sample.js`, `resolve.js`, `storage.js`); `src/commands/camera-coverage.js` (`camera.cover`, `camera.checkCuts`, `camera.setTransition`, registered from `commands/camera.js`); `camera.applyTechnique` takes `side` and `composition` and routes coverage/cut requests; `shot.frame` takes `composition`; the compiler takes a shared `side`; OTIO, prompt, capture meta, lens plan and preview rig carry transitions. Results: `node test/bus/verify-camera-coverage.mjs` -> `pass 4, fail 0`; `node test/bus/verify-camera-composition.mjs` -> `pass 3, fail 0`; `node test/verify-camera-cut-rules.mjs` -> `6 checks passed`; `node test/bus/verify-camera-transitions.mjs` -> `pass 3, fail 0`; earlier camera files still pass: `verify-camera-techniques-apply` `pass 5, fail 0`, `verify-camera-capability-techniques` `pass 3, fail 0`, `verify-camera-technique-prompt` `6 checks passed`, `verify-camera-techniques` `12 checks passed`.
3. A5 agents: `mcp/camera-coverage-tools.mjs` (`cover_scene`, `check_cuts`; live -> `camera.cover` / `camera.checkCuts`, memory -> plan + cut check), registered line-neutral in `mcp/tool-handlers.mjs` (re-exported through `camera-capability-tools.mjs`); agent prompt: the film-terms sentence names coverage and step 4 names `camera.checkCuts` (12,789 characters, budget 12,790; camera-techniques F-1). Results: `node test/verify-camera-coverage-resolve.mjs` -> `5 checks passed`; `node mcp/verify-camera-coverage.mjs` -> `14 passed, 0 failed`; `node mcp/verify.mjs` -> `32 tools registered ... all checks passed`; `node test/verify-tool-handlers.mjs` -> `PASS tool handler registry (32 tools, importable without an MCP server)`; `node mcp/verify-tool-annotations.mjs` -> `PASS G005 tools/list safety contract (32 tools; deterministic order)`; `node mcp/verify-live.mjs` -> `tool list: 32 tools, identical to the recorded list`; `node test/bus/verify-command-registry.mjs` -> `PASS #437 acceptance 3: the registry lists 127 actions read from 13 command modules`; `node test/motion3/verify-motion3-prompt.mjs` -> `verify-motion3-prompt: all checks passed`.

## Decisions

- A transition is stored on the incoming shot (`shot.transition { type, frames?, offsetFrames?, note? }`), absent for a plain cut; coverage on each laid shot (`shot.coverage { pattern, index, role, subjectId }`). Both additive, repaired in one helper (`camera-coverage/storage.js`) that replaced the technique line in `shot-authoring.js` (line-neutral).
- `camera.cover` lays the range as one shot through `shot.split` / `shot.remove` + `shot.create` + `shot.setRange`, then `shot.split` at each cut (moving the playhead there and back, as `shot.split` cuts at the playhead), `shot.rename`, and `camera.applyTechnique` per shot: one bus run, one undo entry (D1).
- The side of the line: the first shot's camera picks it; every later stack is compiled with the camera on the subject's right and left and the one that stays on that side wins (a pattern may list alternate stacks, e.g. a front-three-quarter smooth track when a profile track would straddle the line). A camera within 0.2 m of the line is a neutral.
- Composition keeps the camera position and lens and turns only the aim (exact yaw/pitch solve), on every key of a move, so a push-in keeps the subject on its third; eyes are taken from the placement (93 % of stature), never a posed bone, so every surface measures the same point. Not applied to group framings, POV or rails (a note says so). The stack stores its composition and side so composition words alone ("more lead room") re-place the subject in the current stack.
- Cut rules: principals are each shot's subject (coverage record, else the character nearest the frame centre), or the nearest other character; a lone moving subject's flip is reported once as screen direction; eyelines are judged only when one speaker faces the other (within 60 degrees) and both read on screen; the jump-cut size is the measured ladder rung. Placements come from `placementAt` (stage, walked path, shot override); `camera.checkCuts` also samples the active character's take root through `ports.sampleStateAt`.
- Preview transitions ride the lens renderer: a dissolve or whip is two weighted sub-renders (the far shot's camera holding its nearest frame), a fade one sub-render with the rest black; only adjacent keyed shots blend.

## Reconciliations
