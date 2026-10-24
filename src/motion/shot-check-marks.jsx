import { useContext, useMemo } from "react";
import { AppContext } from "../app-context.js";
import { useStudioShell } from "../shell/studio-shell-context.js";
import { checkShots } from "../camera-depth/shot-checks.js";
import { checkScene } from "../camera-depth/scene.js";
import { useShotState } from "./motivation-marks.jsx";
import "./shot-check-marks.css";

const EMPTY = [];
const FALLBACK_FILMBACK = { sensorId: "fullFrame", aspectRatio: 16 / 9 };
const RULE_TAG = { occluded: "BLOCKED", inside: "IN SET", crop: "CROP" };

/** camera.checkShots' measure of the shot list against the set (camera-depth/shot-checks.js), recomputed when shots, cast, props or the timeline length change.
 * The scene is the command's (checkScene): the editor's bounds port measures attached and path-driven props, and the timeline length times their paths. */
export function useShotChecks(shots) {
	const { characters = EMPTY, sceneObjects = EMPTY, filmback } = useStudioShell() ?? {};
	const ports = useContext(AppContext)?.ports, frameCount = useShotState()?.frameCount;
	return useMemo(() => checkShots(shots ?? EMPTY, checkScene({ characters, objects: sceneObjects, filmback: filmback ?? FALLBACK_FILMBACK, frameCount }, { bounds: ports ? (query) => ports.bounds(query) : undefined })),
		[shots, characters, sceneObjects, filmback, frameCount, ports]);
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
