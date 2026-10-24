# Technique References: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

## F-1 (2026-10-24, rev 1) | blocking: yes | status: open

**Found:** CozyClay is a public fork. This intent would ship bibliographic citations (title, author, edition, page) for books in the owner's cinematic-atlas library. Citations carry no book text, but licensing is reserved for the owner (contract, Decisions). Separately, the atlas repo commits the source PDFs, some named after shadow-library downloads; nothing from those files may reach CozyClay.
**Options:** (a) ship citations only, limited to the camera and directing books, with links to the atlas only when the owner sets its URL (recommended); (b) keep the references out of the repo in a local user file the picker reads when present; (c) drop the intent.
**Proposed amendment:** none; D1 and A1 assume (a). Under (b), A1 and A2 write to a local file and the verify file uses a fixture only.
**Resolution:** <for the owner; a worker does not start before it>
