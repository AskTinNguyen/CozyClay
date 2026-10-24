# Camera Polish

- Rev: 2
- Status: completed
- Area: Camera and Shots
- Owner: TinNguyen
- Skill: `none`
- Branch: `intent/camera-polish`
- Worktree: `../CozyClay-wt/camera-polish`, port slot n=6 (dev 5206, live hub 5306, CDP 9306)
- Started: 2026-10-24

## Goal

Three rough edges the camera library closed with (camera-capabilities and camera-coverage residual risks):

- **Whip-pan blur banding.** `lensPlan` spreads a fixed number of sub-renders (8 preview, 24 capture) evenly over the open shutter. A whip pan sweeps tens of degrees in one shutter, so the copies sit several percent of the frame apart and read as bands.
- **Over-the-shoulder shows a sliver.** `shoulderFraming` puts the camera 0.55 m behind and 0.36 m beside the foreground character and aims at the target's centre, so on a 50mm lens the shoulder lands at the frame edge and OTS reads as a clean single.
- **The snorricam has no walk bob.** `mountedPose` takes the bone height from proportions and the placement from the root path, so the rig glides level while the body it is bolted to bobs.

## Non-Goals

- A velocity-buffer blur or a post-process blur; the accumulation lens stays (one lens for preview, captures and exports).
- Per-bone mount tracking from the full skeleton (chest rotation, lean); only the hips' vertical travel is added.
- New techniques or coverage patterns.

## Decisions

- D1 (rev 1): Blur follows the sweep, and each sub-render is smeared over its own step. `lensPlan` measures the shutter's sweep as a share of the frame (pan and tilt angle over the field of view, zoom as the field of view change, position travel as an angle at the focus or a 3 m reference) and uses enough sub-renders for a set step, between the caller's base count and a cap (preview 32, capture 96). Each sub-render also carries its screen step (pan and tilt between it and its neighbour), and the accumulate pass averages taps along that step, so the copies join into one streak even at the cap. Deterministic: the same frame gives the same plan. Source: orchestrator.
- D2 (rev 1): A dirty OTS is solved, not guessed. `shoulderFraming` keeps the size's lens, puts the target's eyes on the far vertical third, and moves the camera across the foreground character's back until its near shoulder covers about a quarter to a third of the frame width from the near edge. Explicit side and size params keep their meaning. Source: orchestrator.
- D3 (rev 1): Walk bob comes from the baked take. When the mounted character has a v3 take (`hips` per frame), the mount's height and its look-back target rise and fall by the hips' height change from the take's first frame, scaled by the character. With no take it is unchanged. Source: orchestrator; camera-capabilities D4 option (b).
- D5 (rev 2, from F-1): A mount on a take v3 rides the body the take moves: the hips' path and heading under the character's placement (as `bakeTake` stored them), averaged over one stride (±20 frames, a centred window) so the pelvis's sway and twist stay out while turns come through; the hips' rise stays per frame (the bob). Source: orchestrator under D4.
- D6 (rev 2, from F-2): The dirty OTS aims for 36 % cover of its modelled shoulder edge (0.23 m off the axis at 82 % of stature), which renders as about a quarter of the frame on the studio's rigs; A2 checks 25–40 % of the modelled edge. Source: orchestrator under D4.
- D4 (rev 1): The owner asked for this follow-up in this session; reserved calls are decided by the orchestrator on the recommended option and recorded. Source: L-1.

## Acceptance

