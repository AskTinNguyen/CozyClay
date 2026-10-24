#!/usr/bin/env node
// Browser contract for technique references (docs/intent/technique-references A3):
// the technique popover's Further reading lists book citations as plain text;
// once the atlas URL is set each page links to <atlas URL>#/book/<id>/<page>
// (the Coverage pattern's reading too); the setting survives a reload and
// clearing it brings plain text back. QA_SHOT_DIR saves the proof screenshots.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterPageLoad } from "./bus/browser-navigation.mjs";
import { waitForFrameState } from "./bus/browser-frame-state.mjs";
import { SCENES_STORAGE_KEY } from "../src/scenes.js";
import { referencesFor } from "../src/camera-references/index.js";

const port = Number(process.env.CDP_PORT || 9222);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
if (!page) throw new Error("no page target on the QA browser");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
	const message = JSON.parse(event.data);
	if (!message.id || !pending.has(message.id)) return;
	const { resolve, reject } = pending.get(message.id);
	pending.delete(message.id);
	if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
};
const send = (method, params = {}) => afterPageLoad(ws, method, () => new Promise((resolve, reject) => {
	const id = nextId++;
	pending.set(id, { resolve, reject });
	ws.send(JSON.stringify({ id, method, params }));
}));
const evaluate = async (expression) => {
	const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "evaluate failed");
	return result.result.value;
};
const waitFor = (expression, timeoutMs = 15000) => waitForFrameState(evaluate, expression, timeoutMs);
let failures = 0;
const expect = (name, condition, detail = "") => {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
};
const shot = async (name) => {
	if (!process.env.QA_SHOT_DIR) return;
	const capture = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
	writeFileSync(join(process.env.QA_SHOT_DIR, name), Buffer.from(capture.data, "base64"));
	console.log(`saved ${name}`);
};
const clipShot = async (name, selector) => {
	if (!process.env.QA_SHOT_DIR) return;
	const rect = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`);
	if (!rect) return;
	const pad = 12, clip = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.width + 2 * pad, height: rect.height + 2 * pad, scale: 2 };
	const capture = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: false });
	writeFileSync(join(process.env.QA_SHOT_DIR, name), Buffer.from(capture.data, "base64"));
	console.log(`saved ${name}`);
};
// React listens for the native input event; set the value through the prototype setter.
const typeInto = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
	Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, ${JSON.stringify(value)});
	el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); return true; })()`);
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
/** The rendered citations of one Further reading block: per book, its page links (href) or plain pages. */
const readBlock = (id) => evaluate(`(() => { const block = document.querySelector('[data-further-reading="${id}"]'); if (!block) return null;
	return { linked: block.dataset.atlasLinked, none: !!block.querySelector('[data-reference-none]'),
		books: [...block.querySelectorAll('[data-reference-book]')].map((li) => ({ book: li.dataset.referenceBook, text: li.textContent,
			links: [...li.querySelectorAll('a[data-reference-page]')].map((a) => a.getAttribute('href')),
			plain: [...li.querySelectorAll('span[data-reference-page]')].map((span) => Number(span.dataset.referencePage)) })) }; })()`);

const ATLAS = "http://127.0.0.1:8000/";
// The popover re-renders while the studio settles (the rig loads); type until the field holds the value, then Set.
async function setAtlasUrl(value) {
	const stored = JSON.stringify(value ? `${value.replace(/\/$/, "")}/` : null);
	for (let attempt = 0; attempt < 5; attempt++) {
		await typeInto("[data-atlas-url]", value);
		await waitFor(`document.querySelector('[data-atlas-url]')?.value === ${JSON.stringify(value)}`, 2000);
		await click("[data-atlas-url-save]");
		if (await waitFor(`localStorage.getItem('cozyclay.atlasUrl') === ${stored}`, 2000)) return;
	}
}
const expected = referencesFor("techniques", "close-up");
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
const studioUrl = process.env.QA_URL ?? "http://127.0.0.1:5180/app/";
await send("Page.navigate", { url: `${new URL(studioUrl).origin}/favicon.ico` });
await evaluate(`(() => {
	const shot = { id: "references-qa", name: "Reading", startFrame: 0, endFrame: 119, kind: "clip",
		cameraKeys: [{ id: "key-0", frame: 0, framing: { pos: { x: 1.5, y: 1.6, z: 4.5 }, yaw: 0.32, pitch: -0.05, fovDeg: 40 } }], camera: { mode: "keys" } };
	const scene = { version: 4, activeSceneId: "scene-references-qa", scenes: [{ id: "scene-references-qa", name: "REFERENCES QA", objects: [],
		shotDocument: { version: 5, frameCount: 120, shots: [shot], waypoints: [] },
		stage: { characters: [{ id: "char-a", model: "y-bot-tpose", x: 0, z: 0, rot: 0, hidden: false, pose: null, subject: "a woman in a red coat" },
			{ id: "char-b", model: "x-bot-tpose", x: 1.6, z: 1.5, rot: -135, hidden: false, pose: null, subject: "a man in a grey suit" }], hasCharSheet: false, shotAspect: "16:9" } }] };
	localStorage.clear();
	localStorage.setItem("cozyclay.locale", "en");
	localStorage.setItem("cozyclay.project-session.v1", JSON.stringify({ name: "References QA", updatedAt: Date.now() }));
	localStorage.setItem("${SCENES_STORAGE_KEY}", JSON.stringify(scene));
})()`);
await send("Page.navigate", { url: studioUrl });
expect("studio renders", await waitFor("!!document.querySelector('canvas')"));
expect("the shot block renders", await waitFor("!!document.querySelector('.tl-shot-block')"));
await click(".tl-shot-block");
expect("Camera mode shows the Techniques picker", await waitFor("!!document.querySelector('[data-technique-picker]')"));
await click("[data-technique-id='close-up']");
expect("the technique popover shows Further reading", await waitFor("!!document.querySelector('[data-technique-detail=\"close-up\"] [data-further-reading=\"close-up\"]')"));

