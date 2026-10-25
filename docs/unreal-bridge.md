# CozyClay Unreal Bridge

Status: proposal (2026-10-25). Nothing here is built yet. The build runs as the intent [`docs/intent/unreal-bridge/`](intent/unreal-bridge/prompt.md).

CozyClay is the front of a pipeline that lands scenes in Unreal Engine as cinematic blockouts. It already computes the hard part: where every camera stands, what lens it wears, when it cuts, who it frames and why. This document proposes the MCP modules and tools that carry that data into Unreal as a Level Sequence with CineCameras, a blocked-out cast and set, and the director's notes, without anyone retyping a number.

Every CozyClay file and function named here exists on `main` at `c8056c3`. The Unreal side has not been tried against a running editor.

## Recommendation in brief

1. **One handoff document, two transports.** A versioned, deterministic `unreal-handoff.json`, built by the same pure modules as `packet.json`. The MCP either pushes it live into an open Unreal Editor, or writes it as a folder that an Unreal-side importer reads. Both paths run the same importer, so they cannot drift.
2. **The math lives in one CozyClay module, not in Unreal.** Metres to centimetres, Y-up to Z-up, right-handed to left-handed, yaw sign, filmback, frame ranges: `src/unreal/space.js`. A golden test proves a cast member's eye lands on the same pixel in both engines. The Unreal importer applies no conversion of its own.
3. **Upsert, never duplicate.** Every actor and sequence Unreal receives carries its CozyClay id as a tag, so a second push updates the blockout instead of adding a copy.
4. **Cameras and timing first.** Phase 0 is cameras, cuts, story-beat markers and stand-ins in a Level Sequence. Motion retargeting, colour-script lighting and the director overlay follow, then the round trip back into CozyClay's checks.
5. **No second implementation of a camera rule.** Every check, coverage pattern and measurement stays in CozyClay's pure modules (they import nothing from three.js), and Unreal receives their results. This keeps upstream merges useful and follows the `mcp/README.md` design principle.

## What CozyClay already produces

| Data | Where it lives | Exported today as | Lands in Unreal as | State |
| --- | --- | --- | --- | --- |
| Camera per frame: position, yaw, pitch, roll, focal mm | `src/sample-at.js`, `src/shot-prompt-engine/measure.js` | USDA camera (`src/usd-camera.js`: Y-up, metres, per-frame samples) | CineCameraActor transform and focal length keys | have |
| Filmback: sensor id, used vertical gate, aspect | `src/shot.js` (`SENSOR_FORMATS`, `usedSensorHeightMm`), `src/otio.js` `shotMetadata` | USDA apertures, OTIO metadata | CineCamera Filmback sensor width and height | have |
| Capabilities: f-stop, focus distance or focus-on, rack keys, shake, Snorricam mount, speed, shutter angle | `src/camera-capabilities/fields.js` | USDA schema attributes plus `cozyclay:*` records | Aperture, focus method and distance, attach to a socket, play rate, Movie Render Queue shutter | have |
| Shots: frame ranges, delivery order, timecode in and out, transition in | `src/shot-prompt-engine/sequence.js`, `src/camera-coverage/transitions.js` | OTIO cut list, packet shot list CSV | Master sequence Shot track, one shot sequence each, fades and blends | have |
| Story beats: frame, kind, label | `src/camera-motivation/story-beats.js` | OTIO markers, packet `beats` | Sequencer marked frames | have |
| Coverage role, size, angle, composition, technique stack, measured move words | `src/camera-coverage/`, `src/camera-techniques/` | Packet shot rows | Shot sequence metadata, actor tags | have |
| Lines of action, cast marks, walk paths, frustums | `src/director-packet/plan.js` (`planPrimitives`) | Packet `plan` (world x, z) | Editor-only overlay actors | have |
| Depth layers per shot | `src/camera-depth/layers.js` | Packet, `check_shots` | Shot metadata | have |
| Intensity curve and structure issues | `src/intensity-curve/` | Packet `intensity`, PNG strip | Float curve on a director actor, issue markers | have |
| Shot looks and the colour script | `src/stage-shot-look.js`, `src/colour-script/` | Packet, PNG strip | Per-shot keys on a lighting rig and post process volume | have |
| Check flags: cuts, coverage, motivation, shots, structure | `src/director-packet/checks.js` | Packet `flags` and `notes` | Marked frames and a review panel | have |
| Cast placement over time and Mixamo X Bot / Y Bot takes | `src/motion3/`, `castAt` (`src/camera-coverage/cut-geometry.js`) | Not exported (only a clip video in keyframe packs) | Root transform track, then a retargeted Animation Sequence | placement only |
| Set: primitives, sculpts, imported meshes, groups, lights | `src/scene-objects.js`, `src/sculpt-*` | OTIO blocking metadata (positions only) | Basic shape actors, imported static meshes, attachments | transforms only |

