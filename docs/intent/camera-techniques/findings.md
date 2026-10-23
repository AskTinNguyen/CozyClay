# Camera Technique Library: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

## F-1: The Studio agent system prompt is at its size budget (blocking: no)

- Evidence: `test/motion3/verify-motion3-prompt.mjs` caps `STUDIO_SYSTEM_PROMPT` at 12,790 characters; on the base commit it is 12,787. A two-sentence technique note made it 13,487 and failed the check (`AssertionError: 13487`).
- What I did: replaced the sentence `shot.setCameraMode { mode: keys | follow | rail } switches a shot's camera.` (75 characters; the action stays listed in the prompt's `<actions>` block and is described by inspect_studio) with `Film terms (push-in, OTS, vertigo, a mood): camera.applyTechnique { request }.` (78 characters). The prompt is now exactly 12,790. How to stack techniques lives in the `camera.applyTechnique` and `camera.techniques` descriptions, which the prompt already requires the agent to read before calling an action.
- Options: (a) keep this (recommended; no budget change); (b) raise the budget in a later intent (`shot-prompt-engine`) and restore the setCameraMode sentence with a fuller technique paragraph.
- Proposed amendment: none to this intent; note for `shot-prompt-engine`.
