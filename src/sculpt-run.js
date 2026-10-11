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

function makeTurnText(reference, sculptId, continuation) {
	if (continuation) {
		return `Round ${continuation.round} of ${continuation.maxRounds}. IoU is ${continuation.iou ?? "unknown"}; rank 3-6 candidate edit sets with sculpt.compare candidates, apply the winner with object.sculpt edits${sculptId ? ` to sculpt ${sculptId}` : ""}, then sculpt.compare again.`;
	}
	return [
		"Run a measured sculpt from the attached reference image.",
		"Measure the visible outline landmarks first: limb tips, head top, and feet as fractions of the subject height.",
		"Write the recipe using object.sculpt (or patch the supplied sculpt id when given), keeping parts on those measured landmarks.",
		`Use sculpt.compare with the reference image${reference?.name ? ` (${reference.name})` : ""} and report the IoU and what the image hides.`,
		...(sculptId ? [`The existing sculpt id is ${sculptId}; patch it in place rather than creating another sculpt.`] : []),
	].join(" ");
}

/**
 * Adapt the callback-based Studio client into the small port consumed by the
 * sculpt controller. The controller deliberately owns the session/turn loop.
 */
// The sidecar's Studio envelope requires UUIDs for both the session and the turn.
export function createAgentPort(client, { sessionId = crypto.randomUUID() } = {}) {
	return {
		async *sendTurn({ text, attachments = [], signal }) {
			const events = [];
			let wake;
			let ended = false;
			const push = event => { events.push(event); wake?.(); wake = null; };
			const result = client.turn({
				surface: "studio",
				sessionId,
				turnId: crypto.randomUUID(),
				text,
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
} = {}) {
	if (!agent?.sendTurn) throw new TypeError("sculpt run requires an agent port");
	const listeners = new Set();
	const controller = new AbortController();
	let state = initialState({ targetIou, maxRounds });
	let running = false;
	let settled = false;
	let startedAt = 0;
	let turnSculpted = false;
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
				const stage = state.round > 1 ? "refine" : "draft";
				if (state.stage === stage) state = { ...state, sculptId: id, round: Math.max(1, state.round) };
				else publish({ sculptId: id, round: Math.max(1, state.round), stage, message: "Draft sculpt applied." });
			}
			return;
		}
		if (name !== "sculpt.compare" && event?.type !== "sculpt.compare") return;
		const report = result?.report ?? event?.report;
		const iou = Number(report?.iou ?? result?.iou ?? event?.iou);
		const sheet = result?.sheetDataUrl ?? event?.sheetDataUrl ?? dataUrlFromSheet(result?.sheet);
		publish({
			stage: "score",
			...(Number.isFinite(iou) ? { iou } : {}),
			...(sheet ? { sheetDataUrl: sheet } : {}),
			message: Number.isFinite(iou) ? `Sculpt comparison scored IoU ${iou}.` : "Sculpt comparison complete.",
		});
	};
	const unsubscribeBus = bus?.subscribe?.(onBus) ?? (() => {});

	const consumeTurn = async text => {
		turnSculpted = false;
		const events = [];
		let turnError = null;
		const callback = event => {
			events.push(event);
			if (event?.type === "text.delta") publish({ message: `${state.message ?? ""}${event.text ?? ""}` });
			// A refused or failed turn is the run's failure, not a turn that forgot to sculpt.
			if (event?.type === "error") turnError ??= new Error(event.message || event.code || "The agent turn failed.");
		};
		const returned = agent.sendTurn({ text, attachments: reference?.dataUrl ? [{ dataUrl: reference.dataUrl, name: reference.name }] : [], signal: controller.signal }, callback);
		if (isAsyncIterable(returned)) {
			for await (const event of returned) callback(event);
		} else await returned;
		if (turnError) throw turnError;
	};

	const loop = async () => {
		startedAt = now();
		publish({ stage: "measure", round: 0, message: INITIAL_MESSAGE, error: null });
		let text = makeTurnText(reference, sculptId, false);
		while (!controller.signal.aborted) {
			if (elapsed() >= timeBudgetMs) break;
			const roundBefore = state.round;
			turnPromise = consumeTurn(text);
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
			if (state.iou !== null && state.iou >= targetIou) break;
			if (state.round >= maxRounds || elapsed() >= timeBudgetMs) break;
			const nextRound = Math.max(1, state.round + 1);
			publish({ stage: "refine", round: nextRound, message: `Preparing refinement round ${nextRound} of ${maxRounds}.` });
			text = makeTurnText(reference, state.sculptId, { round: nextRound, maxRounds, iou: state.iou });
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
