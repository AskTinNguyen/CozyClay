// The Studio's side of the colour script (colour-script A2, A3): each shot's
// palette measured from its middle frame, rendered through the export path
// (renderFrameBuffer: rows bottom-up, which the palette does not mind), and
// the colour script drawn to a PNG (packet/colour-script.png and File > Export
// > Colour script). The measuring and the drawing are pure (palette.js,
// image.js); this file only renders and encodes.
import { colourScriptImage } from "./image.js";
import { measurePalette } from "./palette.js";

/** The palette of one rendered frame buffer ({ data, width, height }). */
export const measureFrame = (image) => measurePalette(image.data, image.width, image.height);

/** The colour script as PNG bytes, drawn on a canvas. */
export function colourScriptPng(script) {
	const image = colourScriptImage(script), canvas = document.createElement("canvas");
	canvas.width = image.width;
	canvas.height = image.height;
	const ctx = canvas.getContext("2d"), pixels = ctx.createImageData(image.width, image.height);
	pixels.data.set(image.data);
	ctx.putImageData(pixels, 0, 0);
	const binary = atob(canvas.toDataURL("image/png").split(",")[1]);
	return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}
