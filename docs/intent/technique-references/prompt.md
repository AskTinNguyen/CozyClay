# Technique References

- Rev: 2
- Status: completed
- Waits for: nothing. F-1 resolved (L-4).
- Area: Camera and Shots
- Owner: TinNguyen
- Skill: `none`
- Branch: `intent/technique-references`
- Worktree: `../CozyClay-wt/technique-references`, port slot n=14 (dev 5214, live hub 5314, CDP 9314)

## Goal

Proposal 7 of the cinematic-atlas review (L-1), second half. Split from `colour-script` because the contract gives each intent exactly one area. The owner's cinematic-atlas indexes 2,407 book pages by camera tag (shot sizes, lens, height, movement, axis, coverage, blocking, staging).

This intent gives each technique, coverage pattern and cut or shot rule a short list of bibliographic references (book, author, page). The technique picker shows them as further reading. When the owner runs the atlas locally and sets its URL, each reference opens that page there. Agents can then cite a source when explaining a choice.

## Non-Goals

- Shipping, quoting or paraphrasing book text, page images or PDFs.
- Changing the atlas repo.
- Adding references to the Studio agent system prompt. They are fetched on detail requests only.

## Decisions

- D1 (rev 1): references are citations only: book id, title, author, edition, year, pages. No excerpt fields. Source: orchestrator; confirmed by the owner's F-1 resolution (D3).
- D2 (rev 1): the mapping is generated offline by a tool that reads a local atlas checkout (its camera-page tags and section titles) through a curated table from technique id to atlas tags. The result is committed as small data. The suite never needs the atlas. Source: orchestrator.
- D3 (rev 2): F-1 resolved as option (a). The owner: the tool is used internally for prototyping and proofs of concept, so citations (no book text) are acceptable. Limit the books to camera and directing titles. Source: owner (L-4).

## Acceptance

- A1: Data. A references module holds the book list and the per-entry refs. Every size, angle and move technique, every coverage pattern and every cut rule has at least one ref, or is listed as having none. Proof: gate: `node test/verify-technique-references.mjs`, asserting coverage, the allowed fields only, and short strings.
- A2: Generator. `node tools/atlas-refs.mjs` (reads `ATLAS_DIR`) rewrites the data deterministically. It is tested on a small committed fixture, not on the atlas. Proof: gate: the same verify file running the generator on the fixture.
- A3: Picker. The technique parameter popover shows "Further reading". The citations become links to `<atlas URL>#/book/<id>/<page>` when the atlas URL setting is set, and stay plain text otherwise. Proof: ui:qa, a browser QA script checking both states; plus ui:shot.
- A4: Agents. `list_camera_techniques` stays within its size, and the references come back on a detail request (a technique id, or `references: true`). Proof: gate: `node mcp/verify-camera-techniques.mjs` extended.
- A5: The repository gates hold. Proof: gate: `npm run lint` (no baseline raised), `npm run build`, and `node tools/run-tests.mjs --jobs 4` from Git Bash with no dev server running, under the contract's known exception.
- A6: Docs updated: `mcp/README.md`, `docs/studio-ui-ia.md`, `CHANGELOG.md` Unreleased. Proof: review.

## Constraints

- `CLAUDE.md`: the 250-line ratchet, knip and eslint baselines; new files stay under 250 lines.
- Licensing was decided by the owner (D3); nothing beyond citations (no excerpts, page images, PDFs) reaches the repo.
- No machine path to the atlas is committed; it comes from `ATLAS_DIR` or a setting.
- Keep the owner's own studio on ports 5180 / 5184 untouched; use slot n=14.
- Keep the branch merged with `origin/main` and pushed after every step (contract, Git And Merge).

## Changelog

- rev 1 (2026-10-24): written as a planned intent from the cinematic-atlas review (L-1, L-2).
- rev 2 (2026-10-24): F-1 resolved by the owner as option (a) (D3); status active.
- rev 2 (2026-10-24): completed; squash-merged into `main` by the cloud orchestrator under `after-proof` (#12).
