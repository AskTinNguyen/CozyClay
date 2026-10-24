# Colour Script: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

## F-1 (2026-10-24): A1's proof file name is taken (resolved)

- Evidence: `test/verify-shot-look.mjs` already exists on main and checks something else (Studio look-through flies the shot camera with the free camera's bindings; `verify-shot-look: all checks passed`). A1 names `node test/verify-shot-look.mjs` as its gate.
- Impact: running the named file proves nothing about shot looks; replacing it would delete an unrelated gate.
- Done meanwhile (not blocking): the A1 checks (merge, sampling at frames, dissolve blend, older documents unchanged, shot.setLook through the bus) live in `test/verify-shot-look-merge.mjs`, in the suite manifest beside the existing file, which is left as it is.
- Proposed amendment: A1's proof reads `gate: node test/verify-shot-look-merge.mjs`. Recommendation: accept (option b, renaming the old look-through test, touches an unrelated area for no gain).
- Resolution (cloud orchestrator, 2026-10-24): accepted; prompt rev 2 names `test/verify-shot-look-merge.mjs` as A1's proof.
