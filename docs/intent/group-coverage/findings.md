# Group Coverage: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

## F-1: the group patterns have no atlas citations yet (open, not blocking)

Merging #12 (technique-references) made every coverage pattern need a reference or a "none" listing
(`test/verify-technique-references.mjs`). `src/camera-references/data.js` is generated from a local
cinematic-atlas checkout this container does not have, so `triangle-dialogue`, `group-singles` and
`branching-dialogue` are listed in `NO_REFERENCES.patterns` (what `tools/atlas-refs.mjs` writes for an
id with no table row) and the generator's fixture count moved from 71 to 74 "without". The panel
shows "No book page in the atlas for this one yet." for them.
Options: (a) leave as none; (b) the owner adds rows for the three ids to `tools/atlas-refs-table.mjs`
(three-person and group staging, branching or alternate takes) and reruns
`ATLAS_DIR=<atlas> node tools/atlas-refs.mjs`. Recommendation: (b) when the atlas is at hand; no page
numbers were invented here.
