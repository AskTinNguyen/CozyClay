import { useMemo } from "react";
import { useStudioShell } from "../shell/studio-shell-context.js";
import { checkShots } from "../camera-depth/shot-checks.js";
import "./shot-check-marks.css";

const EMPTY = [];
const FALLBACK_FILMBACK = { sensorId: "fullFrame", aspectRatio: 16 / 9 };
const RULE_TAG = { occluded: "BLOCKED", inside: "IN SET", crop: "CROP" };

/** camera.checkShots' measure of the shot list against the set (camera-depth/shot-checks.js), recomputed when shots, cast or props change. */
export function useShotChecks(shots) {
	const { characters = EMPTY, sceneObjects = EMPTY, filmback } = useStudioShell() ?? {};
	return useMemo(() => checkShots(shots ?? EMPTY, { cast: characters.filter((row) => !row.hidden), objects: sceneObjects, filmback: filmback ?? FALLBACK_FILMBACK }), [shots, characters, sceneObjects, filmback]);
}

/** Timeline flags on the Shots lane: a bar over the frames where a shot's camera is blocked, inside the set or crops at a joint (depth-staging). */
export function ShotCheckMarks({ shots, framePct, frameCount }) {
	const report = useShotChecks(shots);
	return report.shots.flatMap((shot) => shot.issues.map((issue) => (
		<span key={`${shot.shotId}:${issue.rule}:${issue.frames[0]}`} className={`tl-shot-check ${issue.severity}`} data-shot-check={shot.shotId} data-shot-check-rule={issue.rule}
			style={{ "--tl-f": framePct(issue.frames[0], frameCount), "--tl-f2": framePct(issue.frames.at(-1), frameCount) }}
			title={`${shot.name} · ${issue.severity}: ${issue.message} Fix: ${issue.fix.text}.`}>{RULE_TAG[issue.rule]}</span>
	)));
}
