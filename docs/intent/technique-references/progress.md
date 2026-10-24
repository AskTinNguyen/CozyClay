# Technique References: Progress

- Working under rev: 2
- Worker: cloud worker agent (technique-references)
- Current step: A3 — Further reading in the technique popover, atlas URL field, browser QA and proof shot
- Next step: A6 docs, then A5 gates
- PR: none yet

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met (gate) | `node test/verify-technique-references.mjs` -> `6 checks passed` (coverage of all 65 techniques, 6 patterns, 4 cut rules: ref or listed none, never both; fields `id,title,author,edition,year` / `book,pages` only; short strings; camera and directing books only; no path, excerpt or file name in `data.js`) |
| A2 | met (gate) | same file: `tools/atlas-refs.mjs` run twice on `test/fixtures/atlas-refs` -> identical bytes, `atlas-refs: 4 entries with references, 71 without, 2 books`, exact expected refs, no fixture excerpt / page title / source name / section title / non-citable book in the output; refuses without `ATLAS_DIR` |
| A3 | open | |
| A4 | met (gate) | `node mcp/verify-camera-techniques.mjs` -> `19 passed, 0 failed` (index 3,215 bytes, unchanged, no citations; `id: "close-up"` brings `references` [book, pages, cite]; a technique with none answers `[]`; `references: true` lists books, techniques, coverage patterns and cut rules in one receipt under 8 KiB; `references: true` with an id reads it in full); also `mcp/verify.mjs` `all checks passed`, `mcp/verify-tool-annotations.mjs` `PASS G005 ... (32 tools; deterministic order)`, `mcp/verify-live.mjs` exit 0 |
| A5 | open | |
| A6 | open | |

## Steps

1. Merged `origin/main` (b975c555, camera-polish) into the branch: 568d70d4.
2. A1/A2 data and generator (commit below). `tools/atlas-refs-table.mjs`: the citable books (8 camera and directing titles: Katz x2, Kenworthy x3, Rosman, Block, Haigh-Hutchinson; edition curated, null when the atlas copy states none) and, per technique / coverage pattern / cut rule, atlas evidence terms, section-title words and camera tags. `tools/atlas-refs.mjs` (`ATLAS_DIR`, `--out`): scores every page of a citable book (3 per evidence term, 2 per section-title word, +1 per tag, +0.5 high confidence; needs a term or section hit), keeps at most 3 books x 2 pages, sorted and stable; ids the table lacks go to `NO_REFERENCES`; it reads book id/title/author/published/chapters and page bookId/page/tags/evidence/confidence only, never `excerpt`, page titles, source names or `source-pdfs/`. Real run: `ATLAS_DIR=<atlas checkout> node tools/atlas-refs.mjs` -> `atlas-refs: 49 entries with references, 26 without, 7 books -> src/camera-references/data.js`; a second run leaves `git status` clean. `src/camera-references/index.js`: `referencesFor(section, id)` (citations with a `cite` line), `referenceDigest()` for agents, `normalizeAtlasUrl` / `readAtlasUrl` / `writeAtlasUrl` (per-viewer localStorage `cozyclay.atlasUrl`, try/catch) and `atlasPageHref` (`<atlas URL>#/book/<id>/<page>`). Fixture `test/fixtures/atlas-refs/data/` (invented books and tags in the atlas shape). `node test/verify-technique-references.mjs` -> `6 checks passed`; added to the run-tests manifest (line-neutral). `npm run lint` -> `knip: 138 findings, 0 new, 1 fixed (baseline 139)`, `loc: 72 files over 250 (baseline 72), 0 violations`, `eslint: 396 errors across 20 rules (baseline 403), 0 regressions`.
3. A4 agents (commit below): `describeTechnique` (camera.describeTechnique and `list_camera_techniques { id }`) carries `references: [{ book, pages, cite }]` (`[]` when the atlas has none) beside the grokfilm link; `list_camera_techniques` takes `references: true` and answers `referenceDigest()` (books once, then one line per technique, coverage pattern and cut rule); the index answer is unchanged (3,215 bytes). Nothing is added to the Studio agent system prompt. Results: `node mcp/verify-camera-techniques.mjs` -> `19 passed, 0 failed`; `node mcp/verify.mjs` -> `all checks passed`; `node mcp/verify-tool-annotations.mjs` -> `PASS G005 tools/list safety contract (32 tools; deterministic order)`; `node test/verify-tool-handlers.mjs` -> `PASS tool handler registry (32 tools, ...)`; `node test/verify-camera-techniques.mjs` -> `12 checks passed`; `test/bus/verify-camera-capability-techniques.mjs` `pass 3, fail 0`; `test/bus/verify-camera-techniques-apply.mjs` `pass 5, fail 0`; `mcp/verify-live.mjs` exit 0.

## Reconciliations
