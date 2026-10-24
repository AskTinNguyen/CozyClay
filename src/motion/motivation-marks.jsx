import { useContext, useMemo, useSyncExternalStore } from "react";
import { AppContext } from "../app-context.js";
import { useStudioShell } from "../shell/studio-shell-context.js";
import { checkMotivation } from "../camera-motivation/check.js";
import { storyBeatWords } from "../camera-motivation/story-beats.js";
import { studioSequenceDocument } from "../sequence-prompt-studio.js";
import "./motivation-marks.css";

const EMPTY = [];
const NO_STORE = { subscribe: () => () => {}, read: () => null };
const RULE_TAG = { unmotivated: "NO MOTIVE", "starts-off-beat": "OFF BEAT", "settles-off-beat": "OFF BEAT" };

/** The shot document's state (its story beats and frame count), re-read when the shot domain changes. */
function useShotState() {
	const store = useContext(AppContext)?.storeDomain?.("shot")?.documentStore ?? NO_STORE;
	return useSyncExternalStore(store.subscribe, () => store.read("shot"), () => store.read("shot"));
}

/** camera.checkMotivation's measure of the shot list (camera-motivation/check.js), recomputed when shots, cast or beats change. Takes compile once (cached per take). */
export function useMotivationCheck(shots) {
	const { characters = EMPTY, filmback, sceneObjects } = useStudioShell() ?? {};
	const state = useShotState(), storyBeats = state?.storyBeats ?? EMPTY, frameCount = state?.frameCount;
	return useMemo(() => ({ ...checkMotivation({ ...studioSequenceDocument({ characters, filmback, objects: sceneObjects, frameCount }), shots: shots ?? EMPTY, storyBeats }), storyBeats }),
		[shots, characters, filmback, sceneObjects, frameCount, storyBeats]);
}

/** Timeline marks on the Shots lane: each story beat, and a flag on every move the check finds unmotivated or off its beat. */
export function MotivationMarks({ shots, framePct, frameCount }) {
	const { issues, storyBeats } = useMotivationCheck(shots);
	return (<>
		{storyBeats.map((beat) => (
			<span key={beat.id} className={`tl-story-beat ${beat.kind}`} data-story-beat={beat.frame} data-story-beat-id={beat.id}
				style={{ "--tl-f": framePct(beat.frame, frameCount) }} title={`Story beat: ${storyBeatWords(beat)}`}>{beat.label}</span>
		))}
		{issues.map((issue) => (
			<span key={`${issue.shotId}:${issue.frames[0]}:${issue.rule}`} className={`tl-motive-flag ${issue.severity}`} data-motivation-flag={issue.shotId} data-motivation-rule={issue.rule}
				style={{ "--tl-f": framePct(issue.frames[0], frameCount), "--tl-f2": framePct(issue.frames[1], frameCount) }}
				title={`${issue.severity}: ${issue.message} Fix: ${issue.fix.text}.`}>{RULE_TAG[issue.rule]}</span>
		))}
	</>);
}
