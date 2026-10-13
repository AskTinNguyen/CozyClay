# Motion in CozyClay 3: how the agent authors it

The agent writes a **motion spec**. The deterministic compiler bakes every frame on the real rig (X Bot or Y Bot), and QA measures the result. The agent edits the keys and compiles again until QA reports nothing. The loop is cheap: about 20 ms to compile and 7 ms to run QA per 200 frames, so iterate freely, normally inside one `script` call.

## Loop

1. Read the scene with `inspect_studio`: object ids, positions (base pivot = bottom centre), sizes, the character (`model`, `x/y/z`, `rot`).
2. Plan the beats with frame ranges at 24 fps, and write keys for the key poses only.
3. `run_action motion.compile { characterId, spec, install: false }`. Read `output.qa.groups`.
4. Fix the largest group first, change the keys, and compile again. Repeat until `qa.ok`.
5. `motion.compile` with `install: true`. Then do one `verify_result` contact sheet as a visual check.
6. Report the QA numbers, what was declared in `checks`, and anything that was not checked.

## Conventions

- World metres, +Y up, floor at y = 0.
- yaw 0 faces +Z; positive yaw turns toward +X. At yaw 0 the character's left is +X.
- `root` is the hips joint. Standing hips height is about 1.03 m on the X Bot and 0.99 m on the Y Bot. Ankles stand 0.087 m above the floor.
- Body-frame vectors (knee/elbow poles, `body` anchors) are rotated by the root yaw only.

## Channels (keys: `[{ f, set: { channel: value }, step?: [channel] }]`)

A channel is interpolated (monotone cubic) only through the keys that set it, so re-key a value to hold it. A `step` key jumps exactly on its frame; use it for visibility switches.

| Channel | Meaning |
|---|---|
| `root [x,y,z]`, `yaw`, `pitch`, `roll` | Hips position and body turn |
| `spine_yaw/pitch/roll`, `head_yaw/pitch/roll` | Spread over the chain; pitch + bends forward |
| `foot_l/r [x,y,z]`, `fyaw_l/r`, `fpitch_l/r` | Ankle target, foot heading, toe-down pitch (the toes stay flat) |
| `knee_l/r [x,y,z]` | Body-frame knee direction (default forward) |
| `armw_l/r` | 0 = FK arm (`aswing`, `abend`), 1 = IK to the hand target |
| `hand_l/r [x,y,z]` | World wrist target |
| `w_<anchor>_l/r` | Weight that pulls the hand target to a named anchor (weights add up; the rest is `hand_*`) |
| `elbow_l/r [x,y,z]` | Body-frame elbow direction |
| `wtwist_l/r`, `wflex_l/r` | Wrist twist and flex in degrees (clamped to ±85 and ±70) |
| `fingers_l/r { relaxed, fist, grip, cigarette, point }` | Preset weights over relaxed |

## Anchors, props and fits

- Anchors are where a hand goes:
  - `world` — fixed point
  - `body` — relative to the root, turns with the yaw
  - `bone` — offset from a joint
  - `segment` — a point along a bone; with `reach`, it slides until the arm reaches
  - `object` — a point fixed to a scene object, including a hinged door
  - `landmark mouth` — the measured face point
  - `prop` — a point on a prop held by the other hand, plus an optional world `offset` (e.g. 2 cm under the cigarette tip)
- Props are points carried by a hand, given along the palm axes [finger d, knuckle line l, palm normal n].
- Fits move the wrist until an effector (a prop point or fingertips) sits exactly on an anchor while that anchor's weight is on. For example: the cigarette filter on the mouth, or the flame under the cigarette tip.
- Objects: `objects: { id: { pivot, axis, channel } }` hinges a scene object by a keyed angle channel. Use it for doors.

## Generators

`{ type: "walk", f0, steps, step, heading: [h0, h1], turnDistance, halfWidth, lift }` plans footsteps from the pose the keys leave at `f0`. The walk includes weight shift, pelvis bob and twist, toe-off, arm swing, and the feet together at the end.

## QA

Every take gets these checks:

- Body capsules against scene boxes, and ground contact
- IK reach
- Planted-foot slide
- Bone length
- Speed and pops
- Knee and elbow flips, knee hyper-extension
- Hands and props entering the head or the torso, and the two hands overlapping
- Hinged objects (`objects`, e.g. a door) passing through other scene boxes
- Balance, and self contact

Declare the task-specific checks in `spec.checks`:

- `contacts` — a point on a target within a tolerance, e.g. fingers on the handle, filter on the lips
- `orient` — a direction against `face`, `up` or a vector, e.g. the lit end points away from the face
- `below` — a joint lower than another, e.g. no chicken-wing elbow
- `clearance` — a body part keeps a distance from an object
- `appear` — a visibility switch happens with the hand at a pocket
- `supports` — frames where the hips rest on a seat skip balance
- `allow` — soft contact depth allowances, e.g. thighs on a seat cushion

Pass these numbers to the user as they are. QA proxies are capsules, boxes and an ellipsoid, not the skin.
