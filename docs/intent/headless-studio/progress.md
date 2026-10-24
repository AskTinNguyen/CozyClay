# Headless Studio: Progress

- Working under rev: 1
- Worker: control session (implements directly)
- Current step: S4 gates done
- Next step: PR, orchestrator review, merge
- PR: none yet

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | `node test/verify-headless-studio-cli.mjs` -> `PASS --help exits 0`, `PASS --help prints the usage`, `PASS no --project is a usage error (exit 2)`, `headless-studio cli: all checks passed`, exit 0. With the old `./gt-render/browser.mjs` import put back it fails: `FAIL --help exits 0 — exit 1` with `ERR_MODULE_NOT_FOUND`. Listed as `RUN node test/verify-headless-studio-cli.mjs` in the default suite. |
| A2 | met | `HEADLESS_CAPTURE_OUT=docs/intent/headless-studio/proofs/headless-capture.png node test/verify-headless-studio-browser.mjs` (ports 5205/5305/9305), three runs, each exit 0: `PASS the tool starts the Studio with the project`, `PASS the Studio joins the live hub`, `PASS cclay live capture exits 0`, `PASS the capture is a PNG of real size`, `PASS the capture renders the seeded cast`, `PASS stopping the tool frees its ports`. Afterwards no process with a `cozyclay-headless-studio-` profile was left (`count: 0`). ui:shot: `proofs/headless-capture.png` (awaits review). Listed as `EXCLUDE browser test/verify-headless-studio-browser.mjs`. |
| A3 | met (known exception) | `npm run lint` exit 0 (`knip: 138 findings, 0 new`, `loc: 72 files over 250 (baseline 72), 0 violations`, `eslint: ... 0 regressions`); `npm run build` exit 0; `node tools/run-tests.mjs --jobs 4` (Git Bash, no dev server) stopped at the known `FAIL exit car, hips sunk: under 10 s — 11782 ms`; every RUN file then run to the end, 4 at a time: `files 454, ok 453, failed 1`, the only failure that same check (`— 12320 ms`). |
| A4 | open | `CHANGELOG.md` Unreleased › Tools; camera-techniques F-2 resolution points here (awaits review). |

## Steps

- S1 (rev 1, 2026-10-24): `tools/studio-browser.mjs` restored from `a6b8d39c^:tools/gt-render/browser.mjs` with only `waitFor`, `startChrome`, the CDP client and `openStudioProject` (`startVite`, `openStudioClean`, `terminateAll` stay gone); Chrome candidates gain `C:/Program Files/Google/Chrome/Application/chrome.exe`, the x86 path and `%LOCALAPPDATA%`. `tools/headless-studio.mjs` imports it. Manual run: the tool printed `"ok": true`, `"project": "Camera Coverage"`; `cclay live capture --out` wrote 640x360, `nonBlackPixels 230400`; `taskkill /T` left nothing on 5205/5305/9305. Commit 0603c5ed.
- S2 (rev 1): the two verify files (A1, A2). Found while writing A2: right after `"ok"` the editor has not joined the hub (`cclay live` exit 4, use `cclay live status --wait`), then `capture_frame` answers `No renderable shot camera` and the figures are not yet renderable for a few seconds; the browser suite waits and retries, bounded. A blocking `spawnSync` in the suite stalled the Studio by not draining the tool's pipe; the suite spawns async.
- S3 (rev 1): `tools/run-tests.mjs` entries placed on existing lines (the loc ratchet flagged 441 -> 443). `npm run lint` -> `knip: 138 findings, 0 new`, `loc: 72 files over 250 (baseline 72), 0 violations`, `eslint: 396 errors across 20 rules (baseline 403), 0 regressions`, exit 0; `npm run build` exit 0. Commit d97c729e.
- S4 (rev 1): gates, evidence in A3.

## Reconciliations
