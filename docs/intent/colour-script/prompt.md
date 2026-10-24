# Colour Script

- Rev: 2
- Status: completed
- Waits for: `director-packet` completed (the packet carries the colour script strip). Seventh in the cinematic-atlas plan.
- Area: Scene and Viewport
- Owner: TinNguyen
- Skill: `none`
- Branch: `intent/colour-script`
- Worktree: `../CozyClay-wt/colour-script`, port slot n=13 (dev 5213, live hub 5313, CDP 9313)

## Goal

Proposal 7 of the cinematic-atlas review (L-1), first half. Colour and light carry story: a warm room turns cold when trust breaks, an accent colour marks danger. Productions plan this as a colour script, a strip of each beat's palette across the film.

CozyClay's look is one global `stage.lighting` (`src/stage-lighting.js`, `LIGHTING_PRESETS`). The camera-coverage intent listed "lighting and look presets" as a non-goal for later. This intent adds:

- a per-shot look;
- a measured palette per shot;
- a colour script strip and look recipes in story words.

## Non-Goals

- Colour grading LUTs or an HDR pipeline.
- Changing object materials per shot.
- Any change to how a stage saved earlier renders.

## Decisions

- D1 (rev 1): a shot look is a partial `stage.lighting` merged over the stage look while the shot plays, absent by default. `src/stage-lighting.js` stays pure data and arithmetic. Source: orchestrator.
- D2 (rev 1): the measured palette is a pure function of an RGBA buffer, like `src/studio-contact-sheet.js`. The same buffer gives the same palette. Source: orchestrator.

## Acceptance

- A1: Shot look. `shot.setLook { shotId, look }` stores a partial lighting look on the shot: preset, key warmth or colour, exposure, fill, fog, sky. It can also carry an optional intended `palette` (three to five hex swatches with a word). The preview, captures, video export and the keyframe pack all honour it, and a dissolve blends the two looks. Proof: gate: `node test/verify-shot-look-merge.mjs` (merge, sampling at frames, dissolve blend), with older documents unchanged. (rev 2: `test/verify-shot-look.mjs` is an unrelated look-through test, F-1.)
- A2: Measured palette. `measurePalette(rgba, w, h)` returns the dominant colours, mean luminance, warmth and saturation. Each shot's palette is measured from its middle frame capture. Proof: gate: `node test/verify-palette-measure.mjs` on constructed buffers.
- A3: Colour script. A strip with one column per shot (measured swatches, the intended palette beside them), with beats overlaid. It appears in File › Export and as `packet/colour-script.png` in the director packet. Proof: gate: pack file check; plus ui:shot of the strip for a sequence with a warm-to-cold change.
- A4: Recipes and agents. Look recipes keyed to story words are data in CozyClay's own words (for example "warm safety", "cold isolation", "danger accent"). Resolver phrases reach them: "make the confession shot colder", "colour script for this scene", "the same look as shot 2". An MCP tool sets and reads shot looks. `director-evals` gains at least 5 core scenarios. Proof: gate: `node mcp/verify-shot-look.mjs` and `node test/verify-director-evals.mjs`.
- A5: Prompt. The sequence brief states each beat's look and intended palette in words, and model profiles are unaffected. Proof: gate: `node test/bus/verify-sequence-prompt.mjs` (byte-identical).
- A6: Contrast. The colour change across each cut (luminance and warmth delta) is reported. When `intensity-curve` has landed, it becomes a tone component there. Proof: gate: verify file with a constructed hard and soft colour cut.
- A7: Controls. A Look section in the shot inspector picks a recipe, edits the partial look and the palette, and shows the measured swatches. Proof: ui:qa, a browser QA script that sets a look on one shot and checks the document and a capture's measured warmth; plus ui:shot.
- A8: The repository gates hold. Proof: gate: `npm run lint` (no baseline raised), `npm run build`, and `node tools/run-tests.mjs --jobs 4` from Git Bash with no dev server running, under the contract's known exception.
- A9: Docs updated: `mcp/README.md`, `docs/agent-cli.md`, `docs/studio-ui-ia.md`, `CHANGELOG.md` Unreleased. Proof: review.

## Constraints

- `CLAUDE.md`: the 250-line ratchet, knip and eslint baselines; new files stay under 250 lines.
- Edits go through the command bus; never write domain stores directly.
- A stage saved earlier renders unchanged (the `DEFAULT_LIGHTING` contract in `src/stage-lighting.js`).
- The Studio agent prompt cap (13,400, shot-prompt-engine D5) holds unless raised as a recorded decision.
- Keep the owner's own studio on ports 5180 / 5184 untouched; use slot n=13.
- Keep the branch merged with `origin/main` and pushed after every step (contract, Git And Merge).
- Source material: the cinematic-atlas repo is reference only; nothing from its books, including film stills or palettes taken from them, is committed or quoted.

## Changelog

- rev 1 (2026-10-24): written as a planned intent from the cinematic-atlas review (L-1, L-2).
- rev 2 (2026-10-24): A1's proof file is `test/verify-shot-look-merge.mjs`, as F-1 proposed (the named file already held an unrelated test).
- rev 2 (2026-10-24): completed; squash-merged into `main` by the cloud orchestrator under `after-proof` (#18).
