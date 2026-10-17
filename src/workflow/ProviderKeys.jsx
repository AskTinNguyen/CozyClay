import { useState } from "react";
import { providerEnvLabel } from "./agent-client.js";

// One provider's credential row (moved out of AgentPanel.jsx for the first-run pass). The key lives in this
// component and nowhere else: it is typed into a password field, handed to the transport once and dropped
// the moment the sidecar accepts it, so no store, no transcript and no screenshot can ever carry it. The
// sidecar answers with the SOURCE of a key (env / file), never with a key, which is what the row reports.
// The sidecar checks a key with its provider before keeping it: a refused key comes back as the error under
// the input, and a key it could not check (offline) is kept with a warning shown the same way.
// A provider a user runs themselves (CLIProxyAPI) also carries its server address: an app opened from the
// Dock has no shell to set CLIPROXY_BASE_URL in, so the address is typed here and kept on this machine.

function KeyDot({ tone, title }) {
	return <span className={`agent-status-dot ${tone}`} title={title} aria-hidden="true" />;
}

function EndpointField({ provider, onSave }) {
	const endpoint = provider.endpoint;
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const fromEnv = endpoint.source === "env";
	const inputId = `agent-endpoint-${provider.id}`;
	const run = async (url) => {
		setBusy(true);
		setError("");
		try {
			await onSave(provider.id, url);
			setDraft("");
		} catch (failure) {
			setError(failure?.message || "The sidecar refused that address.");
		} finally {
			setBusy(false);
		}
	};
	return <div className="agent-key-endpoint">
		<label className="agent-key-endpoint-label" htmlFor={inputId}>Server</label>
		<div className="agent-key-controls">
			<input
				id={inputId}
				className="agent-key-input"
				type="url"
				autoComplete="off"
				spellCheck="false"
				aria-label={`${provider.label} server address`}
				placeholder={fromEnv ? `${endpoint.url} (set by ${endpoint.env})` : endpoint.url}
				disabled={fromEnv || busy}
				value={draft}
				onChange={(event) => { setDraft(event.target.value); setError(""); }}
			/>
			<button type="button" className="agent-key-save" disabled={fromEnv || busy || !draft.trim()} onClick={() => run(draft)}>Save</button>
			{endpoint.source === "file" && <button type="button" className="agent-ghost-button agent-key-remove" disabled={busy} onClick={() => run("")}>Reset</button>}
		</div>
		<p className="agent-key-note">{fromEnv ? `The address comes from ${endpoint.env}.` : endpoint.source === "file" ? "Saved on this machine." : `Default address; save another if your server runs elsewhere.`}</p>
		{error && <p className="agent-key-error" role="alert">{error}</p>}
	</div>;
}

export function ProviderKeyRow({ provider, onSave, onRemove, onEndpoint }) {
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [warning, setWarning] = useState("");
	const fromEnv = provider.authSource === "env";
	const fromFile = provider.authSource === "file";
	const envLabel = `set by ${providerEnvLabel(provider.id)}`;
	const inputId = `agent-key-${provider.id}`;
	const run = async (action) => {
		setBusy(true);
		setError("");
		setWarning("");
		try {
			const result = await action();
			// The key is gone from the page the instant it is stored.
			setDraft("");
			if (typeof result?.warning === "string") setWarning(result.warning);
		} catch (failure) {
			// The sidecar's own refusal (a provider that rejected the key says so), which never quotes key material.
			setError(failure?.message || "The sidecar refused that key.");
		} finally {
			setBusy(false);
		}
	};
	return <div className="agent-key-row" data-provider={provider.id} data-provider-source={provider.authSource || "none"} data-provider-signed-in={provider.signedIn ? "true" : "false"}>
		<div className="agent-key-head">
			<KeyDot tone={provider.signedIn ? "ok" : ""} title={provider.signedIn ? "key configured" : "no key"} />
			<label className="agent-key-label" htmlFor={inputId}>{provider.label}</label>
			{/* The head states WHERE the key lives in two words; the variable's own
			    name belongs on the input it replaces, where there is room for it. */}
			<span className="agent-key-source">{fromEnv ? "environment" : fromFile ? "saved on this machine" : "no key"}</span>
		</div>
		{provider.endpoint && onEndpoint && <EndpointField provider={provider} onSave={onEndpoint} />}
		<div className="agent-key-controls">
			<input
				id={inputId}
				className="agent-key-input"
				type="password"
				autoComplete="off"
				spellCheck="false"
				aria-label={`${provider.label} API key`}
				placeholder={fromEnv ? envLabel : provider.signedIn ? "Replace key" : "Paste API key"}
				disabled={fromEnv || busy}
				value={draft}
				onChange={(event) => { setDraft(event.target.value); setError(""); }}
			/>
			<button type="button" className="agent-key-save" disabled={fromEnv || busy || !draft.trim()} onClick={() => run(() => onSave(provider.id, draft))}>{busy ? "Checking…" : "Save"}</button>
			{fromFile && <button type="button" className="agent-ghost-button agent-key-remove" disabled={busy} onClick={() => run(() => onRemove(provider.id))}>Remove</button>}
		</div>
		{error && <p className="agent-key-error" role="alert">{error}</p>}
		{warning && <p className="agent-key-note" role="status">{warning}</p>}
	</div>;
}
