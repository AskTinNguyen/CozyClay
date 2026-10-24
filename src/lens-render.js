// The shot camera's lens, drawn: depth of field and motion blur as an
// accumulation of sub-renders (camera-capabilities/lens-plan.js), averaged in
// linear light and written to the screen viewport or a capture target. Used by
// the shot camera preview (dualview.jsx) and every capture (stage-capture.jsx),
// so the preview, a PNG and an MP4 frame share one lens. A camera without an
// aperture or a shutter takes the plain gl.render path, untouched.
import * as THREE from "three";
import { lensPlan } from "./camera-capabilities/lens-plan.js";

const LENS_PREVIEW_SAMPLES = 8;
export const LENS_CAPTURE_SAMPLES = 24;

const VERTEX = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
const ACCUMULATE = "uniform sampler2D tSample; uniform float weight; varying vec2 vUv; void main() { gl_FragColor = texture2D(tSample, vUv) * weight; }";
const RESOLVE = `uniform sampler2D tAccum; varying vec2 vUv;
void main() {
	gl_FragColor = texture2D(tAccum, vUv);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

let shared = null;
function resources() {
	if (shared) return shared;
	const target = (samples) => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: samples > 0 });
	const accumulate = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: ACCUMULATE, uniforms: { tSample: { value: null }, weight: { value: 1 } },
		// Plain sum (one x source + one x destination): the weight is in the shader, not in alpha.
		blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
		depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
	const resolve = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: RESOLVE, uniforms: { tAccum: { value: null } }, depthTest: false, depthWrite: false });
	const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), accumulate), scene = new THREE.Scene();
	quad.frustumCulled = false;
	scene.add(quad);
	shared = { sample: target(4), accum: target(0), accumulate, resolve, quad, scene, ortho: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), sub: new THREE.PerspectiveCamera(), viewport: new THREE.Vector4() };
	return shared;
}

/** The lens state a shot camera carries (shot-camera-apply.js), checked against where the camera stands now. */
function lensCamera(camera) {
	const lens = camera.userData?.lens;
	if (!lens || !camera.isPerspectiveCamera) return null;
	// Blur poses are absolute: once the camera is flown off its sample they no longer describe it.
	const onSample = lens.pos && Math.abs(lens.pos.x - camera.position.x) + Math.abs(lens.pos.y - camera.position.y) + Math.abs(lens.pos.z - camera.position.z) < 1e-6;
	return { pos: camera.position, yaw: camera.rotation.y, pitch: camera.rotation.x, rollDeg: THREE.MathUtils.radToDeg(camera.rotation.z), fovDeg: camera.fov,
		focalMm: lens.focalMm, fStop: lens.fStop, focusDistance: lens.focusDistance, blur: onSample ? lens.blur : null };
}

/**
 * Draw `camera` through its lens into `output` (a render target, or null for
 * the screen at the current viewport and scissor). Returns false, drawing
 * nothing, when the camera carries no lens state; the caller then renders as usual.
 */
export function renderLens(gl, scene, camera, output = null, samples = LENS_PREVIEW_SAMPLES) {
	const state = lensCamera(camera), plan = state && lensPlan(state, { samples });
	if (!plan) return false;
	const r = resources(), previous = gl.getRenderTarget(), autoClear = gl.autoClear, shadowMap = gl.shadowMap, shadowAuto = shadowMap.autoUpdate;
	const clearColor = gl.getClearColor(new THREE.Color()), clearAlpha = gl.getClearAlpha();
	const size = output ? { x: output.width, y: output.height } : (() => { gl.getCurrentViewport(r.viewport); return { x: Math.max(1, r.viewport.z), y: Math.max(1, r.viewport.w) }; })();
	r.sample.setSize(size.x, size.y);
	r.accum.setSize(size.x, size.y);
	const sub = r.sub;
	sub.layers.mask = camera.layers.mask;
	sub.near = camera.near;
	sub.far = camera.far;
	sub.zoom = camera.zoom;
	sub.aspect = camera.aspect;
	if (camera.view?.enabled) sub.setViewOffset(camera.view.fullWidth, camera.view.fullHeight, camera.view.offsetX, camera.view.offsetY, camera.view.width, camera.view.height);
	else sub.clearViewOffset();
	sub.rotation.order = "YXZ";
	try {
		plan.samples.forEach(({ pose, dx, dy }, i) => {
			sub.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
			sub.rotation.set(pose.pitch, pose.yaw, THREE.MathUtils.degToRad(pose.rollDeg ?? 0));
			sub.fov = pose.fovDeg;
			sub.updateProjectionMatrix();
			if (plan.focusDistance) {
				// A point on the aperture disc, sheared back so the focal plane lands where the lens centre puts it.
				sub.translateX(dx);
				sub.translateY(dy);
				const e = sub.projectionMatrix.elements;
				e[8] -= (dx * e[0]) / plan.focusDistance;
				e[9] -= (dy * e[5]) / plan.focusDistance;
				sub.projectionMatrixInverse.copy(sub.projectionMatrix).invert();
			}
			sub.updateMatrixWorld();
			gl.autoClear = true;
			gl.setRenderTarget(r.sample);
			gl.render(scene, sub);
			if (i === 0) shadowMap.autoUpdate = false; // the light does not move between sub-frames
			gl.setRenderTarget(r.accum);
			if (i === 0) {
				gl.setClearColor(0x000000, 0);
				gl.clear(true, false, false);
				gl.setClearColor(clearColor, clearAlpha);
			}
			gl.autoClear = false;
			r.quad.material = r.accumulate;
			r.accumulate.uniforms.tSample.value = r.sample.texture;
			r.accumulate.uniforms.weight.value = 1 / plan.samples.length;
			gl.render(r.scene, r.ortho);
		});
		gl.setRenderTarget(output);
		if (output) gl.clear(true, true, false);
		gl.autoClear = false;
		r.quad.material = r.resolve;
		r.resolve.uniforms.tAccum.value = r.accum.texture;
		gl.render(r.scene, r.ortho);
	} finally {
		gl.autoClear = autoClear;
		shadowMap.autoUpdate = shadowAuto;
		if (!output) gl.setRenderTarget(previous);
	}
	return true;
}
