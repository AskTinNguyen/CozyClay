// The key light's colour from its warm/cool slider (room.jsx StageLights, and
// an export frame relit by stage-shot-look-draw.js). 0.5 is the tuned default
// (neutral white, so the grey set and the grey clay stay grey); 0 pulls toward
// cool daylight, 1 toward sunset amber.
import * as THREE from "three";

export function keyLightColor(warmth = 0.5) {
	const w = Math.max(0, Math.min(1, warmth ?? 0.5));
	const base = new THREE.Color("#ffffff");
	if (w < 0.5) return base.clone().lerp(new THREE.Color("#e8f0ff"), (0.5 - w) * 2).getStyle();
	if (w > 0.5) return base.clone().lerp(new THREE.Color("#ffc27a"), (w - 0.5) * 2).getStyle();
	return "#ffffff";
}
