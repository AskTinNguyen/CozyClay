import * as THREE from "three";
import { findBone } from "./ik.js";

// Body segment masses and the centre of mass of a posed Mixamo rig. Read-only:
// motion verification and the support diagnostics measure with it.

/**
 * Segment mass fractions of total body mass, from Dempster's cadaver study
 * (Dempster, W.T., "Space Requirements of the Seated Operator", WADC TR
 * 55-159, 1955), in the tabulation popularised by Winter, "Biomechanics and
 * Motor Control of Human Movement". The trunk (0.497) is split into pelvis
 * (0.142) and thorax+abdomen (0.355); distal pairs are merged because their
 * combined centroid still lands near the segment midpoint and Mixamo's hand
 * and toe bones are too short to place reliably:
 *
 *   head+neck 0.081 · trunk 0.497 · upper arm 0.028 · forearm 0.016 +
 *   hand 0.006 = 0.022 · thigh 0.100 · shank 0.0465 + foot 0.0145 = 0.061
 *
 * Each entry names the two Mixamo bones whose MIDPOINT carries the fraction.
 * Dempster's true centres of mass sit ~43% down each segment rather than at
 * 50%, but the difference is a couple of centimetres on a limb and cancels
 * almost exactly between the left and right sides — while the midpoint keeps
 * the table readable and needs no extra per-segment constant.
 *
 * The fractions sum to 1, so the weighted average below is a true CoM.
 */
export const SEGMENT_MASSES = [
	{ id: "pelvis", start: "mixamorigHips", end: "mixamorigSpine1", mass: 0.142 },
	{ id: "torso", start: "mixamorigSpine1", end: "mixamorigNeck", mass: 0.355 },
	{ id: "head", start: "mixamorigNeck", end: "mixamorigHead", mass: 0.081 },
	{ id: "leftUpperArm", start: "mixamorigLeftArm", end: "mixamorigLeftForeArm", mass: 0.028 },
	{ id: "leftForeArmHand", start: "mixamorigLeftForeArm", end: "mixamorigLeftHand", mass: 0.022 },
	{ id: "rightUpperArm", start: "mixamorigRightArm", end: "mixamorigRightForeArm", mass: 0.028 },
	{ id: "rightForeArmHand", start: "mixamorigRightForeArm", end: "mixamorigRightHand", mass: 0.022 },
	{ id: "leftThigh", start: "mixamorigLeftUpLeg", end: "mixamorigLeftLeg", mass: 0.100 },
	{ id: "leftShankFoot", start: "mixamorigLeftLeg", end: "mixamorigLeftFoot", mass: 0.061 },
	{ id: "rightThigh", start: "mixamorigRightUpLeg", end: "mixamorigRightLeg", mass: 0.100 },
	{ id: "rightShankFoot", start: "mixamorigRightLeg", end: "mixamorigRightFoot", mass: 0.061 },
];

/**
 * World-space centre of mass of the rig's CURRENT pose: the mass-weighted
 * average of every segment's midpoint. Returns null when any segment bone is
 * missing — a partial CoM would silently drift the correction toward
 * whichever half of the body did resolve, so the caller must instead hide the
 * tool (the same all-or-nothing policy resolveIkRig uses).
 */
export function computeCenterOfMass(rig) {
	if (!rig) return null;
	rig.updateMatrixWorld(true);
	const com = new THREE.Vector3();
	const start = new THREE.Vector3();
	const end = new THREE.Vector3();
	let total = 0;
	for (const segment of SEGMENT_MASSES) {
		const a = findBone(rig, segment.start);
		const b = findBone(rig, segment.end);
		if (!a || !b) return null;
		a.getWorldPosition(start);
		b.getWorldPosition(end);
		com.addScaledVector(start.add(end).multiplyScalar(0.5), segment.mass);
		total += segment.mass;
	}
	if (total <= 0) return null;
	return com.divideScalar(total);
}