// No atlas URL: citations as plain text, no links.
let block = await readBlock("close-up");
expect("without an atlas URL the block is unlinked", block?.linked === "no" && !block.none, JSON.stringify(block));
expect("each citation shows author, title and its pages as plain text", block?.books.length === expected.length && block.books.every((row, i) => row.book === expected[i].book
	&& row.text.startsWith(`${expected[i].author}, ${expected[i].title}`) && row.links.length === 0 && JSON.stringify(row.plain) === JSON.stringify(expected[i].pages)), JSON.stringify(block));
await evaluate("document.querySelector('[data-technique-detail]')?.scrollIntoView({ block: 'end' })");
await clipShot("further-reading-plain.png", "[data-technique-detail]");

// Set the atlas URL: every page becomes <atlas URL>#/book/<id>/<page>.
await setAtlasUrl("http://127.0.0.1:8000");
expect("setting the atlas URL links the citations", await waitFor("document.querySelector('[data-further-reading=\"close-up\"]')?.dataset.atlasLinked === 'yes'"));
block = await readBlock("close-up");
expect("each page links to the atlas reader's book page", block?.books.every((row, i) => row.plain.length === 0
	&& JSON.stringify(row.links) === JSON.stringify(expected[i].pages.map((page) => `${ATLAS}#/book/${expected[i].book}/${page}`))), JSON.stringify(block));
expect("links open in a new tab", await evaluate("[...document.querySelectorAll('[data-further-reading] a[data-reference-page]')].every((a) => a.target === '_blank' && a.rel === 'noreferrer')"));
expect("the setting is remembered for this viewer", await evaluate("localStorage.getItem('cozyclay.atlasUrl')") === ATLAS);
expect("the Coverage pattern's reading links too", await waitFor("document.querySelector('[data-further-reading=\"shot-reverse-shot\"]')?.dataset.atlasLinked === 'yes' && !!document.querySelector('[data-further-reading=\"shot-reverse-shot\"] a[href^=\"http://127.0.0.1:8000/#/book/\"]')"));
await evaluate("document.querySelector('[data-technique-detail]')?.scrollIntoView({ block: 'end' })");
await shot("further-reading-studio.png");
await clipShot("further-reading-linked.png", "[data-technique-detail]");

// A technique the atlas has no page for says so.
await click("[data-technique-id='trunk-shot']");
block = await waitFor("!!document.querySelector('[data-further-reading=\"trunk-shot\"] [data-reference-none]')");
expect("a technique without a page says the atlas has none", block);

// Reload keeps the URL; clearing it returns to plain text.
await send("Page.reload");
expect("studio renders again", await waitFor("!!document.querySelector('.tl-shot-block')"));
await click(".tl-shot-block");
await waitFor("!!document.querySelector('[data-technique-picker]')");
await click("[data-technique-id='close-up']");
expect("after a reload the citations still link", await waitFor("document.querySelector('[data-further-reading=\"close-up\"]')?.dataset.atlasLinked === 'yes'"));
await setAtlasUrl("");
expect("clearing the URL turns links back into plain text", await waitFor("document.querySelector('[data-further-reading=\"close-up\"]')?.dataset.atlasLinked === 'no' && !document.querySelector('[data-further-reading] a[data-reference-page]')"));
expect("and forgets it", await evaluate("localStorage.getItem('cozyclay.atlasUrl')") === null);
ws.close();
if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("technique references browser QA passed");
