// The packet's intensity picture (director-packet A3, once intensity-curve
// landed): the intensity strip (intensity-curve/strip.js) over the packet's
// range, its frames counted from the range's first frame so the range fills
// the strip, with the story beats as ticks and the structure issues as bands.
// Pure: answers RGBA rows top-down; the Studio encodes the PNG.
import { stripImage } from "../intensity-curve/strip.js";

/** { data, width, height } for packet.intensity, or null when the packet has no intensity section. */
export function intensityStrip(packet) {
	const section = packet.intensity;
	if (!section?.shots?.length) return null;
	const start = section.shots[0].startFrame, shift = (frame) => frame - start;
	const curve = { shots: section.shots.map((row) => ({ ...row, startFrame: shift(row.startFrame), endFrame: shift(row.endFrame) })) };
	const image = stripImage(curve, { frameCount: shift(section.shots.at(-1).endFrame) + 1, components: ["size", "focal", "speed"],
		beats: section.beats.map((beat) => ({ ...beat, frame: shift(beat.frame) })), issues: section.issues.map((issue) => ({ ...issue, frames: issue.frames.map(shift) })) });
	return { data: image.data, width: image.width, height: image.height };
}
