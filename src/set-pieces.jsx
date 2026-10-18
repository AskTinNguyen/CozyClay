/**
 * The hand-built set pieces: a car, a small plane and a chair, modelled from
 * primitives in the same clay style as the room and the character tint.
 * Dimensions are metres against real sizes so the 1.8 m figure keeps honest
 * scale. Each takes `autoColor` (the viewport's auto-colour mode) and then
 * tints its primary surfaces flat; glass, tyres and rims keep their own.
 */

// Blender's solid-view response for auto-colored surfaces. Workbench shades
// with a neutral studio rig, so the derived hue reaches the eye unmultiplied;
// under our warm key light a plain standard material turns every hue olive.
// Full roughness kills the specular sheen and a self-light of the same hue
// lifts the shadow side the way workbench's studio lighting does.
export function autoFlat(hex) {
	return { color: hex, roughness: 1, metalness: 0, emissive: hex, emissiveIntensity: 0.4 };
}

const CLAY_CAR = "#d98770";
const CLAY_CAR_TOP = "#e49a84";
const CLAY_TIRE = "#41484c";
const CLAY_RIM = "#7c8588";
const CLAY_GLASS = "#55697a";
const CLAY_PLANE = "#7896a4";
const CLAY_PLANE_TRIM = "#e1a849";
const CLAY_CHAIR = "#b9855d";
const CLAY_CHAIR_LIGHT = "#cf9d72";

function Wheel({ position }) {
	return (
		<group position={position}>
			<mesh rotation={[0, 0, Math.PI / 2]}>
				<cylinderGeometry args={[0.33, 0.33, 0.24, 20]} />
				<meshStandardMaterial color={CLAY_TIRE} roughness={0.95} />
			</mesh>
			<mesh rotation={[0, 0, Math.PI / 2]}>
				<cylinderGeometry args={[0.17, 0.17, 0.26, 16]} />
				<meshStandardMaterial color={CLAY_RIM} roughness={0.5} metalness={0.35} />
			</mesh>
		</group>
	);
}
/**
 * A generic 5-door-ish sedan silhouette, ~4.5 m long. Origin at the centre
 * of the footprint, +Z forward.
 */
export function Car({ position = [0, 0, 0], rotY = 0, color = CLAY_CAR, topColor = CLAY_CAR_TOP, autoColor = undefined }) {
	const bodyMaterial = autoColor
		? { ...autoFlat(autoColor) }
		: { color, roughness: 0.55, metalness: 0.25 };
	const topMaterial = autoColor
		? { ...autoFlat(autoColor) }
		: { color: topColor, roughness: 0.5, metalness: 0.2 };
	return (
		<group position={position} rotation={[0, rotY, 0]}>
			<mesh position={[0, 0.62, 0]}>
				<boxGeometry args={[1.78, 0.62, 4.45]} />
				<meshStandardMaterial {...bodyMaterial} />
			</mesh>
			<mesh position={[0, 1.12, -0.15]}>
				<boxGeometry args={[1.58, 0.5, 2.2]} />
				<meshStandardMaterial {...topMaterial} />
			</mesh>
			<mesh position={[0, 1.14, -0.15]}>
				<boxGeometry args={[1.62, 0.3, 1.9]} />
				<meshStandardMaterial color={CLAY_GLASS} roughness={0.15} metalness={0.6} />
			</mesh>
			<mesh position={[0, 1.05, 0.95]} rotation={[0.5, 0, 0]}>
				<boxGeometry args={[1.56, 0.42, 0.08]} />
				<meshStandardMaterial color={CLAY_GLASS} roughness={0.15} metalness={0.6} />
			</mesh>
			<mesh position={[0, 1.05, -1.25]} rotation={[-0.55, 0, 0]}>
				<boxGeometry args={[1.56, 0.42, 0.08]} />
				<meshStandardMaterial color={CLAY_GLASS} roughness={0.15} metalness={0.6} />
			</mesh>
			<Wheel position={[0.82, 0.33, 1.45]} />
			<Wheel position={[-0.82, 0.33, 1.45]} />
			<Wheel position={[0.82, 0.33, -1.45]} />
			<Wheel position={[-0.82, 0.33, -1.45]} />
		</group>
	);
}

