# Sculpt objects: a clay prop from one reference image

STATUS: implemented (#730); live QA: `mcp/qa-sculpt-live.mjs`

An agent looks at a reference image, breaks the subject into a handful of soft clay parts, and stands the result in the set as one object. The object is **data, not code**: a `sculpt` record carries a recipe of parts, and CozyClay builds the geometry from it. Nothing the agent writes is executed.

This is the previs-sized version of the img2threejs loop. Two runs (a chibi turtle in glasses and a sea-stack diorama) showed where the time goes: 70% of it went to camera fitting and to working around a code generator. A recipe that the editor renders directly removes both.

```mermaid
flowchart LR
  I[Reference image] --> A[Agent: parts, proportions, colours]
  A --> R[Recipe JSON]
  R --> T[sculpt_object / object.sculpt]
  T --> S[sculpt object in the scene]
  S --> C[compare_sculpt<br/>IoU + overlay sheet]
  C -->|edits on the parts that miss| T
```

## Why a recipe and not a baked GLB

| | Bake a GLB, then `import_mesh` | `sculpt` recipe |
|---|---|---|
| Memory-only MCP | No: needs a live editor | Yes |
| Project export | Bytes live in IndexedDB and are lost | Inside the scene JSON |
| Agent edits | Rebake the whole model | Patch one part |
| Safety | File parsing | Plain data, validated |

## Recipe contract (v1)

```json
{
  "version": 1,
  "parts": [
    { "id": "head", "shape": "blob", "size": [1.5, 0.84, 1.1], "roundness": 0.6,
      "position": [0, 1.55, 0.03], "rotation": [0, 20, -6], "color": "#4a8e9c" },
    { "id": "eye", "shape": "blob", "size": [0.44, 0.36, 0.3], "parent": "head",
      "position": [0.38, 0.1, 0.48], "color": "#ece8ec", "mirror": true },
    { "id": "rim", "shape": "frame", "size": [0.76, 0.42, 0.07], "border": 0.09, "parent": "head",
      "position": [0.41, 0.1, 0.68], "color": "#240405", "mirror": true }
  ]
}
```

Units are metres, angles are degrees, the floor is `y = 0`, front is `+z`, and the subject's own left is `+x`.

| Field | Meaning |
|---|---|
| `id` | Unique part name, `a-z 0-9 -`. |
| `shape` | `blob`, `box`, `cylinder`, `torus` or `frame`. |
| `size` | Full extents `[x, y, z]`. A torus reads `[outer diameter, outer diameter, tube diameter]`. |
| `roundness` | `blob`: 0 is an ellipsoid and 1 is a rounded box. `box`: the edge bevel as a fraction of the smallest side. |
| `taper` | `blob`, `cylinder`: −1 to 1. Positive values narrow the top and negative values narrow the bottom. A cylinder with taper 1 is a cone. |
| `border` | `frame`: the rim width in metres. A frame is a rectangular ring, like a glasses rim, a window or a picture frame. |
| `position`, `rotation` | Measured in the parent's frame when `parent` is set, otherwise in the object's frame. |
| `parent` | Another part's id. The part rides that part's position and rotation. |
| `mirror` | `true` adds a reflected copy across `x = 0` of the parent frame. This is a reflection and never a rotation. |
| `color` | `#rrggbb` clay colour. |

Limits: at most 48 parts after mirroring, each extent between 0.005 and 20 m, and parent chains at most 8 deep. A recipe that breaks a limit is refused with the reason. It is never clamped into a different shape.

The record stores the normalized recipe, plus `footprint` and `height` measured from the parts' bounds, so the plan board, the drop logic and the selection cage work without building geometry.

## Editing and comparing

- **Patch, don't resend.** `sculpt_object { id, edits }` (Studio: `object.sculpt`) applies `{ set: partId, ...fields }`, `{ add: part }` and `{ remove: partId }` in order. `parent: null` and `mirror: false` clear those fields, and `remove` also takes the part's children. Changing `shape` drops the old shape's options. The patched recipe is validated as a whole, and the receipt names the parts that changed.
- **Compare against the reference.** `compare_sculpt { id, reference: "<png|jpg path>", yaw?, elevation? }` runs on this machine without an editor. It turns the reference's subject into a mask: alpha when the image has transparency, otherwise everything that differs from the border colour. It draws the sculpt's silhouette orthographically from the view, fits it to the subject's height, top and best horizontal offset, and returns:
  - `iou`, `missingFraction`, `extraFraction`
  - `widthToHeight` (reference vs sculpt)
  - `missingByBand` (top, middle, bottom thirds: where to add)
  - `extraByPart` (which parts stick out)
  - a sheet: the reference beside an overlay (grey = both, red = missing, blue = extra)

  Leaving out `yaw` tries −45° to 45° and keeps the best. Only shape is scored, not colour.
- **One round, one call.** `sculpt_object { …, capture: true }` returns the editor frame with the receipt when an editor is connected.

## Agent workflow (image → sculpt)

1. **Read the image before writing anything.** Name the subject, the parts and their contact relationships. List the 3–5 features that make the subject recognizable (for the turtle: oversized glasses, bulging eyes, the buck tooth, the belly plate). Say which sides the image hides.
2. **Block out in 4–8 parts.** Get the silhouette and the proportions right first. Measure in head units from the image and do not guess from a stock figure.
3. **Place it, then measure.** Call `sculpt_object`, then `compare_sculpt` with the reference path. Read `missingByBand` and `extraByPart` before you look at the sheet.
4. **Patch, don't rewrite.** Send `edits` that fix the biggest mismatch first: proportion, then placement, then colour. Allow three rounds at most, or stop once IoU stops rising, then report what still differs.
5. **Identity details last.** Add eyes, rims and plates as small parts on a parent once the body reads.

Ask, infer and omit follow `agent-prompt-to-scene.md`. Infer the hidden back and say so. Never ask for more views unless the user wants a likeness.

## Plan

| Step | Deliverable |
|---|---|
| 1 | `src/sculpt-recipe.js`: normalize, validate and measure bounds. Pure, with node tests. |
| 2 | `src/sculpt-geometry.js`: recipe to three.js Group (blob = superellipsoid radial remap). |
| 3 | `sculpt` kind: create, normalize, duplicate, serialize, render, hierarchy and inspector. |
| 4 | Studio action `object.sculpt` and MCP `sculpt_object`, in live and memory mode. |
| 5 | Agent rules (this page) in the MCP tool description and the Studio prompt. |
| 6 | QA: the turtle recipe through MCP into a live editor, with a screenshot in the PR. |
| 7 | Part-level `edits`, `compare_sculpt` (reference mask, silhouette IoU, overlay sheet), `capture: true`. |

Out of scope, for follow-ups: saving a sculpt to the asset shelf, per-part editing gizmos, and textures.
