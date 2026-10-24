# Group Coverage

- Rev: 1
- Status: planned
- Waits for: `director-evals` completed. Third in the cinematic-atlas plan. It may run beside `camera-motivation` only if neither edits `src/commands/camera-coverage.js` or `src/camera-coverage/cut-rules.js`; otherwise it runs after it.
- Area: Camera and Shots
- Owner: TinNguyen
- Skill: `none`
- Branch: `intent/group-coverage`
- Worktree: `../CozyClay-wt/group-coverage`, port slot n=9 (dev 5209, live hub 5309, CDP 9309)

## Goal

Proposal 3 of the cinematic-atlas review (L-1). Every pattern in `src/camera-coverage/patterns.js` covers one or two people. Game cinematics and short films regularly stage three-way arguments, group scenes and branching conversations. A branching conversation needs every branch cut from the same setups so the edit holds together.

The cut checks also guess their line: `principals()` in `src/camera-coverage/cut-rules.js` takes each shot's subject, or the nearest other character, which is ambiguous with three people in range. This intent adds:

- an explicit line of action;
- three-or-more-person and branching patterns;
- a coverage-completeness check that answers "is there enough here to edit?".

## Non-Goals

- Choosing cut points from performance (the camera-coverage non-goal stands).
- Crowd scenes beyond six cast members.
- Dialogue import; branches are frame ranges the user or agent names.

## Decisions

- D1 (rev 1): each cut checks against the line between the pair the two shots are about. That pair comes from an authored line on the shot when set, otherwise from the shots' subjects and whom they look at. The report names the pair it used. When it cannot tell, it says so instead of guessing the nearest person. Source: orchestrator.
- D2 (rev 1): a camera that moves across the line inside a shot is legal. Only a cut across it is flagged, and a neutral (on-axis) shot or cutaway between two sides clears the flag. Source: orchestrator.

## Acceptance

- A1: Explicit line. `camera.setLine { shotId, between: [A, B] }` stores an optional line on the shot. The cut rules use D1, and every line issue names its pair. Proof: gate: `node test/verify-camera-cut-rules.mjs` extended with three-person cases, including a legal line change through a neutral shot and through an in-shot move.
- A2: Patterns. `camera.cover` accepts a cast of more than two, and adds these patterns:
  - `triangle-dialogue` (three people): a master of the triangle, then OTS and singles for each speaking pair, each pair on its own consistent side;
  - `group-singles` (three to six): a wide, then singles of each member from inside the group;
  - `branching-dialogue`: one set of setups per speaker, laid once and reused across N branch ranges.

  Proof: gate: `node test/bus/verify-group-coverage.mjs` asserting shot counts, ranges, stacks, sides per pair, one undo entry, and zero cut flags on each pattern.
- A3: Completeness. `camera.checkCoverage` (read-only) reports for a range and cast:
  - whether a master or establishing shot exists;
  - whether each cast member has at least two sizes;
  - whether a neutral or cutaway exists where the line changes;
  - whether every branch is covered by the same setups.

  Each gap carries a suggested shot as a technique stack. Proof: gate: `node test/verify-camera-coverage-check.mjs` with complete and gapped fixtures.
- A4: Controls. The Coverage section's cast picker takes three or more, and a coverage readout shows the A3 gaps. Proof: ui:qa, a browser QA script that lays `triangle-dialogue` with three cast members and checks the document and readout; plus ui:shot of a contact sheet of the triangle pattern showing consistent sides.
- A5: Agents. Resolver phrases ("cover this three-way argument", "branching dialogue, three branches", "is my coverage enough to edit?", "keep the line between Mara and Joon") reach the new actions. MCP `cover_scene` takes a cast of more than two, and an MCP `check_coverage` tool is added. `director-evals` gains at least 8 core scenarios. Proof: gate: `node mcp/verify-camera-coverage.mjs` extended, and `node test/verify-director-evals.mjs`.
- A6: Prompt. With three or more cast, the sequence brief's continuity line names each pair's line. Proof: gate: `node test/bus/verify-sequence-prompt.mjs` extended, byte-identical across runs.
- A7: The repository gates hold. Proof: gate: `npm run lint` (no baseline raised), `npm run build`, and `node tools/run-tests.mjs --jobs 4` from Git Bash with no dev server running, under the contract's known exception.
- A8: Docs updated: `mcp/README.md`, `docs/agent-cli.md`, `docs/studio-ui-ia.md`, `CHANGELOG.md` Unreleased. Proof: review.

## Constraints

- `CLAUDE.md`: the 250-line ratchet, knip and eslint baselines; new files stay under 250 lines. `patterns.js` and `cut-rules.js` are near the limit, so split by pattern family or rule rather than grow them.
- Edits go through the command bus; never write domain stores directly.
- Existing two-person patterns keep their output (their verify files pass unchanged).
- The Studio agent prompt cap (13,400, shot-prompt-engine D5) holds unless raised as a recorded decision.
- Keep the owner's own studio on ports 5180 / 5184 untouched; use slot n=9.
- Keep the branch merged with `origin/main` and pushed after every step (contract, Git And Merge).
- Source material: the cinematic-atlas repo is reference only; nothing from its books is committed or quoted.

## Changelog

- rev 1 (2026-10-24): written as a planned intent from the cinematic-atlas review (L-1, L-2).
