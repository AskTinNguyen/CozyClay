# CozyClay MCP server

Lets an AI assistant (Claude Desktop, Cursor, any MCP client) block a scene, place the camera,
compile character motion and read the shot back as film vocabulary — then turn it into an AI
image/video prompt.

Works two ways, with one tool catalog:

- **Editor open** — tool calls drive the visible viewport live: camera, cast, set and the
  compiled motion on the timeline (`studio_run` with `motion.compile`).
- **No editor** — scene, camera, prompt and project-file tools run in memory with no browser,
  GPU or build step. `capture_frame`, `apply_batch` and `import_mesh` explicitly require a
  live editor.

## Run it locally

```sh
cd mcp
npm install
npm start          # speaks MCP over stdio and hosts ws://127.0.0.1:5184/live
npm run verify     # drives the no-editor fallback as a client and checks results
npm run verify:live # drives a fake editor over the live WebSocket protocol
```

Then point a client at it. For Claude Desktop, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cozyclay": {
      "command": "node",
      "args": ["/absolute/path/to/CozyClay/mcp/server.mjs"]
    }
  }
}
```

Restart the client; 35 tools appear.

Prefer a long-lived endpoint? `node server.mjs --http 5183` serves Streamable HTTP at
`http://127.0.0.1:5183/mcp` (one isolated session per client), with a plain status page at `/`.

## What it does

Describe the shot you want. The server does the trigonometry and answers the way a crew would.

> "Put a detective and a courier in an alley, then give me a low wide profile shot of the courier."

```
WIDE SHOT · RIGHT PROFILE · KNEE LEVEL · 24MM

size      wide shot — the subject fills 40% of frame height
view      a right-side profile view
level     a low knee-level angle looking up at the subject
distance  4.39m
```

`render_prompt` turns that same geometry into a prompt that carries the real framing, so the
generated frame matches the blocking instead of drifting off into a generic shot.

## Tools

