let currentFrame = 0;
const listeners = new Set();

export function playbackFrame() {
	return currentFrame;
}

export function setPlaybackFrame(next) {
	const frame = typeof next === "function" ? next(currentFrame) : next;
	if (!Number.isFinite(frame) || frame === currentFrame) return currentFrame;
	currentFrame = frame;
	if (typeof window !== "undefined") window.__cozyclayPlaybackFrame = frame;
	for (const listener of listeners) listener();
	return currentFrame;
}

export function subscribePlaybackFrame(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