- A1: Whip-pan blur without banding. Proof: gate: a verify file asserting the plan's sample count scales with the sweep (a whip pan gets more sub-renders than a slow pan, capped; a held camera keeps its base count), each sub-render's smear equals the step to its neighbour so the smeared copies tile the sweep without gaps, a held camera has no smear, and the plan is identical on two calls; plus ui:shot, a whip-pan capture with 180° shutter showing a smooth smear, next to the old banded proof.
- A2: Dirty OTS. Proof: gate: a verify file projecting the framing: the target's eyes within tolerance of the far vertical third and on the upper third line, the foreground character's modelled near shoulder covering 25–40% of the frame width from the near edge (D6), for both sides, two lenses and two speaker distances; `camera.cover` shot-reverse-shot still has zero cut flags; plus ui:shot, a shot-reverse-shot contact sheet through the lens.
- A3: Snorricam walk bob. Proof: gate: a verify file with a take whose hips bob: the mounted camera's height follows the hips' change within 1 mm per frame, the face's screen position stays fixed within tolerance, and a take without hips data leaves the mount as before; plus ui:shot, two frames of a walking snorricam at the top and bottom of a step, with the horizon visibly shifted.
- A4: Readbacks and words stay true: the technique receipts (`camera.applyTechnique` for over-the-shoulder and snorricam) and the existing camera verify files pass. Proof: gate: the camera-techniques, camera-capabilities and camera-coverage verify files.
- A5: The repository gates hold. Proof: gate: `npm run lint` (no baseline raised), `npm run build`, `node tools/run-tests.mjs --jobs 4` from Git Bash with no dev server running, under the contract's known exception.
- A6: Docs: `CHANGELOG.md` Unreleased; the residual-risk lines in camera-capabilities and camera-coverage point here. Proof: review.

## Constraints

- `CLAUDE.md`: the 250-line ratchet, knip and eslint baselines; new files stay under 250 lines.
- Edits go through the command bus; never write domain stores directly.
- Do not change the frozen motion files.
- Keep the owner's own studio on ports 5180 / 5184 untouched; use slot n=6.
- Keep the branch merged with `origin/main` and pushed after every step (contract, Git And Merge).

## Reviews

Orchestrator review of the ui:shot images and the docs, branch `intent/camera-polish`, 2026-10-24.

| Item | Image or file | What it shows | Verdict |
| --- | --- | --- | --- |
| A1 | `proofs/whip-pan-blur-before.png`, `proofs/whip-pan-blur-after.png` | The same whip pan (270° shutter) from `test/qa-camera-capabilities-live-browser.mjs`. Before: dozens of hard vertical stripes through the pillars and the figure. After: one continuous horizontal smear, no stripes. | met |
| A2 | `proofs/ots-mara.png`, `proofs/ots-joon.png` | Live shot-reverse-shot. Over Mara: her head and shoulder fill the left quarter, Joon on the right third, eyes near the upper third line. Over Joon: his head and shoulder fill about the right third, Mara on the left third. A dirty OTS on both sides. | met |
| A3 | `proofs/snorricam-bob-f103.png`, `proofs/snorricam-bob-f113.png` | Chest-mounted camera looking back at Mara mid-walk, the lowest and highest hips of a step (2.1 cm apart). The head holds its place within about 7 px; the pillars behind shift a few pixels. The bob is real and subtle at 2 cm, as a chest rig on a walk is. | met |
| A6 | `CHANGELOG.md`, camera-capabilities and camera-coverage prompt residual-risk lines | Unreleased › Camera entry; both residual-risk lines point here. | met |

PR review (Codex, one P2 on a4fd1193) fixed in 2d42e7e5: the smear's pitch component had the wrong sign, so a diagonal pan-and-tilt smeared along the opposite diagonal; the conversion is now `smearUv` (lens-plan.js) and `verify-camera-blur-sweep` checks pan, tilt and both diagonals against `projectPoint` (`6 checks passed`). Lint and build exit 0 after the fix; the whip-pan proof is a pure pan and unchanged. Thread replied to and resolved.

Residual risks recorded at close: the head bone's own motion (nod, counter-sway) is not tracked, so the face drifts a few pixels in frame on a walk; the stride window (±20 frames) assumes a walking stride and softens very fast turns; the OTS shoulder share is modelled from a fixed shoulder width (0.23 m), so rigs with other proportions read a little more or less shoulder; blur sub-renders cap at 96, so extreme whips rely on the smear.

## Changelog

- rev 1 (2026-10-24): created from the camera library's residual risks at the owner's request.
- rev 1 (2026-10-24): D1 and A1 name the per-sub-render smear before any code (the cap alone leaves gaps on a fast whip).
- rev 2 (2026-10-24): F-1 accepted as D5, F-2 as D6 (A2 range).
- rev 2 (2026-10-24): completed. Every Acceptance row met with review; the PR review finding fixed; PR #9 squash-merged.