| tool | what it does |
| --- | --- |
| `describe_scene` | the whole state: camera, framing, cast, set |
| `live_status` | whether an editor tab is connected for live control |
| `describe_shot` | current camera geometry as film vocabulary |
| `capture_frame` | a compressed live render with camera-plane, visibility and occlusion assertions |
| `set_camera` | move the lens / change focal length directly |
| `frame_shot` | frame by intent — size, view, level, side |
| `add_character` / `place_character` / `remove_character` | the cast (`add_character { model: "proxy-figure", posture: "stand" \| "sit" \| "lie" }` adds a rigless capsule figure) |
| `focus_character` | choose who the camera frames |
| `place_object` / `update_object` / `remove_object` | the set — `place_object` also accepts `name` and `parent`, so multi-part assets like "Building A" land as one named assembly |
| `import_mesh` | load a local GLB, OBJ or FBX from a filesystem path as a mesh prop (live editor required); optional floor position, yaw, standing height, clay |
| `sculpt_object` | build a clay prop from a recipe of soft parts (blob, box, cylinder, torus, frame), usually from a reference image; pass `id` with `recipe` to re-sculpt or with `edits` to patch parts; `capture: true` returns the frame too. Works without an editor. Contract: `docs/sculpt-from-image.md` |
| `compare_sculpt` | score a sculpt's silhouette against its reference image (PNG/JPEG path): IoU, proportion delta, missing area by height band, parts that stick out, and a reference \| overlay sheet; `candidates` ranks up to 12 edit sets without applying any. Works without an editor |
| `group_objects` | attach children to a parent so they move as one; pass `parent: null` to detach |
| `apply_batch` | execute up to 100 object mutations as one user-visible undo transaction |
| `render_prompt` | the shot as an AI image or video prompt; `scope: "sequence"` writes one brief for a range of shots (`from_shot`, `to_shot`): header, cast, numbered beats with timecodes, the measured camera, coverage roles, transitions and a continuity line. `profile` (`seedance-2.5`, `kling-3`, `veo-3.1`, `minimax-h3`, `minimax-h3-selfhosted`) shapes it for a video model and lists what breaks its limits with a fix. With an editor it reads the editor's shots; in memory the shots `cover_scene` planned |
| `mark_camera_move` / `describe_camera_move` | name a move between two camera positions |
| `list_camera_techniques` | the camera technique library: 65 film techniques (sizes, angles, moves, lens moves, coverage, modifiers) as an index, a search by name, alias, misspelling or mood (`query: "uneasy"`), or one technique in full (`id`, with its book `references`); `references: true` lists the book citations for every technique, coverage pattern and cut rule |
| `apply_camera_technique` | apply a technique stack from words (`request: "low-angle slow push-in on her"`) or ids (`stack`); with an editor it runs `camera.applyTechnique` (one undo entry, a receipt with the classifier-verified move); in memory it sets the camera and marks the move's start for `describe_camera_move`. `render_prompt` then states the technique |
| `cover_scene` | lay several shots at once from a coverage pattern (`shot-reverse-shot`, `master-coverage`, `dialogue-singles`, `walk-and-talk`, `action-coverage`, `establish-detail`) or words ("cover this conversation", "master and coverage", "reverse on Joon"); `cast` names A then B. With an editor it runs `camera.cover` (one undo entry; every camera on one side of the A-B line); in memory it plans the shots and checks their cuts |
| `check_cuts` | the editing rules at every cut: 180-degree line crossings, jump cuts, screen-direction flips, shot-reverse-shot eyelines, each with severity, frames and a fix; read only. With an editor it runs `camera.checkCuts`; in memory it checks the `cover_scene` plan |
| `check_motivation` | why each camera move happens: every move segment is motivated by a beat (a story beat, or with an editor a motion beat of an installed take), by its subject (follow camera, mount, tracking rail, a camera keeping a travelling subject on screen), or unmotivated; a beat more than `tolerance` frames (default 6) from the move's start or rest is `starts-off-beat` / `settles-off-beat`. Each issue has a severity, frames and a fix; read only. With an editor it runs `camera.checkMotivation`; in memory it checks the `cover_scene` plan and the `mark_camera_move` move against story beats and subject travel only, and says so |
| `story_beats` | add, move, remove or list the story beats the check reads (a line, a reveal, a decision: `frame`, `label`, `kind`), or words ("add a beat 'confession' at 120"). With an editor it runs `story.addBeat` / `story.moveBeat` / `story.removeBeat` (one undo entry each), and lists through `story.listBeats` (every beat with its id, frame, label and kind) |
| `check_structure` | the sequence's intensity curve against its story beats ("where does this sequence go flat?", "show me the intensity", "build to the reveal"): per shot size, height, lens, movement, cutting rate, roll and screen jump (each 0-1, weighted into one value), each cut's contrast, and `flat` / `peak-off-beat` / `no-build` issues with frames and a technique stack to apply (`apply_camera_technique`); without story beats only `flat` runs. `strip: true` adds the intensity strip as a PNG. Read only. With an editor it runs `camera.checkStructure`; in memory it reads the `cover_scene` plan against `story_beats` |
| `set_camera_capabilities` | give the shot camera what placement cannot: `roll_deg` (Dutch angle), `f_stop` with `focus_on` (a character, followed per frame) or `focus_distance` (depth of field), `shake` (handheld or vehicle, seeded), `mount` (a Snorricam on a character's chest, head, hips or back), `speed` (0.5 = slow motion) and `shutter_deg` (motion blur); `at_frame` keys roll and focus (two focus keys rack focus). With an editor it runs `camera.set` / `camera.setKey`; in memory `render_prompt` states them |
| `add_scene` / `switch_scene` | multiple scenes per project |
| `open_project` / `save_project` | read and write `.cclayproject` files |

Project file tools are restricted to `COZYCLAY_PROJECT_ROOT` (the server
working directory by default), accept direct child `.cclayproject` files only,
anchor relative opens to the retained project-root working-directory inode, reject symlink escapes,
open the final name with `O_NOFOLLOW`, and require
`overwrite: true` before replacing an existing regular file.

Coordinates are metres (`x` right, `z` toward the default camera, `y` height above the floor).
Rotations are degrees of yaw. Characters are addressed by letter (`"A"`), slot (`"2"`) or id
(`"char-a"`).

## Live editor control

The server hosts `ws://127.0.0.1:5184/live` by default (`COZYCLAY_LIVE_PORT` or
`--live-port <port>` to change it). Start the editor with that same `COZYCLAY_LIVE_PORT` so its
Vite build connects to the selected loopback endpoint; `npm run dev` preserves the environment
variable for the browser. A CozyClay editor tab then connects on its own; `live_status` tells you whether one is attached. With an editor connected, mutations
forward to it and reads report its real state — the screen you are looking at is the source of
truth. Without one, headless-capable tools keep their in-memory behaviour while `capture_frame`
returns an explicit connected-editor error. The other three live-only tools return a readable
ordinary response explaining that an editor is required. In `--http` mode each session
child attempts to bind the live port, so one session owns the editor and the others
intentionally run memory-only.

The wire protocol — one WebSocket, sixteen commands, editor-side rules — is specified in
[`LIVE-PROTOCOL.md`](LIVE-PROTOCOL.md).

The same socket also admits a second role: a **controller** is a local terminal process
(`cclay live`) that authenticates with the token from the hub's endpoint file — a browser page
can never read it, so the role stays with local processes. Controllers drive the very same
commands and tools through the very same workspace routing as an MCP client does; the CLI is a
thin terminal front end over this hub, not a parallel surface, so anything true of the tools
above (admission envelopes, receipts, per-workspace exclusion) is true of it too. The
terminal-agent guide for it is [`../docs/agent-cli.md`](../docs/agent-cli.md).

## Camera techniques

The library lives in `src/camera-techniques/`: each technique has an id, aliases, a kind, mood tags, a
short description written for CozyClay, parameters with defaults and a recipe. A stack holds one size,
one angle, one roll, one move and one coverage framing plus any modifiers; it compiles to the camera
primitives the editor already has (`shot.frame` keys, `shot.setCameraRail`, `camera.set`), and the move
the geometry classifier reads back is checked against the move the technique promises. Dutch Angle,
Canted Frame, Rack Focus, Handheld Shot, Snorricam, Slow Motion and Whip Pan set a real camera capability
(see below) and the answer reads back what it achieved; Shot-Reverse-Shot frames its first side on one shot,
and `cover_scene` lays the whole exchange (see Camera coverage). Through `studio_run` the same library is `camera.techniques`,
`camera.describeTechnique` and `camera.applyTechnique`.
The names are general film vocabulary; https://grokfilm.app is good further reading.

**Further reading.** Each technique, coverage pattern and cut rule carries up to three bibliographic
references (book, author, edition, year, pages) to camera and directing books indexed by the owner's
cinematic-atlas (`src/camera-references/`). They are citations only, never book text. A detail request
returns them: `list_camera_techniques { id }` (and `camera.describeTechnique`) answers `references:
[{ book, pages, cite }]`, `[]` when the atlas has no page for it, and `list_camera_techniques { references:
true }` lists every entry's citations in one read. The index stays as it was, and the Studio agent's
system prompt does not carry them. Agents cite them when explaining a choice ("Katz, Shot by Shot, p. 164").
The data is generated offline from a local atlas checkout: `ATLAS_DIR=<atlas checkout> node tools/atlas-refs.mjs`
rewrites `src/camera-references/data.js` (the matching table is `tools/atlas-refs-table.mjs`).

## Camera capabilities

The shot camera carries six capabilities beyond its keys and rail, each an optional field on the shot's
camera block (`src/camera-capabilities/`), sampled per frame in `sampleAt` and therefore the same in the
viewport, the Shot Camera preview, every capture and every export: roll (`rollDeg`), a lens (`fStop`, a
`focusTarget` cast id or a `focusDistance`; depth of field renders from the aperture), a deterministic
`shake`, a body `mount`, the shot's `speed` (the take plays retimed) and a `shutterDeg` (motion blur).
Roll and focus animate on rig keys (`rigKeys`, frame offsets in the shot) that ease like camera keys
without stopping the camera. `set_camera_capabilities` (or `camera.set` / `camera.setKey` through
`studio_run`) writes them; `render_prompt`, the keyframe pack's `camera.json` and `prompt.txt`, the USD
camera (`fStop`, `focusDistance`, `shutter:open/close`, a rolled orient, shake and mount baked into the
samples) and OTIO metadata carry them.

## Camera coverage

`cover_scene` (or `camera.cover` through `studio_run`) lays a coverage pattern over a range as one
undo entry: the range becomes the pattern's shots, each named ("SRS 2 · OTS Joon") and framed with
`camera.applyTechnique`, and every camera keeps one side of the line between the two principals (a
pattern laid next to another keeps the neighbour's side). Each shot stores `coverage { pattern,
index, role, subjectId }`. `check_cuts` (`camera.checkCuts`) reads every cut between consecutive
shots from the cameras and cast at the cut frames: `line`, `jump`, `screen` and `eyeline` issues with
a severity, the two frames and a suggested fix; it never changes a shot. `camera.applyTechnique` and
`frame_shot` take `composition { place auto|left-third|centre|right-third, headroom
tight|normal|loose, leadRoom none|facing|travel|more }` and answer `checks.screenX` / `eyeLineY`
(frame fractions from the top-left). `camera.setTransition` stores the transition into a shot
(dissolve, fades, whip, match cut, J- or L-cut); OTIO writes it as a `Transition.1` where OTIO has one
and as clip metadata always, and the prompt gains a `TRANSITION:` line.

## Camera motivation

Story beats are authored on the shot document (`storyBeats: [{ id, frame, label, kind }]`, kinds
`disclosure`, `reveal`, `threat`, `decision`, `input`, `event`); OTIO writes each as a marker and the
sequence brief names them (`Story 00:00:05:10 (f130): disclosure, Mara makes her admission.`) with a
`Motive:` line per beat. `check_motivation` (`camera.checkMotivation`) splits each shot's measured
camera into moves and judges each one; `camera.alignMove { shotId, beat, edge }` (through
`studio_run`) retimes a move's camera keys or rig keys so it starts or comes to rest on the beat, as
one undo entry, and answers the re-check. Holds and follow cameras are never flagged.

## Intensity curve

`check_structure` (`camera.checkStructure`) reads a sequence's visual structure from the measured
cameras: per shot the size step, the camera's height against the subject's eyes, the focal length,
the camera's speed, the shot length as cutting rate, the roll, and the subject's screen jump at the
cut, each normalised to 0-1 and weighted into one combined value, and each cut's contrast (the jump
in every component across it). The formulas, weights and limits live in one data module
(`src/intensity-curve/weights.js`). Rules: `flat` (3 or more shots with every cut under 0.08 total
contrast), `peak-off-beat` (the highest shot neither holds nor follows the strongest story beat) and
`no-build` (no rise into a reveal, threat or decision beat, or the beat `beat` names); with no story
beats only `flat` runs. Each issue's suggestion is a technique stack (one size tighter on a longer
prime, `low-angle`) with `camera.applyTechnique` args, and shorter shots in words. The sequence brief
gains one `STRUCTURE:` line ("intensity builds from 0.20 at beat 1 to a peak of 0.52 at beat 4, then
releases to 0.49 by beat 5."), and `strip: true` returns the strip as a 960 x 160 PNG
(`src/intensity-curve/strip.js` `stripImage`).

## Camera requests in words

Every camera request in words goes through one router (`src/camera-coverage/route.js`): coverage,
composition and cut words first, then the technique stack. A "shot" that is not a camera shot (a drink,
a gunshot, a flu shot, a basketball shot, a mugshot) names no camera action unless a camera word sits
beside it ("close-up on Joon as the gunshot rings out" is a close-up). `camera.applyTechnique`,
`camera.cover` and `camera.checkCuts` state the words they matched and a confidence in their receipt
(`output.matched`, `output.confidence`: high when named outright, medium for a spelling slip or a cut word
without a question, low for a mood); a request with no camera action is refused (`INVALID_ARGUMENT`) with
the words and the confidence. In memory, `apply_camera_technique`, `cover_scene` and `check_cuts` end with
the same as a `resolved` line ("low-angle slow push-in" answers `resolved  camera.applyTechnique low-angle +
push-in · matched "low angle", "slow push" · confidence high`). The director eval set (`test/fixtures/director-evals/`) holds the
scenarios they are measured on.

## Motion

Motion is compiled, not generated: run `motion.compile` through `studio_run` with a motion
spec (key poses, anchors, props, walks, hinged objects, task checks). The Studio bakes every
frame on the rig, answers the QA groups, and installs the take; `motion.sample` and
`motion.qa` read it back. The spec format and the loop are in
[`../docs/motion3-agent-guide.md`](../docs/motion3-agent-guide.md).

## Storyboard projects and capsule figures

The tool list is fixed when the server starts, so it is the same 34 tools in every project. A
tool that does not apply to the project or to its target answers a structured refusal instead
of acting; nothing is sent to the editor and nothing changes. The refusal is the tool's only
text content, with `isError: true`:

```json
{ "ok": false, "code": "NOT_IN_MODE", "reason": "This project is a Storyboard - mark_camera_move is available in Animation projects." }
```

| code | when | tools |
| --- | --- | --- |
| `NOT_IN_MODE` | the project's `previsMode` is `storyboard` | `mark_camera_move` |
| `TARGET_NOT_READY` | the target character is a capsule figure (`model: "proxy-figure"`) | `studio_run` motion, take, IK and pose actions |

`describe_scene` reports `previsMode: storyboard` or `previsMode: animation` (the connected
editor's project; `open_project` sets it without one) and marks each cast member
`kind: rig` or `kind: proxy`, with a capsule figure's `posture`.

A **storyboard project** is a sequence of still shots: one picture per panel, held for a
number of frames, with a caption. Block it with the camera, cast and set tools, and run the
still-shot commands (`shot.createStill`, `shot.setCaption`, `shot.setHold`, ...) through
`studio_run`. Motion and named camera moves belong to Animation projects.

A **capsule figure** is a rigless stand-in for blocking: `add_character { subject, model:
"proxy-figure", posture: "sit" }`. It places, turns and frames like any cast member and holds a
posture (`stand`, `sit` or `lie`), but it has no skeleton, so motion and takes are refused with
`TARGET_NOT_READY` and the kind's reason, for example `Capsule figures have no rig - Motion
generation works on rigged characters only.` The editor refuses its own IK, pose, physics,
collision and line-edit commands on a capsule figure with the same code when they arrive
through `studio_run`. Use a rigged model for anything that moves a body.

## Round-trips with the studio

`save_project` writes a real `.cclayproject` file, so a scene blocked here opens in the studio to
be posed, timed and generated — and a scene built in the studio opens here with `open_project`.
The configured project-root directory must only be writable by the trusted user running the MCP
server; project I/O rejects symlinks and hard-linked project files but relies on that directory
permission boundary to prevent an untrusted local process from adding links during an operation.

## Design

This server owns no geometry, no film vocabulary and no prompt text. Every answer is computed by
the same modules the studio renders with, imported straight from the working tree:

| module | responsibility |
| --- | --- |
| `../src/shot.js` | geometry → film vocabulary → prompt |
| `../src/scenes.js` | the scene document and its stage envelope |
| `../src/scene-objects.js` | the set: create / update / remove, clamped and snapped |
| `../src/camera-move.js` | two framings → a named camera move |
| `../src/project.js` | the `.cclayproject` envelope |

That is the whole design. Because the imports are relative, the server always speaks the working
tree's vocabulary: retune a band in `shot.js` and this server reports the new answer on its next
start, with nothing to publish or reinstall. The studio and the MCP server cannot disagree about
what a 35mm medium shot is, because there is only one implementation of it.

`frame_shot` is the one place that inverts `shot.js` rather than calling it — it solves for the
camera position that produces a requested size. `npm run verify` checks all 420 combinations the
schema accepts, so a retune in `shot.js` fails loudly here instead of quietly mis-framing.

### Framing conflicts

Shot size is treated as the stronger request. An extreme close-up from an overhead lens is
geometrically impossible on a wide lens — the camera would sit inside the subject — so the server
lengthens the lens until the requested angle fits and says so, the way a crew swaps glass rather
than abandoning the close-up.
