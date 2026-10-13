// Planted-foot lock: while a heel or ball is planted (QA's own definition) and drifts less than
// 1 cm, the ankle target is shifted so the planted point stays where it landed. The foot pose
// depends only on the ankle target, fyaw and fpitch, so the shift moves the sole rigidly.
import { add, sub } from "../compiler/math.js";
import { QA_LIMITS } from "../qa/checks.js";
import { solePoints } from "../qa/geometry.js";
import { round4 } from "./ease.js";

const MAX_DRIFT = 0.01, DECAY = 4;

export function lockFeet(out, engine) {
	const { sk } = out.ctx, n = out.frames.length, H = QA_LIMITS.plantH;
	let plants = 0, worst = 0;
	const touched = new Set();
	for (const [k, S] of [["l", "Left"], ["r", "Right"]]) {
		const ch = out.baked[`foot_${k}`];
		if (!ch) continue;
		const sole = out.frames.map(fr => solePoints(sk, fr.s, S));
		const planted = (i, key) => sole[i][key][1] < H && sole[i - 1][key][1] < H && Math.abs(sole[i][key][1] - sole[i - 1][key][1]) < 0.0005;
		const delta = Array.from({ length: n }, () => null);
		for (let i = 1; i < n;) {
			if (!planted(i, "ball") && !planted(i, "heel")) { i++; continue; }
			// one contact run: the ball wins over the heel; a switch re-anchors on the new point
			let key = null, ref = null, j = i, max = 0, last = [0, 0, 0];
			const run = [];
			for (; j < n && (planted(j, "ball") || planted(j, "heel")); j++) {
				const kj = planted(j, "ball") ? "ball" : "heel";
				// on a switch the new point is anchored where the previous frame's shift put it
				if (kj !== key) { key = kj; ref = add(sole[j - 1][key], last); }
				const d = sub(ref, sole[j][key]); d[1] = 0;
				last = d;
				run.push([j, d]);
				max = Math.max(max, Math.hypot(d[0], d[2]));
			}
			if (max > 2e-4 && max < MAX_DRIFT) {
				plants++; worst = Math.max(worst, max);
				for (const [jj, d] of run) delta[jj] = d;
				for (let m = 1; m <= DECAY && j - 1 + m < n; m++) {
					if (delta[j - 1 + m]) break;
					const t = m / (DECAY + 1), e = 1 - t * t * (3 - 2 * t);
					delta[j - 1 + m] = [last[0] * e, 0, last[2] * e];
				}
			}
			i = j;
		}
		for (let i = 0; i < n; i++) {
			if (!delta[i]) continue;
			const f = out.f0 + i;
			ch[f] = add(ch[f], delta[i]);
			touched.add(f);
		}
	}
	if (!plants) return null;
	engine.solve([...touched]);
	return { plants, frames: touched.size, max: round4(worst), how: "planted heel/ball held in place" };
}
