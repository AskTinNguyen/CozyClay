const INITIAL_MESSAGE = "Measure the reference landmarks before placing parts.";

const initialState = ({ targetIou, maxRounds }) => ({
	stage: "idle",
	round: 0,
	maxRounds,
	iou: null,
	targetIou,
	elapsedMs: 0,
	sheetDataUrl: null,
	message: null,
	error: null,
	sculptId: null,
});

const isAsyncIterable = value => value && typeof value[Symbol.asyncIterator] === "function";
const commandName = event => event?.action ?? event?.command ?? (event?.commandId ? event?.name : undefined) ?? event?.name ?? event?.id;
const commandArgs = event => event?.args ?? event?.arguments ?? event?.request?.args ?? {};
const commandResult = event => event?.result ?? event?.receipt ?? event?.output ?? event?.response ?? event?.value;
const affectedIds = value => Array.isArray(value?.affectedIds) ? value.affectedIds : [];

function dataUrlFromSheet(sheet) {
	if (typeof sheet === "string") return sheet;
	if (!sheet || !Number.isFinite(sheet.width) || !Number.isFinite(sheet.height) || !sheet.data) return null;
	// The compare command normally supplies sheetDataUrl. Keeping this fallback
	// here makes the controller useful with a bus that only forwards raw sheet RGBA.
	if (typeof globalThis.btoa !== "function") return null;
	let binary = "";
	for (const byte of sheet.data) binary += String.fromCharCode(byte);
	return `data:image/raw;base64,${globalThis.btoa(binary)}`;
}

// The reference as sculpt.compare takes it: the stored asset when there is one.
const referenceArg = reference => (reference?.assetId ? { assetId: reference.assetId } : { dataUrl: reference?.dataUrl });

// The recipe rules the agent needs to get object.sculpt right the first time (sculpt-recipe.js).
const RECIPE_RULES = "Recipe: { \"version\": 1, \"parts\": [{ \"id\", \"shape\", \"size\": [x,y,z] metres, \"position\": [x,y,z] centre, \"rotation\": [x,y,z] degrees, \"color\": \"#rrggbb\", \"parent\"?, \"mirror\"?, \"roundness\"? 0-1, \"taper\"? }] }. id: lowercase a-z, 0-9 and -, starting with a letter or digit, at most 40 characters. shape is exactly one of blob, box, cylinder, torus, frame (no cone, sphere or other names). Up to 48 parts after mirrors. Floor is y=0 (feet touch it), front is +z, the subject's left is +x, mirror: true adds the reflection across x=0. roundness works backwards from its name: 0 is a smooth ellipsoid and 1 is a rounded box. roundness belongs only on blob and box, taper only on blob: leave both off cylinder, torus and frame. Keep roundness at 0.2 or below on every organic part (body, belly, head, face, limbs); go above 0.3 only for hard-edged objects. Use box only for hard-edged things.";

// A compact score for the next turn: what is missing where, and which parts stick out.
function reportText(report) {
	if (!report) return "";
	const extra = Array.isArray(report.extraByPart) ? report.extraByPart.slice(0, 4) : report.extraByPart;
	return ` Score detail: ${JSON.stringify({ widthToHeight: report.widthToHeight, missingByBand: report.missingByBand, extraByPart: extra })}.`;
}

function outlineText(outline) {
	if (!outline) return "";
	return ` The harness measured the reference outline in pixels (front view; x is a fraction of the subject's height from its centre, + toward image right = the subject's own left; y is a fraction of height from the head top; spans are the filled runs across each slice): ${JSON.stringify(outline)}. Put parts on these measurements.`;
}

function makeTurnText(reference, sculptId, continuation, outline = null) {
	const ref = JSON.stringify(referenceArg(reference));
	if (continuation) {
		return [
			`Round ${continuation.round} of ${continuation.maxRounds}. The harness scored sculpt ${sculptId} at IoU ${continuation.iou ?? "unknown"} against the reference.${reportText(continuation.report)}`,
			`Write 3-6 candidate edit sets that fix the biggest mismatch (proportion first, then placement), rank them with ONE run_action sculpt.compare { "id": "${sculptId}", "reference": ${ref}, "candidates": [{ "label", "edits" }] },`,
			`apply the best-ranked set with ONE run_action object.sculpt { "id": "${sculptId}", "edits": [...] }, then end the turn with one short line. Do not inspect first; the harness scores the result after your turn.`,
			RECIPE_RULES,
		].join(" ");
	}
	return [
		"Sculpt the subject of the attached reference image as a clay recipe.",
		outline
			? `Use the measured outline below, scaled to a real-world height in metres.${outlineText(outline)}`
			: "First measure the visible outline in the image: the subject's bounding box, then where the head top, each limb tip and the feet sit as fractions of its height, and convert them to metres for a real-world height.",
		sculptId
			? `Then rewrite sculpt ${sculptId} with ONE run_action object.sculpt { "id": "${sculptId}", "recipe": ... }, keeping parts on the measured landmarks.`
			: "Then create it with ONE run_action object.sculpt { \"name\", \"recipe\" }, keeping parts on the measured landmarks.",
		"No inspect calls are needed and do not call sculpt.compare: the harness scores the sculpt after your turn and tells you the result.",
		"End the turn with one short line naming what the image hides.",
		RECIPE_RULES,
	].join(" ");
}

