# Director evals

Scenarios in a director's words, each with the camera action CozyClay should answer with. `node test/verify-director-evals.mjs` resolves every row through the router `camera.applyTechnique` uses (`src/camera-coverage/route.js`), applies the rows marked `apply` through the command bus in memory, and prints one line per category plus `core: N/N`. `node mcp/verify-director-evals.mjs` runs the core rows (except composition rows) through the MCP tools in memory and checks they resolve the same way.

## Files

One file per category: `size.json`, `angle.json`, `move.json`, `lens.json`, `coverage.json`, `composition.json`, `cuts.json`, `motivation.json`, `structure.json`, `depth.json`, `negative.json`. Each is `{ "category", "label", "scenarios": [ ... ] }`, one row per line. The runner reads every `*.json` here, so a new category is a new file plus its name in `CATEGORIES` (`test/director-evals-data.mjs`).

## A row

| Field | What |
| --- | --- |
| `id` | unique, lowercase words joined by hyphens, starting with the category (`move-crane-ending`) |
| `tier` | `core` (must pass: a gate) or `stretch` (scored, failing ids listed, not a gate) |
| `category` | the file's category |
| `request` | the director's sentence, in CozyClay's own words; no two rows share a request |
| `cast` | who is in the scene: `mara`, `joon` (Mara at the origin facing Joon 4 m along +x) |
| `expected` | the resolution, below |
| `apply` | optional: the measured result on the fixture scene, below |
| `why` | one line, 12 to 200 characters, saying why that is the right answer |

`expected.action` is one of:

- `camera.applyTechnique` with `stack` (technique ids in order), optional `params` (`{ "push-in": { "speed": "slow" } }`, only the keys named are compared), `subject` (a cast id) and `composition` (`{ place, headroom, leadRoom }`, compared whole). A row without `stack` wants none.
- `camera.cover` with `pattern` and optional `cast` (cast ids in the order the words name them).
- `camera.checkCuts` with optional `frame`.
- `camera.checkMotivation` (a question about why the camera moves), `camera.alignMove` with `beat` (a beat id, a label word, or a frame) and `edge` (`start` or `settle`), and `story.addBeat` / `story.moveBeat` / `story.removeBeat` with `frame`, `label`, `kind` and `beat`, only the keys named are compared.
- `camera.checkStructure` (a question about the sequence's intensity curve), with `beat` when it names a beat to build into ("build to the reveal": `reveal`).
- `camera.checkShots` (a question about what a shot's camera does with the set), with `rule` when it names one (`occluded`, `inside`, `crop`); none checks every rule. A foreground request is a `camera.applyTechnique` row with `composition.foreground` (`{ id, share? }`).
- `none`: no camera action (a drink, a gunshot, a sports shot, a turn of phrase, or no camera words).

Any of them may add `confidence` (`high`, `medium`, `low`) to pin it. Every resolution must state its matched words and a confidence; the runner checks that for every row.

`apply` keys, all measured from the document after the bus runs the request on the shot `shot-a` (0-95, or 0-191 for coverage and cut rows):

- `move`: the classifier's move id (`push-in`, `orbit`, `pan-left`, `dolly-zoom`), which must also be `moveVerified`.
- `size`, `sizes`: the size the move ends on, or `[from, to]` (`"medium-wide shot"`, `"medium close-up"`).
- `height`: `below`, `level` or `above` the subject's eyes.
- `screenX`, `eyeLineY`: where the eyes sit (frame fractions from the top-left), on every stored key, within 0.015.
- `shots`, `oneSide`, `issues`: for coverage, the shot count, every camera on one side of the Mara-Joon line, and the cut issues `checkCuts` measures.
- `setup` and `flags`: for cut rows, the scene laid first (`srs`, `srs-crossed`, `jump`, in `test/director-evals-apply.mjs`) and the rules `camera.checkCuts` must flag (`[]` for clean).
- `refused`: for negatives, the refusal code (`INVALID_ARGUMENT`); the message must name the words and a confidence.

## Adding scenarios

A later intent adds rows to the files here; it does not touch the runner unless it needs a new `apply` measure or setup. Add the row as `core` when it passes, `stretch` when it shows a gap the intent is not fixing. Run the runner: a `core` row that fails is either a resolver fix in that intent (list it with the row id in its `progress.md`) or the wrong expectation. Write requests fresh; never copy book or quiz wording.

## When a stretch row moves to core

A stretch row moves to core in the change that makes it pass (decision D1 of `docs/intent/director-evals/prompt.md`): flip its `tier`, and record the move in that intent's `progress.md`. A core row never goes back to stretch to make the gate pass.
