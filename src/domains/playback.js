import { advancePlaybackFrame, registerPlaybackFrameApplier } from "../motion/playback-frame-store.js";
import { takeFrameAt } from "../camera-capabilities/speed.js";

function createPlaybackApplier(appContext, motion, poseOtherCastMembers, ikEvaluate, blendFrames) {
	return (frame) => {
		appContext.shared.tlFrameRef.current = frame;
		appContext.shared.propFrameRef.current = frame;
		appContext.patchTimeline({ currentFrame: frame });
		// The cast plays the take at the frame the shot under the playhead samples (its speed, camera-capabilities).
		const take = takeFrameAt(appContext.shared.shots, frame);
		if (appContext.shared.activeRig) appContext.shared.poseMemberAtFrame(appContext.shared.activeRig, motion, null, take);
		poseOtherCastMembers(take);
		const state = appContext.shared.ikStateRef.current;
		if (!appContext.shared.posing && state?.chains && (appContext.shared.ikMode || state.keys.size > 0)) {
			ikEvaluate(state.chains, state, take, state.fkJoints, motion ? blendFrames : 0);
		}
	};
}

export function installPlaybackApplier(...args) {
	return registerPlaybackFrameApplier(createPlaybackApplier(...args));
}

// A camera-shot preview stops at its shot's end; otherwise the playhead wraps.
export function advancePlayback(shared, steps) {
	const count = Math.max(1, Math.floor(steps));
	const previewEnd = shared.cameraPreviewEndRef.current;
	if (previewEnd != null && shared.tlFrameRef.current + count >= previewEnd) {
		shared.cameraPreviewEndRef.current = null;
		shared.setTlFrame(previewEnd);
		shared.setTlPlaying(false);
		return;
	}
	advancePlaybackFrame(shared.frameCountRef.current, count);
}
