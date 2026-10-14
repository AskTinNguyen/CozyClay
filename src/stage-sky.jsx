import { useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { stageLook } from "./stage-lighting.js";

// Rows of the equirectangular gradient: v runs from straight down (0) through
// the horizon (0.5) to straight up (1).
const SKY_ROWS = 128;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** A sky that grades from `bottom` at the horizon (and below it) to `top`
 * overhead, eased so most of the change happens in the lower 60 degrees a shot
 * camera actually sees. Built once per look as an sRGB equirectangular texture;
 * three draws it as the background in the same pass as the scene. */
function gradientSky(bottom, top) {
	const [from, to] = [rgb(bottom), rgb(top)];
	const data = new Uint8Array(SKY_ROWS * 4);
	for (let row = 0; row < SKY_ROWS; row++) {
		const elevation = ((row + 0.5) / SKY_ROWS - 0.5) * 180;
		const t = elevation <= 0 ? 0 : 1 - (1 - Math.min(1, elevation / 60)) ** 2;
		for (let channel = 0; channel < 3; channel++) data[row * 4 + channel] = Math.round(from[channel] + (to[channel] - from[channel]) * t);
		data[row * 4 + 3] = 255;
	}
	const texture = new THREE.DataTexture(data, 1, SKY_ROWS);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.mapping = THREE.EquirectangularReflectionMapping;
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearFilter;
	texture.needsUpdate = true;
	return texture;
}

/**
 * The stage's sky, fog and exposure (stage.lighting through stageLook), set on
 * the one scene and renderer every path draws with: the viewport panes, the
 * shot preview card, capture_frame, contact sheets and video export
 * (stage-capture.jsx). Nothing here is a post-process; it is all the same pass.
 *
 * The open stage runs 500 m; without a falloff the whole deck reads at once and
 * the horizon sits a kilometre away. The fog fades the floor INTO the sky colour,
 * so past its far distance the deck simply ceases to exist with no horizon line,
 * no clip edge and no tone break. Haze (stage.lighting.fog) pulls that fade in.
 *
 * Perspective cameras see the gradient sky when skyTop is set; orthographic ones
 * (the plan) keep the flat horizon colour, since a box-mapped sky has no meaning
 * looking straight down. A caller that swaps the background for a pass of its
 * own (render-passes.js) is left alone.
 */
export function StageAtmosphere({ lighting = null, keyLight, theme = "dark", grid = false }) {
	// The scene and renderer are read inside the effects: they are three objects
	// this component configures, not React state.
	const get = useThree((state) => state.get), invalidate = useThree((state) => state.invalidate);
	const look = stageLook({ lighting, keyLight, theme, grid });
	const { sky, skyTop, exposure } = look, { near, far } = look.fog;
	const hazeNear = look.captureFog?.near ?? null, hazeFar = look.captureFog?.far ?? null;
	useLayoutEffect(() => {
		const { scene } = get();
		const flat = new THREE.Color(sky);
		const gradient = skyTop ? gradientSky(sky, skyTop) : null;
		scene.background = flat;
		scene.fog = new THREE.Fog(sky, near, far);
		scene.onBeforeRender = (_renderer, _scene, camera) => {
			if (scene.background === flat || scene.background === gradient) scene.background = gradient && camera.isPerspectiveCamera ? gradient : flat;
		};
		invalidate();
		return () => {
			scene.onBeforeRender = () => {};
			gradient?.dispose();
		};
	}, [get, invalidate, sky, skyTop, near, far]);
	useLayoutEffect(() => {
		// The viewport applies exposure in tone mapping. Exports render into a
		// target, which three never tone-maps, so CaptureRig reads it from here
		// and scales the lights for its draw instead (same pass, same scene).
		const { scene, gl } = get();
		gl.toneMappingExposure = exposure;
		scene.userData.stageCapture = { exposure, fog: hazeNear === null ? null : { near: hazeNear, far: hazeFar } };
		invalidate();
	}, [get, invalidate, exposure, hazeNear, hazeFar]);
	return null;
}
