# Intents

Each feature built by agents runs as a living intent in `docs/intent/<feature>/`: `prompt.md` (the spec, by the orchestrator), `log.md` (every prompt, verbatim), `progress.md` (the worker's record and evidence), and `findings.md` (discoveries that may change the spec). The procedure is the `intent` skill ([AskTinNguyen/intent](https://github.com/AskTinNguyen/intent)); this file is the project's contract with it, and wins where they differ. Neither weakens a rule in `CLAUDE.md`.

This is the AskTinNguyen/CozyClay fork (upstream NomaDamas/CozyClay). Upstream releases arrive through `git fetch upstream` and a merge of `upstream/main`; that is not an intent.

## Statuses

| Status | Meaning |
| --- | --- |
| `planned` | Written ahead; no worker yet. A `Waits for` line names what must happen first. |
| `active` | A worker runs against it. |
| `parked` | Stopped on purpose, with a reason; resumes from the files. |
| `completed` | Every Acceptance row met and the PR merged into the fork's `main`. |

## Areas

Every intent names exactly one area.

| Area | Covers |
| --- | --- |
| Studio Shell | The app shell and chrome: `src/App.jsx`, `src/main.jsx`, `src/shell/`, `src/panels/`, `src/hierarchy-*`, `src/asset-pane.jsx`, `src/project-browser*.jsx`, `src/locale.js` |
| Bus and Document | The command bus and the document: `src/command-bus.js`, `src/bus-*.js`, `src/commands/`, `src/domains/`, `src/document-store.js`, `src/studio-actions.js`, `src/studio-app-binding.js`, `src/studio-agent-protocol.js`, `src/project.js`, `src/scenes.js` |
| Scene and Viewport | The set and the 3D view: `src/scene-*.js`, `src/props.jsx`, `src/effects/`, `src/kits/`, `src/matte*.js`, `src/material-*.js`, `src/stage-*.js(x)`, `src/object-*.js(x)`, `src/dualview.jsx`, `src/planview.jsx` |
| Camera and Shots | Cameras, shots and the timeline camera: `src/shot*.js`, `src/cuts.js`, `src/camera-*.js`, `src/sample-at.js`, `src/speed-envelope.js`, `src/model-presets.js`, `src/commands/shot.js`, camera panels |
| Motion | Character motion: `src/motion3/`, `src/motion/`, `src/commands/motion3*.js`, `src/domains/motion*` |
| Export | Files out of the studio: `src/keyframe-pack.js`, `src/offscreen-export.js`, `src/mp4-muxer.js`, `src/render-passes.js`, `src/otio.js`, `src/usd-camera.js`, `src/stage-capture.jsx`, `src/export-workspace.js`, `src/studio-contact-sheet.js` |
| Agents and Live | Agent surfaces: `bin/agent/`, `bin/live/`, `mcp/`, `src/live-control.js`, `src/studio-agent-*.js`, `src/agent-*.js`, `src/workflow/Agent*`, `src/workflow/agent-*` |
| Workflow | The `/workflow/` node graph and model hand-off: `src/workflow/` (except the Agent panel files), `bin/agent/video-adapters.mjs`, `workers/api/` |
| Platform | Build, CI, test harnesses, release tooling, the agent workflow: `tools/`, `.github/`, `vite.config.js`, `bin/cozyclay.mjs`, `package.json`, `docs/intent/` |

## Proofs

Every acceptance item names one of these. A proof is a result in tool output, never a prose claim.

| Proof | What counts |
| --- | --- |
| `gate: <command>` | The command ran in the intent's worktree and exited 0; for test runners, a pass count with zero failures. Quote its result line. This project's gates: `npm run lint`, `npm run build`, a named verify file (`node test/verify-<name>.mjs`, `node mcp/verify-<name>.mjs`), and the suite `node tools/run-tests.mjs --jobs 4`. |
| `build` | `npm run build` succeeded. |
| `ui:qa` | A browser QA script ran through `node tools/qa-browser.mjs -- node test/<file>-browser.mjs` (or `npm run qa:browser -- …`) against the intent's dev server and exited 0. On Windows set `CHROME_PATH` to the installed Chrome. |
| `ui:shot` | A screenshot of the real studio produced by a command (a QA browser script, `cclay live capture --out`, or `tools/headless-studio.mjs`), committed under `docs/intent/<feature>/proofs/`, with the command and its exit code in `progress.md`. The orchestrator opens the image and records what it shows as a `review` row before the item counts. |
| `review` | A versioned review record: who or what process, timestamp, content revision. |
| `owner` | The owner checked it themselves and said so (recorded in `log.md`). |

Known exception on the owner's Windows PC (recorded 2026-10-23): `test/motion3/verify-motion3-repair.mjs` misses its 10 s CPU budget ("exit car, hips sunk: under 10 s") with or without changes, and timing checks starve when the suite runs one job per core. A suite gate counts as passed when its only failure is that timing check, it also fails on the intent's base commit, and both result lines are quoted. Any other failure fails the gate.

## Read First

Workers read these besides the intent files and `CLAUDE.md`:

- `docs/v3-plan.md` (the 3.0 direction).
- Camera and Shots: `src/shot.js`, `src/camera-move.js`, `src/camera-block.js`, `src/sample-at.js`, `src/commands/shot.js`.
- Motion: `docs/motion3-agent-guide.md`, `docs/motion-api-v3.1.md` (frozen contract).
- Agents and Live: `mcp/README.md`, `mcp/LIVE-PROTOCOL.md`, `docs/agent-cli.md`.
- Studio Shell: `docs/studio-ui-ia.md`, `DESIGN.md`.

## Decisions

Engineering calls inside an intent's scope are the worker's. These go to the owner as findings with options and a recommendation:

- Product and scope, design, content, licensing (including third-party material such as GrokFilm's definitions and reels or the Prompt Edition corpus), privacy and telemetry.
- Any change to the frozen motion contract (`docs/motion-api-v3.1.md` and the files it freezes).
- Raising a lint baseline (`tools/*-baseline.json`).

While the owner is away and has said not to wait (see the intent's `log.md`), the orchestrator decides these itself on the recommended option, records the decision with its reason, and keeps going; the owner can reverse it later.

## Never

Besides credentials, `.env` files, full chat transcripts, pushing to `main`, force-pushing and weakening a gate:

- Raise `tools/*-baseline.json` to make a PR pass. Run `npm run lint:update` only when a PR deliberately reduces findings, and commit the baselines in that PR.
- Edit the frozen motion files (`src/commands/motion3.js`, `src/motion3/pipeline.js`, `src/motion3/qa/index.js`, `src/motion3/refs.js`, `src/motion3/json-patch.js`, `src/motion3/report.js`, `src/motion3/qa/severity.js`) without a recorded decision.
- Copy third-party definitions, prompts or videos verbatim into the product; technique names are general vocabulary, descriptions are written fresh.
- Commit `.omo/`, scratch files, experimental `.npz`, or `public/scenes/` unless the intent says so.
- Publish to npm, touch `COZYCLAY_PACKAGE_SIGNING_KEY` or the package marker, or change telemetry endpoints.
- Sign in to external sites or spend money on model APIs.

## Git And Merge

- Worktrees: `C:\Projects\CozyClay-wt\<feature>` (that is, `../CozyClay-wt/<feature>`), branch `intent/<feature>`, cut from the fork's `main`. Install with `npm ci` and `npm --prefix mcp ci` in the worktree.
- Ports per worktree, so parallel workers and the owner's studio (5180, live hub 5184) never collide: dev server `npm run dev -- --port <5200+n>`, live hub `COZYCLAY_LIVE_PORT=<5300+n>` on both the dev server and any `cclay live` client, CDP `CDP_PORT=<9300+n>`. The intent's `prompt.md` names its `n`.
- `main`: GitHub Actions are not enabled on the fork, so a push to `main` triggers nothing today. If they are enabled, `ci.yml` runs on pull requests and `pages.yml` builds, tests and deploys GitHub Pages on `main` pushes; `public/CNAME` names upstream's `cozyclay.org` and must change before Pages is turned on.
- Merge authority: `after-proof`. The owner granted it on 2026-10-24: "Yes they may." The orchestrator squash-merges an intent PR into the fork's `main` when every Acceptance row is met from tool output; never `--admin` over a failed check.
- After merge, confirm: the merge commit is on `origin/main` (`git log origin/main -1`), and CI is green on it once Actions are enabled.

## On Close

- Add a line under `## Unreleased` in `CHANGELOG.md` for a user-visible change.
- Update `mcp/README.md` when MCP tools change, `docs/agent-cli.md` when `cclay live` verbs change, and `docs/studio-ui-ia.md` when controls change.
