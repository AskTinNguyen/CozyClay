<p align="center">
  <img src="docs/images/cozyclay-logo.png" alt="CozyClay" width="340">
</p>

<p align="center">
  <em>Block a scene, pose the cast, cut the camera, in a browser tab.</em>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <a href="https://www.npmjs.com/package/cozyclay"><img alt="npm" src="https://img.shields.io/npm/v/cozyclay"></a>
  <img alt="Node 22.19+" src="https://img.shields.io/badge/node-22.19%2B-brightgreen">
  <a href="https://github.com/NomaDamas/CozyClay/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/NomaDamas/CozyClay?style=flat"></a>
</p>

<p align="center">
  <a href="https://cozyclay.org/#try">Try it in the browser</a> ·
  <a href="INSTALL_FOR_AGENTS.md">Guide for AI agents</a> ·
  <a href="#docs">Docs</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="https://github.com/NomaDamas/CozyClay/issues">Issues</a>
</p>

---

CozyClay is open source previs software that runs in your browser. Stage a scene, pose
characters, compile their motion, cut the camera on a timeline, then export the same shot to an AI
video model as a first frame, a greybox reference clip or a prompt.

```bash
npx cozyclay
```

That is the whole install: Node.js 22.19+, a Chromium browser, no GPU. It opens
`http://127.0.0.1:5180/app/`. Add `--scene city-block` to start on a ready-made set.

> **Asking an AI agent to install it?** Give it this repository link. The agent instructions are
> in [`INSTALL_FOR_AGENTS.md`](INSTALL_FOR_AGENTS.md).

https://github.com/user-attachments/assets/00f28c2f-e8e2-43eb-b253-b6c2436e1818

## What it does

- **Stage**: primitives, set pieces, rigged characters and capsule stand-ins, with a gizmo and
  editor-style fly camera.
- **Motion**: the agent writes a motion spec, and a deterministic in-browser compiler bakes every
  frame. QA checks collisions, foot slide, reach and hand contact.
- **Camera**: shots on a timeline, dolly rails, look-through, per-shot target model limits.
- **Export**: keyframe pack, mp4, depth and normal passes, contact sheet, OTIO cut list, shot
  prompt.
- **Storyboard or Animation**: still panels with captions, or moving shots with takes.
- **Undo anything**: every edit, including the agent's, is one undo step.

## AI control

| Surface | Start | For |
| --- | --- | --- |
| Agent panel | `Cmd/Ctrl+B` in the studio | Chat with ChatGPT sign-in or your own key (Anthropic, OpenAI, Gemini, OpenRouter, CLIProxyAPI) |
| MCP server | `npx -y cozyclay mcp` | Claude Desktop, Claude Code, Cursor, any MCP client |
| Terminal | `cclay live status --wait` | Coding agents that drive a running studio |

MCP config:

```json
{ "mcpServers": { "cozyclay": { "command": "npx", "args": ["-y", "cozyclay", "mcp"] } } }
```

## From source

```bash
git clone https://github.com/NomaDamas/CozyClay.git && cd CozyClay
npm install
npm run dev     # http://127.0.0.1:5180/app/
npm test
```

## Docs

| Read | For |
| --- | --- |
| [`INSTALL_FOR_AGENTS.md`](INSTALL_FOR_AGENTS.md) | Install, run and connect, written for AI agents |
| [`docs/motion3-agent-guide.md`](docs/motion3-agent-guide.md) | Motion specs, compile and QA |
| [`docs/agent-cli.md`](docs/agent-cli.md) | `cclay live`, model providers, sessions |
| [`mcp/README.md`](mcp/README.md) | MCP tools and the live protocol |
| [`docs/studio-ui-ia.md`](docs/studio-ui-ia.md) | Where every control lives |
| [`docs/privacy.md`](docs/privacy.md) | Anonymous telemetry and opt-out (`cclay telemetry off`) |
| [`AGENTS.md`](AGENTS.md) | Contribution rules |

## License

AGPL-3.0-or-later. See [`LICENSE`](LICENSE), [`LICENSING.md`](LICENSING.md) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Made by [Doyun](https://github.com/HaD0Yun) at
[NomaDamas](https://github.com/NomaDamas).
