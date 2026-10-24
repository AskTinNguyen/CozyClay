# Intensity Curve

- Rev: 1
- Status: active
- Waits for: `camera-motivation` completed (the curve is read against its story beats). Fifth in the cinematic-atlas plan.
- Area: Camera and Shots
- Owner: TinNguyen
- Skill: `none`
- Branch: `intent/intensity-curve`
- Worktree: `../CozyClay-wt/intensity-curve`, port slot n=11 (dev 5211, live hub 5311, CDP 9311)

## Goal

Proposal 5 of the cinematic-atlas review (L-1). A sequence has a visual structure: it builds, peaks and releases through contrast and affinity in shot size, angle, lens, movement and cutting rate. Directors chart it against the story. CozyClay measures every one of these per shot, but nothing reads them across a sequence.

This intent computes a deterministic intensity curve from the measured camera and shows it against the story beats. It also flags stretches that go flat where the story asks for contrast, and peaks that miss the beat they should serve.

## Non-Goals

- Judging taste or editing automatically. The rules report; suggestions are technique stacks.
- Colour and tone. That is `colour-script`, which may add a colour component to this curve later.
- Changing any shot.

## Decisions

- D1 (rev 1): each component is normalised to 0–1 by a documented formula, and the combined value is a documented weighted sum. Formulas and weights live in one data module, so a later intent can tune them, with a changelog line, without touching the rules. Source: orchestrator.
- D2 (rev 1): the structure rules use the story beats from `camera-motivation`. With no beats, the curve still draws, and only the beat-free rule (`flat`) runs. Source: orchestrator.

## Acceptance

- A1: Curve. `sequenceIntensity(document, { range })` returns, per shot, these components, plus the combined value and the per-cut contrast (the jump in each component at the cut):
  - size step;
  - camera height relative to the subject's eyes;
  - focal length;
  - camera speed (from `measureShotCamera`);
  - shot length as cutting rate;
  - roll;
  - screen-position change across the cut.

  The output is byte-identical across runs. Proof: gate: `node test/verify-intensity-curve.mjs` on fixtures: a master-coverage sequence climbs, and an all-medium same-lens sequence is flat.
- A2: Structure rules. `camera.checkStructure` (read-only) reports:
  - `flat`: N or more shots in a row with total contrast under a threshold;
  - `peak-off-beat`: the highest-intensity shot does not contain or follow the strongest beat;
  - `no-build`: intensity does not rise into a beat of kind reveal, threat or decision.

  Each issue carries frames and a suggestion as a technique stack (one size tighter, a lower angle, a longer lens, shorter shots). Proof: gate: the same verify file with constructed cases.
- A3: Controls. An intensity strip under the timeline's shot blocks shows the combined curve, with a toggle per component and the beats overlaid; flagged stretches are marked. Proof: ui:qa, a browser QA script that lays a flat sequence, reads the flag, applies a suggestion and sees the curve change; plus ui:shot of the strip over a master-coverage sequence.
- A4: Export. The sequence brief gains one structure line (where the sequence builds and peaks), and the strip renders as an image that `director-packet` can use. Proof: gate: `node test/bus/verify-sequence-prompt.mjs` (byte-identical) and a verify of the strip's image dimensions.
- A5: Agents. An MCP `check_structure` tool and `cclay live run` reach it. Phrases reach it: "where does this sequence go flat?", "build to the reveal", "show me the intensity". `director-evals` gains at least 5 core scenarios. Proof: gate: `node mcp/verify-intensity-curve.mjs` and `node test/verify-director-evals.mjs`.
- A6: The repository gates hold. Proof: gate: `npm run lint` (no baseline raised), `npm run build`, and `node tools/run-tests.mjs --jobs 4` from Git Bash with no dev server running, under the contract's known exception.
- A7: Docs updated: `mcp/README.md`, `docs/agent-cli.md`, `docs/studio-ui-ia.md`, `CHANGELOG.md` Unreleased. Proof: review.

## Constraints

- `CLAUDE.md`: the 250-line ratchet, knip and eslint baselines; new files stay under 250 lines.
- Pure modules: no DOM or three.js in the curve or the rules.
- The Studio agent prompt cap (13,400, shot-prompt-engine D5) holds unless raised as a recorded decision.
- Keep the owner's own studio on ports 5180 / 5184 untouched; use slot n=11.
- Keep the branch merged with `origin/main` and pushed after every step (contract, Git And Merge).
- Source material: the cinematic-atlas repo is reference only; nothing from its books is committed or quoted.

## Changelog

- rev 1 (2026-10-24): written as a planned intent from the cinematic-atlas review (L-1, L-2).
