# Shot Prompt Engine: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

## F-1: Model facts for the profiles, from public vendor pages (blocking: no)

- Evidence: read on 2026-10-24 without signing in (WebSearch/WebFetch). Each fact is in `src/model-presets.js` with `checkedAt: 2026-10-24`, its `sources`, and an `unverified` list.

| Model (preset id) | Fact | Source | Status |
| --- | --- | --- | --- |
| Kling 3.0 (`kling-3`, replaces `kling-2`) | clips 3-15 s ("ranging from 3 to 15 seconds") | https://kling.ai/quickstart/klingai-video-3-model-user-guide (page dated 2026-02-06) | verified |
| Kling 3.0 | Multi-Shot: up to six shots per generation, shot lengths add up to the clip | https://kling.ai/blog/kling-3-15s-video-narrative-control-duration (2026-07-28) | verified |
| Kling 3.0 | 720p / 1080p; start and end frames | user guide above; https://kling.ai/quickstart/klingai-video-3-omni-model-user-guide | verified |
| Kling 3.0 | aspects 16:9, 9:16, 1:1 | no vendor page lists them (resellers only) | unverified |
| Kling 3.0 | fps (24 assumed) | not on a fetched page | unverified |
| Veo 3.1 (`veo-3.1`, replaces `veo-3`) | 4, 6 or 8 s; 8 s required for 1080p, 4K, reference images, extension | https://ai.google.dev/gemini-api/docs/veo ; https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/veo/3-1-generate (updated 2026-10-22) | verified |
| Veo 3.1 | 16:9 or 9:16; 24 fps; generated sound; first and last frame; up to 3 reference images | same two pages | verified |
| Veo 3.1 | Gemini API preview ids shut down 2026-10-22; Vertex GA ids `veo-3.1-generate-001` retire on or after 2026-11-17 | same two pages | verified |
| Veo 3.1 | cuts inside one clip | not documented | unverified (the profile makes one clip per beat) |
| MiniMax H3 (`minimax-h3`, new hosted preset) | 4-15 s, whole seconds ("4-15 seconds, integer values only") | https://platform.minimax.io/docs/guides/video-generation | verified |
| MiniMax H3 | aspects 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 (plus adaptive); 768P or 2K | https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md | verified |
| MiniMax H3 | camera tags in brackets ("[pan], [zoom], [static]") | guide above | verified |
| MiniMax H3 | output fps, cuts inside one clip | not documented | unverified |
| MiniMax H3 self-hosted (`minimax-h3-selfhosted`) | 10 s, 12:7 | the owner's own setup; no public page | unverified (kept as it was) |
| Seedance 2.5 (`seedance-2.5`) | 4-30 s; aspects 16:9, 4:3, 1:1, 3:4, 9:16, 21:9; up to 1080p; 24 fps | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api | verified |
| Seedance 2.5 | cuts inside one clip | not documented on a page that rendered | unverified (the profile allows cuts, marked `cutsVerified: false`) |

- What I did: Kling 2.0 became Kling 3.0 (`kling-3`; the stored id `kling-2` reads as it, so older shot documents keep their target), Veo 3 became Veo 3.1 with 4/6/8 s (`veo-3` reads as it), Seedance 2.5's floor moved from 2 s (a reference-clip limit) to its 4 s output minimum, and MiniMax H3's hosted API got its own 15 s preset beside the self-hosted 10 s one. Existing tests that encoded the old numbers (`test/verify-model-presets.mjs`, `test/verify-shot-meta.mjs`, `test/qa-shot-meta-browser.mjs`) were updated to the new facts.
- Proposed amendment: none. Re-check the unverified rows when Kling publishes its API parameters.
- Resolution (orchestrator, rev 2): accepted as D4.

## F-2: Studio agent prompt budget raised from 12,790 to 13,400 characters (blocking: no; decision)

- Evidence: `STUDIO_SYSTEM_PROMPT` was 12,789 of 12,790 on base 8a15bbca (camera-techniques F-1). With the camera library paragraph it is 13,355 (`node -e "import('./bin/agent/studio-prompt.mjs').then(m=>console.log(m.STUDIO_SYSTEM_PROMPT.length))"` -> `13355`).
- What I did (A6, recorded decision): restored `shot.setCameraMode { mode: keys | follow | rail } switches a shot's camera.` and added one camera-library paragraph after `Film terms ...: camera.applyTechnique { request }.`: the receipt's `checks.moveVerified`, `camera.set` / `camera.setKey` capabilities (roll, focus and rack focus, shake, mount, speed, shutter), `camera.cover` patterns on one side of the line, `camera.setTransition`, and `render_prompt { scope: "sequence", profile }` (+566 characters). The cap is now 13,400 in `test/motion3/verify-motion3-prompt.mjs` and `test/verify-camera-coverage-resolve.mjs` (which also checks the new sentences). The motion part (2,690 cap) is untouched; `node test/verify-agent-context-budget.mjs` still passes (`turn-3 system prompt: 25248 bytes after the hook`).
- Why: without these sentences the agent knew the camera library only from action descriptions it has to fetch first; the three camera phases added four commands and an MCP scope the prompt never named. 45 characters of headroom stay for small fixes; a larger addition should raise the cap again on purpose.
- This is not a lint baseline (`tools/*-baseline.json` unchanged).
- Proposed amendment: none.
- Resolution (orchestrator, rev 2): accepted as D5.
