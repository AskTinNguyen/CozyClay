# Camera Polish

- Rev: 1
- Status: active
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

- D1 (rev 1): Blur sample count follows the sweep. `lensPlan` takes the shutter's angular sweep (yaw, pitch, roll and field of view change, plus position travel as an angle at the focus or a 3 m reference) and uses enough sub-renders that neighbouring copies sit no more than a set fraction of the frame width apart, between the caller's base count and a cap (capture higher than preview). Deterministic: the same frame gives the same plan. Source: orchestrator.
- D2 (rev 1): A dirty OTS is solved, not guessed. `shoulderFraming` keeps the size's lens, puts the target's eyes on the far vertical third, and moves the camera across the foreground character's back until its near shoulder covers about a quarter to a third of the frame width from the near edge. Explicit side and size params keep their meaning. Source: orchestrator.
- D3 (rev 1): Walk bob comes from the baked take. When the mounted character has a v3 take (`hips` per frame), the mount's height and its look-back target rise and fall by the hips' height change from the take's first frame, scaled by the character. With no take it is unchanged. Source: orchestrator; camera-capabilities D4 option (b).
- D4 (rev 1): The owner asked for this follow-up in this session; reserved calls are decided by the orchestrator on the recommended option and recorded. Source: L-1.

## Acceptance

- A1: Whip-pan blur without banding. Proof: gate: a verify file asserting the plan's sample count scales with the sweep (a whip pan gets more sub-renders than a slow pan, capped; a held camera keeps its base count), neighbouring copies sit at most the set fraction of the frame apart for a whip pan at capture, and the plan is identical on two calls; plus ui:shot, a whip-pan capture with 180° shutter showing a smooth smear, next to the old banded proof.
- A2: Dirty OTS. Proof: gate: a verify file projecting the framing: the target's eyes within tolerance of the far vertical third and on the upper third line, the foreground character's near shoulder covering 20–38% of the frame width from the near edge, for both sides, two lenses and two speaker distances; `camera.cover` shot-reverse-shot still has zero cut flags; plus ui:shot, a shot-reverse-shot contact sheet through the lens.
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

## Changelog

- rev 1 (2026-10-24): created from the camera library's residual risks at the owner's request.
