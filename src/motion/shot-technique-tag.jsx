import { currentTechnique } from "../camera-techniques/storage.js";

/** The camera technique stack a Shot block carries ("LOW · PUSH-IN · 35mm"),
 * shown only while it still describes the shot's camera. */
export default function ShotTechniqueTag({ shot }) {
	const technique = currentTechnique(shot);
	return technique ? <span className="tl-shot-technique" data-shot-technique={technique.label} title={technique.phrase}> · {technique.label}</span> : null;
}