The MCP server (`mcp/server.mjs`, 39 tools) already reads every row above, in memory or through a live editor. The bridge adds tools beside them; nothing in the current catalogue changes.

## Shape of the bridge

```text
CozyClay Studio ──ws://127.0.0.1:5184/live──▶ CozyClay MCP server
                                               ├─ 39 existing tools (unchanged)
                                               ├─ unreal_* tools
                                               ├─ src/unreal/space.js     (axes, units, lens, frames)
                                               ├─ unreal-handoff.json v1  (the contract)
                                               └─ unreal adapter (transport)
                                                    ├──▶ Unreal Editor, live: CozyClayBridge plugin
                                                    │      (Remote Control API, or Python remote execution)
                                                    └──▶ Handoff folder, offline: json + glb + anim
                                                           (the same importer, run from a menu)
              ◀── phase 3: unreal_pull reads edited cameras back into CozyClay's checks
```

The MCP server stays the one place an agent talks to. It already holds the live hub to the Studio; it gains a second connection, to Unreal. "Block this sequence in Unreal" becomes one tool call that reads the Studio, converts, and pushes. The handoff document also works without a Studio: the MCP's in-memory mode builds it from a `.cclayproject` or a `cover_scene` plan.

On the Unreal side a small editor plugin, `CozyClayBridge` (Python importer plus a thin C++ shell for menus and the panel), owns the import. The MCP reaches it through Unreal's Remote Control API over HTTP, or through Python remote execution when Remote Control is off. The same importer runs from a menu item against a handoff folder, so a machine without the MCP can still take a package.

## Space and time contract

CozyClay is metres, right-handed, Y up, with the default camera on +Z looking down -Z (`src/usd-camera.js`, `src/director-packet/plan.js`). Unreal is centimetres, left-handed, Z up, X forward.

### Position

```text
UE.X = -cc.z * 100   // forward
UE.Y =  cc.x * 100   // right
UE.Z =  cc.y * 100   // up
```

Forward, right and up keep their physical meaning, so the axis swap absorbs the handedness change. A shot framed toward -Z in CozyClay looks down +X in Unreal.

### Camera rotation

```text
Pitch =  deg(cc.pitch)
Yaw   = -deg(cc.yaw)
Roll  = ±cc.rollDeg     // sign pinned by the golden test, not by reasoning
```

Three's YXZ Euler (yaw, then pitch, then roll, as `usd-camera.js` composes it) matches FRotator's yaw, pitch, roll order. Yaw flips because CozyClay's positive yaw turns toward -X (left) and Unreal's turns toward +Y (right). Positive pitch looks up in both.

### Cast facing

```text
ActorYaw = 180° - cc.rot
MeshYaw  = the asset's forward offset (-90° for the UE Mannequin)
```

CozyClay's `rot` 0 faces +Z, toward the default camera (`plan.js` draws facing as `(sin rot, cos rot)` in x, z), which is -X in Unreal. The mesh offset belongs to the asset map, never to the converted transform.

### Lens

```text
SensorHeight = usedSensorHeightMm(sensorId, aspect)   // min(h, w / aspect)
SensorWidth  = SensorHeight * aspect
FocalLength  = focalMm
Aperture     = fStop
FocusDistance = focusDistance * 100                   // cm
```

CozyClay's FOV is vertical, measured on the gate left after the output aspect crops the sensor. Giving the CineCamera exactly that cropped gate (width = height × aspect, which never exceeds the physical sensor width) makes Unreal's horizontal FOV and CozyClay's vertical FOV describe the same frustum. Focus-on-a-character becomes Tracking focus on that character's head socket.

### Time

```text
DisplayRate    = document.fps (24)
TickResolution = 24000
section range  = [startFrame, endFrame + 1)
shot section   @ deliveryStart in the edit
```

CozyClay ranges are inclusive; Sequencer's upper bound is exclusive, so every section ends one frame later. `deliveryStart` is the shot's start in edited time (`shot-prompt-engine/sequence.js`). Speed below 1 becomes the shot section's play rate, not retimed keys.

### Proof

For each shot, at its first, middle and last frame, project every cast member's eye point (`eyePoint` in `src/camera-coverage/composition.js`) through the CozyClay camera and through the converted Unreal camera. The two must agree within 0.5 px at 1920×1080. This runs in CozyClay's test suite against Unreal's projection formula, then inside Unreal by reading the camera back and projecting there.

