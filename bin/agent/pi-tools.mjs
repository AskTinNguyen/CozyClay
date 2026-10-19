import { Value } from "typebox/value";
import { STUDIO_TOOL_LABELS } from "../../src/studio-agent-protocol.js";
import { toTypeBox } from "./schema-to-typebox.mjs";
import { toolArgumentPreparer } from "./tool-arguments.mjs";


function dataUrlImage(dataUrl) {
	const match = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl || "");
	return match ? { type: "image", data: match[2], mimeType: match[1] } : null;
}

function publicResult(result) {
	if (!result || typeof result !== "object" || Array.isArray(result) || !Object.hasOwn(result, "dataUrl")) return result;
	return Object.fromEntries(Object.entries(result).filter(([key]) => key !== "dataUrl"));
}

// One tool result rides whole in every later model call of its turn (studio-context-budget.mjs shrinks only older ones),
// so a result past this many characters is cut, with a note on how to ask for less. A scene-document read once
// answered 470k characters, ~300k tokens a call for the rest of that turn.
export const RESULT_CHARS = 100_000;
export function resultText(details) {
	const text = JSON.stringify(details ?? null);
	if (text.length <= RESULT_CHARS) return text;
	return `${text.slice(0, RESULT_CHARS)} … [cut: this result is ${text.length} characters, over the ${RESULT_CHARS}-character limit for one tool result. `
		+ "Ask for less: name ids, select kinds, page with cursor, or read it inside a script and return only what you need.]";
}

function recoveryHint(error) {
	const recovery = error?.receipt?.recovery;
	if (!recovery?.action || recovery.action === "none") return "";
	return ` (${recovery.action}${recovery.retryAllowed === false ? ", do not retry" : ", retry allowed"})`;
}

function formatToolError(error) {
	const code = error?.code || "BACKEND_UNAVAILABLE";
	const message = error?.message || "Tool execution failed.";
	return `${code}: ${message}${recoveryHint(error)}`;
}

/** Convert CozyClay's handler catalogue into pi AgentTools. */
export function toAgentTools(tools, { emit, signal, labels = STUDIO_TOOL_LABELS } = {}) {
	return (Array.isArray(tools) ? tools : []).map((tool) => {
		const schema = tool.parameters || { type: "object", properties: {}, additionalProperties: false }, parameters = toTypeBox(schema);
		return {
			name: tool.name,
			label: labels?.[tool.name] ?? tool.label ?? tool.name.replaceAll("_", " "),
			description: tool.description || tool.name,
			parameters,
			// Before pi's own check: array texts parsed, unknown fields named (tool-arguments.mjs).
			prepareArguments: toolArgumentPreparer(tool.name, schema),
			// pi's low-level `Agent` calls `execute(id, params, signal, onUpdate)`;
			// pi's `AgentHarness` calls `execute(id, params, onUpdate, toolContext,
			// invocation, context)` where `context.abortSignal` is the REAL abort
			// signal (dist/harness/execution/tools.js:62-66). Accept both shapes:
			// prefer `context.abortSignal`, else fall back to an AbortSignal found
			// positionally in argument 3 (the low-level path), else the adapter's
			// own fallback signal.
			execute: async (toolCallId, params, third, toolContext, invocation, context) => {
				const executeSignal = context?.abortSignal ?? (third instanceof AbortSignal ? third : undefined) ?? signal;
				if (!Value.Check(parameters, params)) {
					const first = [...Value.Errors(parameters, params)][0];
					throw Object.assign(new Error(`Invalid arguments for ${tool.name}${first ? `: ${first.keyword}: ${first.message}` : "."}`), { code: "INVALID_ARGUMENT" });
				}
				try {
					const result = await tool.handler(params, { signal: executeSignal, toolCallId, emit });
					const details = publicResult(result);
					const image = result && typeof result === "object" && !Array.isArray(result) && result.dataUrl ? dataUrlImage(result.dataUrl) : null;
					const content = [{ type: "text", text: resultText(details) }];
					if (image) content.push(image);
					return { content, details };
				} catch (error) {
					error.message = formatToolError(error);
					throw error;
				}
			},
		};
	});
}
