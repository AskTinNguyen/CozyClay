import { useMemo } from "react";
import { useStudioShell } from "../shell/studio-shell-context.js";
import { checkCuts } from "../camera-coverage/cut-rules.js";
import { transitionTag } from "../camera-coverage/transitions.js";
import "./cut-flags.css";

const FALLBACK_FILMBACK = { sensorId: "fullFrame", aspectRatio: 16 / 9 };
const RULE_TAG = { line: "180°", jump: "JUMP", screen: "SCREEN", eyeline: "EYELINE" };

/** The editing-rule check of every cut in the shot list (camera-coverage/cut-rules.js), recomputed when shots or cast change. */
export function useCutChecks(shots) {
	const { characters = [], filmback } = useStudioShell() ?? {};
	return useMemo(() => checkCuts(shots ?? [], { cast: characters.filter((row) => !row.hidden), filmback: filmback ?? FALLBACK_FILMBACK }), [shots, characters, filmback]);
}

/** Timeline marks on the cuts: a flag with its rules where a cut breaks one, and the transition's tag where a cut has one. */
export function CutFlagMarks({ shots, framePct, frameCount }) {
	const { cuts } = useCutChecks(shots);
	const transitions = new Map((shots ?? []).filter((shot) => shot.transition).map((shot) => [shot.startFrame, shot.transition]));
	return cuts.filter((cut) => cut.issues.length || transitions.has(cut.cutFrame)).map((cut) => {
		const severity = cut.issues.some((issue) => issue.severity === "high") ? "high" : cut.issues.length ? "medium" : "none";
		const tags = [...new Set(cut.issues.map((issue) => RULE_TAG[issue.rule]))], transition = transitions.get(cut.cutFrame);
		const title = [`Cut at frame ${cut.cutFrame}: ${cut.fromName} → ${cut.toName}`, ...cut.issues.map((issue) => `${issue.severity}: ${issue.message} Fix: ${issue.fix.text}.`), ...(transition ? [`Transition: ${transitionTag(transition)}`] : [])].join("\n");
		return (
			<span key={`cut:${cut.cutFrame}`} className={`tl-cut-flag ${severity}`} data-cut-flag={cut.cutFrame} data-cut-rules={cut.issues.map((issue) => issue.rule).join(" ")}
				style={{ "--tl-f": framePct(cut.cutFrame, frameCount) }} title={title}>
				{tags.length ? tags.join(" · ") : null}{transition ? <em data-cut-transition={transition.type}>{transitionTag(transition)}</em> : null}
			</span>
		);
	});
}