Shake and Snorricam mounts are already baked into the per-frame samples, so the default export bakes them too and records the source as metadata. A later option can emit them as a Camera Shake asset and an attach track.

## Modules

Each module is a section of the handoff document, a CozyClay builder, an Unreal importer step, and its own MCP tool, so an agent can push only cameras, or only the look, without touching what someone edited in Unreal.

### Sequence and timing (`handoff.sequence`)

Coverage overlaps in scene time (a master and two singles over the same frames), so one Camera Cut track cannot hold it. Unreal's own cinematic structure can:

- `SEQ_<scene>_Master`: a Shot track in delivery order, one section per CozyClay shot at its `deliveryStart`.
- `SEQ_<scene>_Action`: cast and props over the full scene timeline, included in every shot as a subsequence.
- `SHOT_010`, `SHOT_020`, …: the shot's CineCamera, its Camera Cut, its play range in scene frames. Numbering by tens leaves room for inserts.
- Transitions: dissolves as overlapping shot sections with a Fade track; whips as a 2 to 4 frame cut blend plus motion blur.
- Story beats as marked frames labelled with their kind.

Tools: `unreal_push_sequence`, `unreal_push_beats`. New CozyClay work: a builder over `buildSequencePrompt` beats and `otioTransition`.

### Cameras (`handoff.cameras`)

- A spawnable CineCameraActor per shot, keyed every frame by default, or reduced to keys at the move's segment boundaries (`moveSegments` in `src/camera-motivation/segments.js`) with tangents fitted to the sampled path, reporting the worst error.
- Filmback, focal length, aperture, focus method and distance, rack focus keys.
- Shutter angle into the shot's Movie Render Queue camera setting.
- Tags: technique stack, size, angle, coverage role, the motivation of each move.

Tool: `unreal_push_cameras`. New CozyClay work: `src/unreal/space.js` and its golden tests; key reduction with a tolerance in centimetres and degrees.

### Cast and motion (`handoff.cast`)

- Phase 0: a stand-in per cast member (UE Mannequin by default), its root keyed from `castAt` (x, z, facing) in the Action sequence, a name label, and a head socket cameras can focus on.
- Phase 2: the motion3 take as an Animation Sequence on the X Bot or Y Bot skeleton, retargeted to Manny or Quinn with an IK Retargeter shipped with the plugin. Take v3 is local quaternions on Mixamo bones plus the hips position (`src/motion3/playback.js`), so this is a writer, not a solver. Container choice is the builder's (FBX, glTF animation, or UsdSkel next to the existing USD camera); record it as a decision.
- Held and carried props attached to the bone that holds them.

Tools: `unreal_push_cast`, `unreal_push_motion`.

### Set and props (`handoff.set`)

- Primitives as Engine basic shapes scaled from CozyClay sizes (the engine cube is 100 cm, so scale equals metres).
- Sculpts and imported meshes as static meshes, imported through Interchange from glTF the bridge writes (sculpt geometry exists in `src/sculpt-csg.js`).
- Groups become attachments; hidden objects arrive hidden; moving props keyed in the Action sequence.
- A per-project asset map so a "sofa" prop or a CozyClay model resolves to a real Unreal asset once art exists.

Tools: `unreal_push_set`, `unreal_map_assets`.

### Look and colour script (`handoff.looks`)

- A lighting rig in the Action sequence: directional key, sky light, exponential height fog, an unbound post process volume.
- Each shot's merged look keyed inside its shot sequence: key colour and intensity, fill as sky light intensity, fog density, exposure compensation, white balance from warmth.
- The intended palette and recipe name stored on the shot for the lighting team.

This is blocking light, not final lighting: a `cold-isolation` shot should read cold in the viewport. The field-to-value mapping is tuned once by eye against the colour script PNG and its numbers live in the repo.

Tool: `unreal_push_looks`.

### Director overlay (`handoff.overlay`)

- The top-down plan as editor-only actors in their own folder and data layer: lines of action as splines, cast marks with shot numbers as decals, walk paths, numbered camera frustums.
- Depth layers per shot as a text card beside the camera.
- The intensity curve as a float curve on a director actor; structure issues (`flat`, `peak-off-beat`, `no-build`) as red marked frames.
- Check flags in a plugin panel; double-clicking one jumps Sequencer to its frames.

Tools: `unreal_push_overlay`, `unreal_clear_overlay`. No new CozyClay work beyond conversion.

### Sync and identity (`handoff.meta`)

