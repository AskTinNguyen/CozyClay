# Headless Studio

- Rev: 1
- Status: active
- Area: Platform
- Owner: TinNguyen
- Skill: `none`
- Branch: `intent/headless-studio`
- Worktree: `../CozyClay-wt/headless-studio`, port slot n=5 (dev 5205, live hub 5305, CDP 9305)
- Started: 2026-10-24

## Goal

`tools/headless-studio.mjs` starts the real Studio in an owned headless Chrome with a portable `.cclayproject` seeded, so `cclay live` and MCP clients can drive and capture it without a visible tab. It exits at once with `ERR_MODULE_NOT_FOUND`: it imports `waitFor`, `startChrome` and `openStudioProject` from `tools/gt-render/browser.mjs`, which a6b8d39c deleted with the rest of the ARDY ground-truth renderer (camera-techniques F-2). Make the tool run again and keep it from breaking silently.

## Non-Goals

- Restoring the ground-truth renderer (`tools/gt-render/` render, page, camera math): it was removed on purpose in the 3.0 direction.
- Merging `tools/qa-browser.mjs` with this tool; it keeps its own launcher.

## Decisions

- D1 (rev 1): The browser helpers the tool needs (`waitFor`, `startChrome`, the CDP client, `openStudioProject`) come back from a6b8d39c^ as their own module, `tools/studio-browser.mjs`, owned by headless-studio, not under the removed `gt-render/` name. Only what the tool imports returns. Source: orchestrator.
- D2 (rev 1): The Chrome candidates gain the standard Windows and Linux install paths, so the tool runs on the owner's Windows PC without `CHROME_PATH`; `CHROME_PATH` still wins. Source: orchestrator.

## Acceptance

- A1: `node tools/headless-studio.mjs --help` exits 0 (every import resolves). Proof: gate: a node verify file in the default suite that runs it and asserts exit 0 and the usage text, so a missing import fails the suite.
- A2: Headless capture works end to end: the tool starts the Studio with `test/fixtures/camera-coverage.cclayproject` on slot n=5 ports, `cclay live capture --out` writes a PNG (signature and non-trivial size) of the seeded scene, and stopping the tool leaves no child process listening on its ports. Proof: gate: a browser-category verify file (listed, excluded from the default node suite like the other Chrome suites) run here with exit 0; plus ui:shot, the capture committed under `docs/intent/headless-studio/proofs/` and reviewed.
- A3: The repository gates hold. Proof: gate: `npm run lint` (no baseline raised), `npm run build`, `node tools/run-tests.mjs --jobs 4` from Git Bash with no dev server running, under the contract's known exception.
- A4: Docs: `CHANGELOG.md` Unreleased gets a line; camera-techniques F-2 points to this intent. Proof: review.

## Constraints

- `CLAUDE.md`: the 250-line ratchet, knip and eslint baselines; new files stay under 250 lines.
- Keep the owner's own studio on ports 5180 / 5184 untouched; use slot n=5.
- Keep the branch merged with `origin/main` and pushed after every step (contract, Git And Merge).

## Changelog

- rev 1 (2026-10-24): created from camera-techniques F-2 at the owner's request.
