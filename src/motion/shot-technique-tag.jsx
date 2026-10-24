import { currentTechnique } from "../camera-techniques/storage.js";
import { speedLabel } from "../camera-capabilities/speed.js";
// Cut flags (camera-coverage) ride the Shots lane beside the rig keys.
export { CutFlagMarks } from "./cut-flags.jsx";
export { MotivationMarks } from "./motivation-marks.jsx";

/** The camera technique stack a Shot block carries ("LOW · PUSH-IN · 35mm"),
 * shown only while it still describes the shot's camera, then the shot's
 * speed when it is not 1 ("0.5×": slow motion). */
export default function ShotTechniqueTag({ shot }) {
	const technique = currentTechnique(shot), speed = speedLabel(shot);
	return (<>
		{technique ? <span className="tl-shot-technique" data-shot-technique={technique.label} title={technique.phrase}> · {technique.label}</span> : null}
		{speed ? <span className="tl-shot-technique" data-shot-speed={speed} title="Shot speed: the take plays at this rate"> · {speed}</span> : null}
	</>);
}

/** The roll and focus rig keys of a shot as timeline marks: { frame, title } in absolute frames (camera-capabilities). */
export function RigKeyMarks({ shots, framePct, frameCount }) {
	return shots.flatMap((shot) => (shot.camera?.rigKeys ?? []).map((key) => {
		const frame = shot.startFrame + key.offset, parts = [Number.isFinite(key.rollDeg) ? `roll ${key.rollDeg}°` : null, key.focus ? `focus ${key.focus.targetId ?? `${key.focus.distance} m`}` : null].filter(Boolean);
		return <span key={`${shot.id}:rig:${key.offset}`} className="tl-marker rig" data-rig-key={frame} style={{ "--tl-f": framePct(frame, frameCount) }} title={`Rig key at frame ${frame}: ${parts.join(", ")}`} />;
	}));
}