- Every Unreal object the bridge makes carries `cozyclay:id`, `cozyclay:scene` and `cozyclay:hash` tags.
- A push compares hashes and changes only what changed. Something edited in Unreal since the last push (hash mismatch) is left alone and reported as a conflict unless the call says `overwrite`.
- `dry_run` returns the plan (create, update, keep, conflict) without touching the level.
- One push is one Unreal undo transaction.

Tools: `unreal_status`, `unreal_sync`, `unreal_diff`.

### Round trip and verification (phase 3)

- Read cameras and shot ranges back after a Sequencer edit, convert through the inverse of `space.js`, and run CozyClay's existing checks on them.
- Render a frame from the Unreal camera beside CozyClay's frame of the same shot with the cast eye points marked.
- Optionally write the edited cameras back into the CozyClay project as a new revision.

Tools: `unreal_pull`, `unreal_check`, `unreal_capture`.

## New MCP tools

Named and shaped like the current catalogue: plain words in, receipts out, read-only tools marked as such, every push taking `from_shot` / `to_shot` like `render_packet`.

| Tool | What it does | Key arguments | Phase |
| --- | --- | --- | --- |
| `unreal_export` | Writes the handoff folder (json, meshes, animation, README). Needs no Unreal. | `path`, range, `modules` | 0 |
| `unreal_status` | Is an editor reachable, its version, the open level, the plugin and its handoff version. Read only. | none | 1 |
| `unreal_sync` | Pushes every module in order: set, cast, cameras, sequence, beats, looks, overlay. One receipt per module. | range, `modules`, `dry_run`, `overwrite`, `level` | 1 |
| `unreal_push_cameras` | CineCameras with lens, focus and capability keys. | range, `keys: "every-frame" \| "reduced"`, `tolerance_cm` | 1 |
| `unreal_push_sequence` | Master, Action and shot sequences, transitions, play rates. | range, `naming` | 1 |
| `unreal_push_beats` | Story beats and structure issues as marked frames. | range | 1 |
| `unreal_push_cast` | Stand-ins and their placement over time. | `stand_in: "capsule" \| "mannequin" \| <asset path>` | 1 |
| `unreal_push_set` | Primitives, sculpts, imported meshes, groups. | `include_hidden` | 1 |
| `unreal_map_assets` | Reads or edits the asset map (CozyClay model or prop to Unreal asset path and forward offset). | `set`, `remove`, `list` | 1 |
| `unreal_diff` | What differs between the CozyClay project and the level, per object and key. Read only. | range | 1 |
| `unreal_push_motion` | Exports the cast's takes and retargets them onto the mapped skeleton. | cast, `retargeter` | 2 |
| `unreal_push_looks` | The lighting rig and per-shot look keys. | range | 2 |
| `unreal_push_overlay` / `unreal_clear_overlay` | The director plan, depth cards, intensity curve, flag panel. | range, `layers` | 2 |
| `unreal_pull` | Reads cameras and shot ranges back into CozyClay space, optionally as a project revision. | range, `apply` | 3 |
| `unreal_check` | CozyClay's checks on the Unreal cameras. Read only. | range, `checks` | 3 |
| `unreal_capture` | A frame from a shot's Unreal camera beside CozyClay's frame. | `shot`, `frame`, `size` | 3 |

The server also exposes the handoff document as an MCP resource (`cozyclay://unreal/handoff?from=1&to=8`), so an agent driving Unreal through another MCP can still read CozyClay's numbers already converted.

## Handoff document, sketched

Same rules as `packet.json`: pure, no clock, fixed rounding, the same project gives the same bytes. Every value is already in Unreal units, so the importer does no math. Trimmed example for a two-shot dialogue:

