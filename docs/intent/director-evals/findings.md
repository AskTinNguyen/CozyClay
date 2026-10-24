# Director Evals: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

## F-1: a cut question routed through camera.applyTechnique keeps no cut list (blocking: no)

- Evidence: `camera.applyTechnique { request: "check my cuts" }` routes to `camera.checkCuts` and answers its summary, checks (`cuts`, `issues`) and `CUT_*` warnings, but the receipt has no `output`: camera.applyTechnique is a `mutation`, and the bus (`src/command-bus.js` receipt(), `status: 'noop'`) keeps `output` only for completed jobs and changing mutations. Seen while writing the cut-check rows of the eval set.
- Effect: an agent asking the technique door a cut question learns how many issues there are and their warning codes, not the per-cut measures or fixes. `camera.checkCuts` itself answers in full.
- What the evals do: cut rows run `camera.checkCuts { request }` directly (the action the router names), so the flags come from its own receipt (`test/director-evals-apply.mjs`).
- Options: (a) leave it; the warnings carry the rules. (b) Put the flagged rules per cut into `checks` of camera.checkCuts (survives a no-op receipt). (c) Let the bus keep `output` on a no-op mutation receipt. Recommendation: (b), small and local to camera-coverage, in a later camera intent; not needed for this one.
