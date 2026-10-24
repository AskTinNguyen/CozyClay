# Technique References: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

## F-1 (2026-10-24, rev 1) | blocking: yes | status: resolved

**Found:** CozyClay is a public fork. This intent would ship bibliographic citations (title, author, edition, page) for books in the owner's cinematic-atlas library. Citations carry no book text, but licensing is reserved for the owner (contract, Decisions). Separately, the atlas repo commits the source PDFs, some named after shadow-library downloads; nothing from those files may reach CozyClay.
**Options:** (a) ship citations only, limited to the camera and directing books, with links to the atlas only when the owner sets its URL (recommended); (b) keep the references out of the repo in a local user file the picker reads when present; (c) drop the intent.
**Proposed amendment:** none; D1 and A1 assume (a). Under (b), A1 and A2 write to a local file and the verify file uses a fixture only.
**Resolution:** option (a), by the owner on 2026-10-24 (log L-4): acceptable because the tool is used internally for prototyping and proofs of concept. Folded into rev 2 as D3.

## F-2 (2026-10-24, rev 2) | blocking: no (A3's ui:qa cannot fully pass in the cloud container) | status: open

**Found:** In this Linux cloud container the real studio cannot run a browser QA that changes UI state after load, on unchanged code too. Three environment effects: (1) Chromium as root needs `--no-sandbox` (`QA_CHROME_FLAGS`); (2) the egress policy refuses `cdn.jsdelivr.net`, which `three/examples/jsm/Addons` imports statically (LottieLoader, TTFLoader), so the studio's module graph never loads unless a CDP session answers those requests with an empty module (a scratch helper did this; nothing committed); (3) even then the DOM React root sits suspended (`root.pendingLanes 32, suspendedLanes 32`, no pending commit, two `blob:` worker scripts that never finish), so most state changes after load never commit. Evidence: the existing `test/verify-camera-technique-picker-browser.mjs` with the picker and Coverage panel restored to `origin/main` fails from "search forgives spelling" on (`FAIL ... the Angle tab lists only the 11 angles`, `FAIL picking Low Angle ...`) under the same command.
**Effect on A3:** `test/verify-technique-references-browser.mjs` passes every rendering check (plain citations on load, `<atlas URL>#/book/<id>/<page>` links on load with a stored URL, links open in a new tab, the Coverage pattern linked, the no-page line) and the storage write; it fails only the checks that need a live re-render after **Set** / clearing (`setting the atlas URL links the citations`, `the Coverage pattern's reading links too`, `clearing the URL turns links back into plain text`, `and forgets it`, the per-page check right after Set).
**Options:** (a) run the same command on the owner's Windows PC or another host with a working headless Chrome and record its exit code (recommended); (b) accept A3 on the rendering checks plus the unit gate for the setting (`normalizeAtlasUrl` / `readAtlasUrl` / `writeAtlasUrl` in `test/verify-technique-references.mjs`).
**Proposed amendment:** none.
