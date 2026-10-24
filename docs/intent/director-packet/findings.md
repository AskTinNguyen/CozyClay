# Director Packet: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

## F-1 (2026-10-24): an agent writes the pack without a click (non-blocking, continued on the recommendation)

A5 asks that `cclay live` write the full pack, so `export.directorPacket` must run for an agent. `export.shotVideo`, the other export action, has exposure `confirm` ("Exporting writes a video file outside the Studio"), and MCP cannot mint a confirmation token, so a `confirm` exposure would refuse every agent call with CONFIRMATION_REQUIRED.

Options:
1. `open` exposure (as built): the agent's call writes `cozyclay-sequence-<title>.zip` to the export folder or the browser download, like the menu item; the editor toasts it. It overwrites nothing in the document and spends nothing.
2. `confirm` exposure: agents are refused until the owner confirms in the Studio; A5's live half then needs a person.

Recommendation: 1, the action only writes a download the same way the menu does. Reverse it by adding `exposure: "confirm"` to `packetDeclarations` in `src/commands/director-packet.js`.
