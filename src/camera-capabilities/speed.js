// Shot speed: a shot with speed below 1 samples its take slower than the
// timeline runs (slow motion, as a camera overcranks); above 1, faster. Each
// shot is a window on the take anchored at its first frame, so the take frame
// at timeline frame f is start + (f - start) x speed and the shots around it
// are untouched. The camera itself keeps timeline time: its keys are authored
// there. src/speed-envelope.js shapes speed along a ROUTE (distance over time
// with conserved area); a shot's speed is one constant time factor, so it is
// not an envelope and does not reuse that module.
import { shotAtFrame } from "../cuts.js";

/** The speed a shot plays its take at: 1 unless its camera block says otherwise (stills hold one picture). */
export function shotSpeed(shot) {
	const speed = shot?.camera?.speed;
	return shot && shot.kind !== "still" && Number.isFinite(speed) && speed > 0 ? speed : 1;
}

/** The (fractional) take frame a shot shows at a timeline frame. */
export function retimeFrame(shot, frame) {
	const speed = shotSpeed(shot);
	return speed === 1 ? frame : (shot.startFrame ?? 0) + (frame - (shot.startFrame ?? 0)) * speed;
}

/** The take frame at a timeline frame, through the shot that owns it (a gap plays the take as is). */
export const takeFrameAt = (shots, frame) => retimeFrame(shotAtFrame(shots ?? [], frame), frame);

/** "0.5x" style label for the timeline and the slate; null at normal speed. */
export function speedLabel(shot) {
	const speed = shotSpeed(shot);
	return speed === 1 ? null : `${Number(speed.toFixed(2))}×`;
}