/** Compact single-engine propeller plane, ~3.4 m wingspan and +Z forward. */
export function SmallPlane({ position = [0, 0, 0], rotY = 0, autoColor = undefined }) {
	// Auto-color mode tints the PRIMARY surfaces only (fuselage, wings, trim);
	// glass, tires and rims keep their materials so the silhouette still reads.
	// Each mesh keeps its own hand-tuned roughness when the mode is off.
	const mat = (color, roughness, metalness) =>
		autoColor ? autoFlat(autoColor) : { color, roughness, metalness };
	return (
		<group position={position} rotation={[0, rotY, 0]}>
			<mesh position={[0, 0.76, 0]} rotation={[Math.PI / 2, 0, 0]}>
				<cylinderGeometry args={[0.23, 0.31, 2.75, 16]} />
				<meshStandardMaterial {...mat(CLAY_PLANE, 0.58, 0.18)} />
			</mesh>
			<mesh position={[0, 0.76, 1.55]} rotation={[Math.PI / 2, 0, 0]}>
				<coneGeometry args={[0.23, 0.55, 16]} />
				<meshStandardMaterial {...mat(CLAY_PLANE_TRIM, 0.52, 0.2)} />
			</mesh>

			<mesh position={[0, 0.73, 0.15]}>
				<boxGeometry args={[3.4, 0.09, 0.58]} />
				<meshStandardMaterial {...mat(CLAY_PLANE, 0.62, 0.14)} />
			</mesh>
			<mesh position={[0, 0.84, -1.18]}>
				<boxGeometry args={[1.45, 0.07, 0.38]} />
				<meshStandardMaterial {...mat(CLAY_PLANE_TRIM, 0.62, 0.12)} />
			</mesh>
			<mesh position={[0, 1.08, -1.2]} rotation={[0.22, 0, 0]}>
				<boxGeometry args={[0.08, 0.62, 0.48]} />
				<meshStandardMaterial {...mat(CLAY_PLANE, 0.62, 0.12)} />
			</mesh>

			<mesh position={[0, 1.02, 0.42]} scale={[0.62, 0.46, 0.9]}>
				<sphereGeometry args={[0.42, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
				<meshStandardMaterial color={CLAY_GLASS} roughness={0.16} metalness={0.55} />
			</mesh>

			<group position={[0, 0.76, 1.86]}>
				<mesh rotation={[Math.PI / 2, 0, 0]}>
					<cylinderGeometry args={[0.11, 0.11, 0.2, 12]} />
					<meshStandardMaterial color={CLAY_RIM} roughness={0.45} metalness={0.4} />
				</mesh>
				<mesh position={[0, 0, 0.12]} rotation={[0, 0, 0.28]}>
					<boxGeometry args={[1.25, 0.08, 0.06]} />
					<meshStandardMaterial color={CLAY_TIRE} roughness={0.8} />
				</mesh>
			</group>

			{[-0.55, 0.55].map((x) => (
				<group key={x} position={[x, 0.2, 0.15]}>
					<mesh position={[0, 0.24, 0]} rotation={[0, 0, x < 0 ? -0.35 : 0.35]}>
						<boxGeometry args={[0.045, 0.55, 0.045]} />
						<meshStandardMaterial color={CLAY_RIM} roughness={0.65} metalness={0.3} />
					</mesh>
					<mesh rotation={[0, 0, Math.PI / 2]}>
						<cylinderGeometry args={[0.16, 0.16, 0.09, 14]} />
						<meshStandardMaterial color={CLAY_TIRE} roughness={0.95} />
					</mesh>
				</group>
			))}
		</group>
	);
}

export function Chair({ position = [0, 0, 0], rotY = 0, autoColor = undefined }) {
	// Auto-color mode tints seat/back and frame together; undefined keeps the
	// hand-picked clay pair exactly as it ships.
	const seat = autoColor ? autoFlat(autoColor) : { color: CLAY_CHAIR_LIGHT, roughness: 0.86 };
	const frame = autoColor ? autoFlat(autoColor) : { color: CLAY_CHAIR, roughness: 0.9 };
	const legPositions = [
		[-0.24, 0.23, -0.22],
		[0.24, 0.23, -0.22],
		[-0.24, 0.23, 0.22],
		[0.24, 0.23, 0.22],
	];
	return (
		<group position={position} rotation={[0, rotY, 0]} scale={0.9}>
			<mesh position={[0, 0.49, 0]} castShadow receiveShadow>
				<boxGeometry args={[0.6, 0.12, 0.58]} />
				<meshStandardMaterial {...seat} />
			</mesh>
			{legPositions.map((leg, index) => (
				<mesh key={index} position={leg} castShadow receiveShadow>
					<boxGeometry args={[0.09, 0.46, 0.09]} />
					<meshStandardMaterial {...frame} />
				</mesh>
			))}
			<mesh position={[-0.24, 0.92, -0.245]} castShadow receiveShadow>
				<boxGeometry args={[0.09, 0.86, 0.09]} />
				<meshStandardMaterial {...frame} />
			</mesh>
			<mesh position={[0.24, 0.92, -0.245]} castShadow receiveShadow>
				<boxGeometry args={[0.09, 0.86, 0.09]} />
				<meshStandardMaterial {...frame} />
			</mesh>
			<mesh position={[0, 1.08, -0.245]} castShadow receiveShadow>
				<boxGeometry args={[0.52, 0.38, 0.1]} />
				<meshStandardMaterial {...seat} />
			</mesh>
		</group>
	);
}
