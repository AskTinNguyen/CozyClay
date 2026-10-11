import { useRef, useState } from "react";
import { cameraTutorialSuppressed } from "./first-shot-handoff.js";
import { loadProjectSession } from "./project.js";
import { SCENES_STORAGE_KEY } from "./scenes.js";

export function useCameraTutorial({ embedMode, playgroundMode }) {
	// The camera tutorial (#206): the landing page's seven steps, run against
	// the real studio instead of the playground iframe. It opens from
	// /app/?tutorial=camera or from Settings ▾, and it is not offered inside an
	// embed.

	// Both doors go through startCameraTutorial (#209), which puts the studio in
	// the state the landing page teaches these steps in — the city-block starter
	// scene with the walk take on its character — so Shot / Rail / Play always
	// have something to frame. That function is declared with the project
	// actions further down; the listeners here reach it through a ref so they
	// always call the current render's closure (the confirm reads projectDirty).
	const [cameraTutorialEntry] = useState(() => {
		const params = new URLSearchParams(globalThis.location?.search || "");
		const query = params.get("tutorial") === "camera";
		let firstRun = false;
		try {
			firstRun = !query && !params.get("scene") && !cameraTutorialSuppressed()
				&& !loadProjectSession()?.name && !globalThis.localStorage?.getItem(SCENES_STORAGE_KEY);
		} catch { firstRun = false; }
		return !embedMode && !playgroundMode && !cameraTutorialSuppressed() && (query ? "query" : firstRun ? "first-run" : null);
	});
	const cameraTutorialQuery = Boolean(cameraTutorialEntry);
	const [cameraTutorial, setCameraTutorial] = useState(false);
	const cameraTutorialAnalytics = useRef(null);
	const [cameraTutorialAttempt, setCameraTutorialAttempt] = useState(0);
	const [cameraTutorialHandoff, setCameraTutorialHandoff] = useState(null);
	const cameraTutorialCompletedRef = useRef(false);
	const exportMenuTriggerRef = useRef(null);
	const exportShotIdRef = useRef(null);
	// The step the tutorial is on, published on the .app root so styles.css can
	// spotlight the one control that step needs (#211).
	const [cameraTutorialStep, setCameraTutorialStep] = useState(null);
	const startCameraTutorialRef = useRef(null);
	const cameraTutorialStarted = useRef(false);
	// A tutorial restart never reloads the starter over the user's edits.
	const tutorialStarterRef = useRef(false);
	const tutorialLoadingRef = useRef(false);
	const tutorialProjectEpochRef = useRef(0);
	const tutorialSeedEpochRef = useRef(null);
	// Armed once the starter is applied, consumed by the seed effect next to the
	// hosted-demo seed as soon as the new character's rig exists.
	const [tutorialSeedPending, setTutorialSeedPending] = useState(false);
	return { cameraTutorialEntry, cameraTutorialQuery, cameraTutorial, setCameraTutorial, cameraTutorialAnalytics, cameraTutorialAttempt, setCameraTutorialAttempt, cameraTutorialHandoff, setCameraTutorialHandoff, cameraTutorialCompletedRef, exportMenuTriggerRef, exportShotIdRef, cameraTutorialStep, setCameraTutorialStep, startCameraTutorialRef, cameraTutorialStarted, tutorialStarterRef, tutorialLoadingRef, tutorialProjectEpochRef, tutorialSeedEpochRef, tutorialSeedPending, setTutorialSeedPending };
}