```json
{
  "kind": "cozyclay.unreal-handoff", "version": 1,
  "source": { "project": "Alley Confession", "scene": "scene-1", "packetVersion": 1 },
  "space": { "units": "cm", "up": "Z", "forward": "X", "from": "cozyclay-y-up-metres" },
  "time": { "displayRate": 24, "tickResolution": 24000, "sceneFrames": [0, 239] },
  "sequence": {
    "master": "SEQ_scene1_Master", "action": "SEQ_scene1_Action",
    "shots": [
      { "id": "shot-a", "name": "SHOT_010", "sceneRange": [0, 96], "editStart": 0,
        "transitionIn": null, "playRate": 1, "camera": "CAM_SHOT_010",
        "coverage": "master", "technique": ["wide", "eye-level", "static"],
        "depthLayers": { "foreground": [], "midground": ["Joon"], "background": ["the floor lamp"] } },
      { "id": "shot-b", "name": "SHOT_020", "sceneRange": [60, 150], "editStart": 97,
        "transitionIn": { "kind": "dissolve", "frames": 8 }, "camera": "CAM_SHOT_020",
        "coverage": "single", "technique": ["close-up", "low-angle", "push-in"] }
    ],
    "beats": [{ "frame": 120, "kind": "reveal", "label": "confession", "shot": "shot-b" }]
  },
  "cameras": [
    { "id": "CAM_SHOT_010", "filmback": { "sensorWidth": 24.89, "sensorHeight": 14.0 },
      "aperture": 2.8, "focus": { "method": "tracking", "actor": "char-b", "socket": "head" },
      "keys": { "frames": [0, 96], "location": [[-412.0, 35.5, 160.0]],
                "rotation": [[-4.2, 171.3, 0.0]], "focalLength": [35, 35] },
      "baked": ["shake"], "shutterAngle": 180 }
  ],
  "cast": [{ "id": "char-b", "letter": "B", "name": "Mara", "standIn": "mannequin",
             "root": { "frames": [0, 239], "location": [], "yaw": [] }, "take": null }],
  "set": [{ "id": "obj-12", "kind": "cube", "name": "Dumpster", "location": [0, 0, 0],
            "rotation": [0, 90, 0], "scale": [1.8, 0.9, 1.2], "parent": null }],
  "looks": [{ "shot": "shot-b", "recipe": "cold-isolation", "keyColor": "#a9c4f0",
              "fogDensity": 0.45, "exposureBias": -0.3, "palette": ["#2c3e50"] }],
  "overlay": { "lines": [], "marks": [], "walks": [], "intensity": [] },
  "flags": [{ "shot": "shot-b", "check": "cuts", "rule": "line-cross", "severity": "warn",
              "frames": [97, 97], "message": "..." }]
}
```

Shot B's scene range overlaps shot A's on purpose: that is coverage, and it is why each shot is its own sequence with the Action sequence inside it. Values in the example are illustrative.

## Phases

- **P0, cameras and timing, offline.** `src/unreal/space.js` with golden tests; the handoff builder for sequence, cameras, beats and stand-in placement; `unreal_export`; the Unreal Python importer run from a menu. Done when a CozyClay coverage scene opens in Unreal as a Master sequence that plays the same cut, and on the first, middle and last frame of every shot each stand-in's head sits within 0.5 px of where CozyClay draws it.
- **P1, live push and safe re-sync.** The `CozyClayBridge` plugin, the Remote Control transport, `unreal_status`, `unreal_sync`, per-module pushes, `unreal_diff`, id tags and hash upsert, the set, the asset map. Done when pushing the same scene twice changes nothing, a camera moved by hand in Unreal survives a re-push as a reported conflict, and one push is one undo.
- **P2, motion, looks and overlay.** Take export and the Mixamo to Manny retarget, sculpt and mesh export, the lighting rig, the overlay and flag panel. Done when a walk-and-talk plays with the mannequins walking their CozyClay paths (ankles within 5 cm), and a colour script measured from Unreal captures shows the same warm and cold cuts as CozyClay's.
- **P3, round trip.** `unreal_pull`, `unreal_check`, `unreal_capture`. Done when crossing the line by hand in Unreal makes `unreal_check` report the same line-cross flag CozyClay raises for that camera.

## Decisions for the owner

Recommended defaults; the builder proceeds on them unless the owner says otherwise.

- **Unreal version floor:** 5.4 or newer (Interchange glTF, IK Retargeter batch API and Movie Render Queue's Python API are stable there). If the team is on one version, target that one first.
- **Camera ownership after handoff:** CozyClay owns them until phase 3. Unreal edits are kept and flagged as conflicts, never silently overwritten.
- **Cast stand-in:** the UE Mannequin with only its root keyed in phase 0; retargeted takes in phase 2.
- **Camera keys:** every frame by default; `keys: "reduced"` on request, with its worst error reported.

## Risks and non-goals

- Roll and handedness are where silent bugs live. The golden projection test is the first work item.
- Remote Control can be off on locked-down machines. Python remote execution is the fallback; the offline folder always works.
- Mixamo rigs retarget to Manny well but not perfectly; fingers and toes need a tuned retargeter, which the plugin ships and a project can replace.
- Clay looks are tuned on clay. The look mapping gets the mood right in a blockout, not a final grade.
- Out of scope: final lighting, render farm setup, MetaHumans, a native Unreal port of CozyClay's director layer, and any change to the existing 39 MCP tools.
