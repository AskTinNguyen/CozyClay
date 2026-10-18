// How a QA result reads to a person. QA records one issue per frame and groups them by kind and subject (qa/index.js),
// so one goal missed on 321 frames is 321 issues but one problem: the user saw "QA 549" for two long groups. People read
// problems (the groups); qa.total stays the frame-level count the agent, repair and search work with.
import { ko } from "./locale.js";

/** Problems in a QA result: its groups (qa.problems from runMotionQa; an older result counts its groups). */
export const qaProblems = qa => qa?.problems ?? (Array.isArray(qa?.groups) ? qa.groups.length : (qa?.total ?? 0));

/** "QA clean" | "2 problems" ("QA 통과" | "문제 2개"). */
export function qaLabel(qa) {
	const n = qaProblems(qa);
	if (qa?.ok || !n) return ko("QA clean", "QA 통과");
	return ko(`${n} problem${n === 1 ? "" : "s"}`, `문제 ${n}개`);
}

/** A receipt's QA phrase: "clean" | "2 problems (321 frame issues)". */
export function qaSay(qa) {
	if (qa?.ok) return "clean";
	const n = qaProblems(qa), total = qa?.total ?? 0;
	return `${n} problem${n === 1 ? "" : "s"} (${total} frame issue${total === 1 ? "" : "s"})`;
}