/**
 * Adapt the callback-based Studio client into the small port consumed by the
 * sculpt controller. The controller deliberately owns the session/turn loop.
 */
// The sidecar's Studio envelope requires UUIDs for both the session and the turn.
export function createAgentPort(client, { sessionId = crypto.randomUUID() } = {}) {
	return {
		async *sendTurn({ text, attachments = [], signal, effort }) {
			const events = [];
			let wake;
			let ended = false;
			const push = event => { events.push(event); wake?.(); wake = null; };
			const result = client.turn({
				surface: "studio",
				sessionId,
				turnId: crypto.randomUUID(),
				text,
				...(effort ? { effort } : {}),
				...(attachments.length ? { attachments } : {}),
				context: null,
			}, push, signal);
			Promise.resolve(result).then(() => { ended = true; wake?.(); wake = null; }, error => { ended = true; push({ type: "error", message: String(error?.message || error) }); });
			while (!ended || events.length) {
				if (!events.length) await new Promise(resolve => { wake = resolve; });
				while (events.length) yield events.shift();
			}
		},
	};
}

export function createSculptRun({
	bus,
	agent,
	reference,
	sculptId = null,
	targetIou = 0.9,
	maxRounds = 3,
	timeBudgetMs = 180000,
	now = Date.now,
	// Optional ({ id, reference }) -> sculpt.compare result. The harness scores a turn the agent left unscored.
	score = null,
	// Optional (reference) -> measureReferenceOutline result, put into the first turn's text.
	measure = null,
	// Measured: "high" made the first turn twice as slow for no better draft, so the default effort stays.
	draftEffort = undefined,
} = {}) {
	if (!agent?.sendTurn) throw new TypeError("sculpt run requires an agent port");
	const listeners = new Set();
	const controller = new AbortController();
	let state = initialState({ targetIou, maxRounds });
	let running = false;
	let settled = false;
	let startedAt = 0;
	let turnSculpted = false;
	let turnScored = false;
	let lastReport = null;
	let retryCount = 0;
	let turnPromise = null;

	const elapsed = () => Math.max(0, now() - startedAt);
	const publish = patch => {
		state = { ...state, ...patch, elapsedMs: elapsed() };
		for (const listener of [...listeners]) listener(state);
	};
	const onBus = event => {
		const name = commandName(event);
		const args = commandArgs(event);
		const result = commandResult(event);
		const ids = affectedIds(result);
		if (name === "object.sculpt" || event?.type === "object.sculpt") {
			const id = args.id ?? ids[0] ?? event?.sculptId ?? state.sculptId;
			if (id) {
				turnSculpted = true;
				turnScored = false; // a score taken before this edit no longer describes the sculpt
				const stage = state.round > 1 ? "refine" : "draft";
				if (state.stage === stage) state = { ...state, sculptId: id, round: Math.max(1, state.round) };
				else publish({ sculptId: id, round: Math.max(1, state.round), stage, message: "Draft sculpt applied." });
			}
			return;
		}
		if (name !== "sculpt.compare" && event?.type !== "sculpt.compare") return;
		const report = result?.report ?? event?.report;
		if (result && Number.isFinite(Number(result.report?.iou ?? result.iou))) lastReport = result.report ?? result;
		const iou = Number(report?.iou ?? result?.iou ?? event?.iou);
		const sheet = result?.sheetDataUrl ?? event?.sheetDataUrl ?? dataUrlFromSheet(result?.sheet);
		if (Number.isFinite(iou)) turnScored = true;
		publish({
			stage: "score",
			...(Number.isFinite(iou) ? { iou } : {}),
			...(sheet ? { sheetDataUrl: sheet } : {}),
			message: Number.isFinite(iou) ? `Sculpt comparison scored IoU ${iou}.` : "Sculpt comparison complete.",
		});
	};
	const unsubscribeBus = bus?.subscribe?.(onBus) ?? (() => {});

	const consumeTurn = async (text, effort) => {
		turnSculpted = false;
		turnScored = false;
		const events = [];
		let turnError = null;
		const callback = event => {
			events.push(event);
			if (event?.type === "text.delta") publish({ message: `${state.message ?? ""}${event.text ?? ""}` });
			// A refused or failed turn is the run's failure, not a turn that forgot to sculpt.
			if (event?.type === "error") turnError ??= new Error(event.message || event.code || "The agent turn failed.");
		};
		const returned = agent.sendTurn({ text, attachments: reference?.dataUrl ? [{ dataUrl: reference.dataUrl, name: reference.name }] : [], signal: controller.signal, ...(effort ? { effort } : {}) }, callback);
		if (isAsyncIterable(returned)) {
			for await (const event of returned) callback(event);
		} else await returned;
		if (turnError) throw turnError;
	};

	const loop = async () => {
		startedAt = now();
		publish({ stage: "measure", round: 0, message: INITIAL_MESSAGE, error: null });
		let outline = null;
		if (measure) {
			try { outline = await measure(referenceArg(reference)); } catch (error) { publish({ message: `Could not measure the reference: ${String(error?.message || error)}` }); }
		}
		if (controller.signal.aborted) { publish({ stage: "cancelled", message: "Sculpt run cancelled." }); settled = true; return; }
		let text = makeTurnText(reference, sculptId, false, outline);
		while (!controller.signal.aborted) {
			if (elapsed() >= timeBudgetMs) break;
			const roundBefore = state.round;
			// The first draft decides most of the score, so it gets the deeper reasoning.
			turnPromise = consumeTurn(text, roundBefore === 0 ? draftEffort : undefined);
			try { await turnPromise; } catch (error) {
				if (controller.signal.aborted) break;
				publish({ stage: "failed", error: String(error?.message || error), message: "Sculpt run failed." });
				settled = true;
				return;
			} finally { turnPromise = null; }
			if (controller.signal.aborted) break;
			if (!turnSculpted) {
				if (retryCount === 0) {
					retryCount += 1;
					publish({ stage: roundBefore > 0 ? "refine" : "measure", message: "No object.sculpt command arrived; retrying with a firm reminder." });
					text = `${text} Firm reminder: you must execute object.sculpt before ending this turn, then call sculpt.compare.`;
					continue;
				}
				publish({ stage: "failed", error: "The turn ended without an object.sculpt command.", message: "No sculpt was applied after one retry." });
				settled = true;
				return;
			}
			retryCount = 0;
			if (!turnScored && score && state.sculptId) {
				const args = { id: state.sculptId, reference: referenceArg(reference) };
				try {
					const value = await score(args);
					onBus({ action: "sculpt.compare", args, result: value?.output ?? value });
				} catch (error) {
					publish({ message: `Scoring failed: ${String(error?.message || error)}` });
				}
				if (controller.signal.aborted) break;
			}
			if (state.iou !== null && state.iou >= targetIou) break;
			if (state.round >= maxRounds || elapsed() >= timeBudgetMs) break;
			const nextRound = Math.max(1, state.round + 1);
			publish({ stage: "refine", round: nextRound, message: `Preparing refinement round ${nextRound} of ${maxRounds}.` });
			text = makeTurnText(reference, state.sculptId, { round: nextRound, maxRounds, iou: state.iou, report: lastReport });
		}
		if (controller.signal.aborted) {
			publish({ stage: "cancelled", message: "Sculpt run cancelled." });
		} else {
			publish({ stage: "done", message: state.iou === null ? "Sculpt run finished without a score." : `Sculpt run finished at IoU ${state.iou}.` });
		}
		settled = true;
	};
	// A finished run stops listening to the bus, whichever way it ended.
	const run = async () => {
		try { await loop(); } finally { unsubscribeBus(); }
	};

	return {
		start() {
			if (running) return turnPromise ?? Promise.resolve();
			running = true;
			return run();
		},
		cancel() {
			if (settled) return;
			controller.abort("sculpt-run-cancelled");
			if (!running) { unsubscribeBus(); publish({ stage: "cancelled", message: "Sculpt run cancelled." }); }
		},
		getState: () => state,
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
	};
}
