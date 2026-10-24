// Whether File > Export > Director packet is open: a tiny store the menu item
// sets and the dialog (mounted once by StudioShell) reads, so App keeps no
// state for it.
let open = false;
const listeners = new Set();

export const directorPacketOpen = Object.freeze({
	get: () => open,
	set(next) { open = Boolean(next); for (const listener of listeners) listener(); },
	subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
});
