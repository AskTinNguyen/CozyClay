// Shot looks on screen and in exports (colour-script A1). The preview reads
// the look at the playhead (useShotLook: the stage's own values while no shot
// has a look, so a stage saved earlier renders as before); StageAtmosphere
// leaves a hook on the scene so an export frame can be lit as ITS shot looks
// (applyShotLookForDraw, called by stage-capture.jsx around each render): the
// lights StageLights tagged (userData.stageLight), the background, the fog
// colour and the capture's exposure and haze are set from that frame's look for
// the draw and put back after. The environment map and the occlusion pass stay
// those of the look on screen; their strength follows the frame's look.
import { useMemo } from "react";
import * as THREE from "three";
import { createKeyLight, stageLook } from "./stage-lighting.js";
import { currentDrawShots, shotLookAt, shotLookKey } from "./stage-shot-look.js";
import { playbackFrame, usePlaybackSnapshot } from "./motion/playback-frame-store.js";

/** The stage { lighting, keyLight, key } at the playhead: re-read only when the look in play changes. */
export function useShotLook(lighting, keyLight, shots) {
	const key = usePlaybackSnapshot(() => shotLookKey(shots, playbackFrame()));
	return useMemo(() => ({ ...shotLookAt({ lighting, keyLight }, shots, playbackFrame()), key }), [lighting, keyLight, shots, key]);
}

const noop = () => {};
/** What a look lights with, as one comparable string. */
export const lookSignature = ({ lighting, keyLight }) => JSON.stringify([lighting ?? null, keyLight ?? null]);

/**
 * Light the scene as the export frame's shot look for one draw.
 * scene.userData.shotLook: { at(frame, shots?) -> shotLookAt's answer, frameRef, shown (lookSignature of the look on screen), theme, grid, keyColor(keyLight), sky(bottom, top) }
 * @returns {() => void} puts every value back
 */
export function applyShotLookForDraw(scene) {
	const hook = scene?.userData?.shotLook;
	if (!hook?.frameRef) return noop;
	// The look on screen can lag the document (the 3D tree renders after the DOM), so the look is compared, not its shot.
	const target = hook.at(hook.frameRef.current, currentDrawShots());
	if (lookSignature(target) === hook.shown) return noop;
	const look = stageLook({ lighting: target.lighting, keyLight: target.keyLight, theme: hook.theme, grid: hook.grid }), key = createKeyLight(target.keyLight);
	const undo = [];
	const keep = (object, field) => { const value = object[field]; undo.push(() => { object[field] = value; }); };
	const keepColor = (color) => { const copy = color.clone(); undo.push(() => color.copy(copy)); };
	const SET = {
		hemi: (node) => { keepColor(node.color); keepColor(node.groundColor); keep(node, "intensity"); node.color.set(look.hemi.sky); node.groundColor.set(look.hemi.ground); node.intensity = look.hemi.intensity; },
		ambient: (node) => { keep(node, "intensity"); node.intensity = look.ambient; },
		key: (node) => {
			keepColor(node.color); keep(node, "intensity");
			const position = node.position.clone(), shadow = { radius: node.shadow.radius, normalBias: node.shadow.normalBias };
			undo.push(() => { node.position.copy(position); Object.assign(node.shadow, shadow); node.updateMatrixWorld(); });
			node.color.set(hook.keyColor(key)); node.intensity = key.intensity; node.position.set(key.x, key.y, key.z); node.updateMatrixWorld();
			Object.assign(node.shadow, { radius: look.shadowRadius, normalBias: look.shadowNormalBias });
		},
		fill: (node) => { keep(node, "intensity"); node.intensity = look.fill; },
		rim: (node) => { keep(node, "intensity"); node.intensity = look.rim; },
	};
	scene.traverse((node) => SET[node.userData?.stageLight]?.(node));
	// The backdrop: a flat sky or its gradient (an HDR backdrop stays as it is).
	if (!scene.userData.stageCapture?.backdrop) {
		keep(scene, "background");
		const gradient = look.skyTop ? hook.sky(look.sky, look.skyTop) : null;
		scene.background = gradient ?? new THREE.Color(look.sky);
		if (gradient) undo.push(() => gradient.dispose());
	}
	if (scene.fog) { keepColor(scene.fog.color); scene.fog.color.set(look.fog.color); }
	keep(scene.userData, "stageCapture");
	scene.userData.stageCapture = { ...scene.userData.stageCapture, exposure: look.exposure, fog: look.captureFog };
	if (!look.hdr) { keep(scene, "environmentIntensity"); scene.environmentIntensity = look.envIntensity; }
	return () => { for (const step of undo.reverse()) step(); };
}
