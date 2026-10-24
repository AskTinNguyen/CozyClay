# Director Evals: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

## F-1: a cut question routed through camera.applyTechnique keeps no cut list (blocking: no)

- Evidence: `camera.applyTechnique { request: "check my cuts" }` routes to `camera.checkCuts` and answers its summary, checks (`cuts`, `issues`) and `CUT_*` warnings, but the receipt has no `output`: camera.applyTechnique is a `mutation`, and the bus (`src/command-bus.js` receipt(), `status: 'noop'`) keeps `output` only for completed jobs and changing mutations. Seen while writing the cut-check rows of the eval set.
- Effect: an agent asking the technique door a cut question learns how many issues there are and their warning codes, not the per-cut measures or fixes. `camera.checkCuts` itself answers in full.
- What the evals do: cut rows run `camera.checkCuts { request }` directly (the action the router names), so the flags come from its own receipt (`test/director-evals-apply.mjs`).
- Options: (a) leave it; the warnings carry the rules. (b) Put the flagged rules per cut into `checks` of camera.checkCuts (survives a no-op receipt). (c) Let the bus keep `output` on a no-op mutation receipt. Recommendation: (b), small and local to camera-coverage, in a later camera intent; not needed for this one.

## F-2: test/verify-agent-login.mjs fails in this container, on main too (blocking: no)

- Evidence: `node /home/claude/local-tools/suite-all.mjs --jobs 4` on this branch and on base main 38111cb (`/home/claude/local-tools/base-main-38111cb.txt`) both fail "an api-key login asks in order, stores the credential with its env in auth.json, and connects — a connected provider is listed first" (`+ 'amazon-bedrock'  - 'fake-cloud'`); run alone it fails the same way. It is not a timing check: the container's environment makes the agent see `amazon-bedrock` as a connected provider. This intent touches nothing in the agent login code.
- Effect on A8: the suite gate's only failures here are the two known timing checks (exitcar CPU budget, motion3 repair 10 s) and this environmental one, all three also failing on base.
- Proposal: the orchestrator records it as a second container exception (like the timing one), or reruns the suite where no cloud provider credentials are visible.
