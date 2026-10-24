# Director Packet

- Rev: 1
- Status: completed
- Waits for: `group-coverage` completed (the plan draws every pair's line). Sixth in the cinematic-atlas plan. It includes the outputs of `camera-motivation`, `depth-staging` and `intensity-curve` when they have landed, and leaves those sections out otherwise.
- Area: Export
- Owner: TinNguyen
- Skill: `none`
- Branch: `intent/director-packet`
- Worktree: `../CozyClay-wt/director-packet`, port slot n=12 (dev 5212, live hub 5312, CDP 9312)

## Goal

Proposal 6 of the cinematic-atlas review (L-1). A scene goes to a mocap team, a game engine or a collaborator as a shooting plan:

- a top-down plan with the cast's marks and paths, numbered camera positions and the line of action;
- a shot list;
- a contact sheet;
- the notes that matter.

CozyClay has every piece but not the packet:

- `planDiagramLayout` / `drawPlanDiagram` in `src/plan-diagram.js` draw the Top View;
- `src/studio-contact-sheet.js` lays frames;
- the keyframe pack and sequence brief carry prompts and references.

This intent assembles one printable director packet per range.

## Non-Goals

- PDF output. The packet is a printable single-page HTML file plus images and CSV; the browser prints it.
- Storyboard drawing styles. The plan is a data diagram, like the Top View.
- New checks. The packet shows what the existing checks report.

## Decisions

- D1 (rev 1): `directorPacket(document, { range })` is pure data, deterministic and testable in Node. The Studio renders its images through the existing capture paths. Source: orchestrator, following shot-prompt-engine D1.

## Acceptance

- A1: Data. `directorPacket` returns:
  - the cast list;
  - beats, when present;
  - shot rows: number, name, frames and timecode, duration, size, angle, lens mm, the move in measured words, capabilities, composition, coverage role, transition in, and any flags from the cut, coverage, motivation, shot and structure checks that exist;
  - plan primitives.

  The output is byte-identical across runs. Proof: gate: `node test/verify-director-packet.mjs` on a `camera.cover` fixture.
- A2: Plan. Each shot's camera is drawn with its number and frustum, and with an arrow along its path when it moves. The plan also shows the line or lines of action, the cast marks at each shot's start, their paths over the range, and a legend. It fits a landscape page. Proof: gate: primitive counts in the same verify file; plus ui:shot of a rendered plan for a master-coverage and a triangle-dialogue sequence.
- A3: Files. The export writes `packet/index.html` (one printable page referencing the rest), `packet/plan.png`, `packet/contact-sheet.png`, `packet/shot-list.csv` and `packet/shot-list.md`. When `intensity-curve` has landed it also writes `packet/intensity.png`. All of it goes inside the sequence pack. Proof: gate: a verify file opening the zip with Git Bash `unzip -t` and checking the files against the data.
- A4: Controls. File › Export › Director packet… takes a range, shows a preview, and downloads the pack. Proof: ui:qa, a browser QA script that exports a packet and checks its file list; plus ui:shot of the preview.
- A5: Agents. An MCP `render_packet` tool returns the data and the shot list in memory (no renders), and `cclay live` writes the full pack. Proof: gate: `node mcp/verify-director-packet.mjs`.
- A6: The repository gates hold. Proof: gate: `npm run lint` (no baseline raised), `npm run build`, and `node tools/run-tests.mjs --jobs 4` from Git Bash with no dev server running, under the contract's known exception.
- A7: Docs updated: `mcp/README.md`, `docs/agent-cli.md`, `docs/studio-ui-ia.md`, `CHANGELOG.md` Unreleased. Proof: review.

## Constraints

- `CLAUDE.md`: the 250-line ratchet, knip and eslint baselines; new files stay under 250 lines.
- Exports stay readable by their consumers; new pack entries are additive (`node test/verify-keyframe-pack.mjs` passes).
- Keep the owner's own studio on ports 5180 / 5184 untouched; use slot n=12.
- Keep the branch merged with `origin/main` and pushed after every step (contract, Git And Merge).
- Source material: the cinematic-atlas repo is reference only; nothing from its books is committed or quoted.

## Changelog

- rev 1 (2026-10-24): written as a planned intent from the cinematic-atlas review (L-1, L-2).
- rev 1 (2026-10-24): completed; squash-merged into `main` by the cloud orchestrator under `after-proof` (#16).
