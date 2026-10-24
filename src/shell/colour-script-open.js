// Whether File > Export > Colour script is open: a tiny store the menu item
// sets and the dialog (mounted once by StudioShell) reads, like director-packet-open.js.
let open = false;
const listeners = new Set();

export const colourScriptOpen = Object.freeze({
	get: () => open,
	set(next) { open = Boolean(next); for (const listener of listeners) listener(); },
	subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
});
