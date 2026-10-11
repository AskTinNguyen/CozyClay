import { useState } from "react";

export function useI2vCaptureModal() {
	const [i2vMotionEnabled, setI2vMotionEnabled] = useState(false);
	const [i2vMotionMode, setI2vMotionMode] = useState("interpolate");
	const [i2vMotionCameraUnlocked, setI2vMotionCameraUnlocked] = useState(false);
	return {
		i2vMotionEnabled,
		setI2vMotionEnabled,
		i2vMotionMode,
		setI2vMotionMode,
		i2vMotionCameraUnlocked,
		setI2vMotionCameraUnlocked,
	};
}
