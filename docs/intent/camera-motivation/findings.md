# Camera Motivation: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

## F-1 (2026-10-24, rev 1) | blocking: no | status: resolved

**Found:** Without dialogue or audio in the document, the only motivation sources are motion beats and subject travel, so a static dialogue scene with a push-in on an admission would always flag. The check needs authored story beats (`{ frame, label, kind }`), which are new document data and a product call reserved for the owner (contract, Decisions).
**Options:** (a) authored story beats on the document, drawn on the timeline and written to OTIO markers (recommended: the beats also feed `intensity-curve` and the sequence brief); (b) reuse shot names or notes as beats, with no new data and much weaker matching; (c) motion beats and subject travel only, and the check skips shots with no cast motion.
**Proposed amendment:** none; A1 assumes (a).
**Resolution:** option (a), by the orchestrator under the contract's away rule on 2026-10-24 (log L-3, D3). The owner can reverse it.
