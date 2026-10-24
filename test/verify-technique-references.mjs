// Technique references (docs/intent/technique-references): the committed
// citation data covers every size, angle and move technique, every coverage
// pattern and every cut rule (a ref or a listed "none"), holds the allowed
// citation fields only, short strings, camera and directing books only, and
// no machine path; tools/atlas-refs.mjs rebuilds it deterministically, shown
// on a small committed fixture (test/fixtures/atlas-refs), never the atlas.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TECHNIQUES } from "../src/camera-techniques/index.js";
import { COVERAGE_PATTERN_IDS } from "../src/camera-coverage/patterns.js";
import { CUT_RULES } from "../src/camera-coverage/cut-rules.js";
import { NO_REFERENCES, REFERENCE_BOOKS, REFERENCES } from "../src/camera-references/data.js";
import { atlasPageHref, normalizeAtlasUrl, readAtlasUrl, referenceDigest, referencesFor, writeAtlasUrl } from "../src/camera-references/index.js";
import { BOOKS } from "../tools/atlas-refs-table.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("ok -", name); };
const SECTIONS = { techniques: TECHNIQUES.map((entry) => entry.id), patterns: [...COVERAGE_PATTERN_IDS], cuts: [...CUT_RULES] };
const REQUIRED = { techniques: TECHNIQUES.filter((entry) => ["size", "angle", "move", "lens"].includes(entry.kind)).map((entry) => entry.id), patterns: SECTIONS.patterns, cuts: SECTIONS.cuts };

check("every size, angle and move technique, coverage pattern and cut rule has a ref or is listed as having none, never both", () => {
	for (const [section, ids] of Object.entries(SECTIONS)) {
		for (const id of ids) {
			const has = Boolean(REFERENCES[section][id]?.length), none = NO_REFERENCES[section].includes(id);
			assert.ok(has !== none, `${section} ${id}: ${has ? "has refs and is listed as none" : "neither refs nor listed as none"}`);
		}
		for (const id of [...Object.keys(REFERENCES[section]), ...NO_REFERENCES[section]]) assert.ok(ids.includes(id), `${section} ${id} is not in the catalog`);
	}
	for (const [section, ids] of Object.entries(REQUIRED)) assert.ok(ids.length > 0 && ids.every((id) => SECTIONS[section].includes(id)), section);
	const cited = Object.values(REFERENCES).reduce((sum, rows) => sum + Object.keys(rows).length, 0);
	assert.ok(cited >= 40, `only ${cited} entries cite a page`);
	for (const id of ["close-up", "push-in", "pan-shot", "over-the-shoulder"]) assert.ok(REFERENCES.techniques[id]?.length, id);
	for (const id of ["shot-reverse-shot", "master-coverage"]) assert.ok(REFERENCES.patterns[id]?.length, id);
	assert.ok(REFERENCES.cuts.line?.length && REFERENCES.cuts.eyeline?.length);
});

check("citations hold the allowed fields only, short strings, camera and directing books only", () => {
	const allowed = new Set(BOOKS.map((book) => book.id));
	for (const book of REFERENCE_BOOKS) {
		assert.deepEqual(Object.keys(book), ["id", "title", "author", "edition", "year"], book.id);
		assert.ok(allowed.has(book.id), `${book.id} is not a camera or directing book in atlas-refs-table.mjs`);
		assert.match(book.id, /^[a-z0-9-]{3,60}$/);
		assert.ok(typeof book.title === "string" && book.title.length > 0 && book.title.length <= 100, `${book.id} title`);
		assert.ok(typeof book.author === "string" && book.author.length > 0 && book.author.length <= 60, `${book.id} author`);
		assert.ok(book.edition === null || (typeof book.edition === "string" && book.edition.length <= 40), `${book.id} edition`);
		assert.ok(book.year === null || (Number.isInteger(book.year) && book.year > 1800 && book.year < 2100), `${book.id} year`);
	}
	const ids = new Set(REFERENCE_BOOKS.map((book) => book.id));
	for (const rows of Object.values(REFERENCES)) {
		for (const [id, refs] of Object.entries(rows)) {
			assert.ok(refs.length >= 1 && refs.length <= 3, `${id} ref count`);
			for (const ref of refs) {
				assert.deepEqual(Object.keys(ref), ["book", "pages"], id);
				assert.ok(ids.has(ref.book), `${id} cites unknown book ${ref.book}`);
				assert.ok(ref.pages.length >= 1 && ref.pages.length <= 2 && ref.pages.every((page) => Number.isInteger(page) && page > 0), `${id} pages`);
			}
		}
	}
	const text = readFileSync(join(root, "src/camera-references/data.js"), "utf8");
	assert.ok(text.length < 16000, `data.js is ${text.length} bytes`);
	assert.doesNotMatch(text, /excerpt|source-pdfs|\.pdf|\.epub|[A-Za-z]:\\|\/home\/|\/Users\/|file:/i);
});

check("references read back as citations with a cite line; links follow the atlas reader's route", () => {
	const refs = referencesFor("techniques", "close-up");
	assert.ok(refs.length >= 1);
	for (const ref of refs) {
		assert.ok(ref.cite.startsWith(`${ref.author}, ${ref.title}`) && ref.cite.includes(`p. ${ref.pages.join(", ")}`) && ref.cite.length <= 200, ref.cite);
	}
	assert.deepEqual(referencesFor("techniques", "no-such-technique"), []);
	assert.ok(referencesFor("patterns", "shot-reverse-shot").length && referencesFor("cuts", "line").length);
	const digest = referenceDigest();
	assert.equal(digest.books.length, REFERENCE_BOOKS.length);
	assert.ok(digest.techniques.some((row) => row.startsWith("close-up: ")) && digest.cuts.some((row) => row.startsWith("line: ")));
	assert.ok(JSON.stringify(digest).length < 8192, "the digest fits one 8 KiB receipt");
	assert.equal(normalizeAtlasUrl("http://127.0.0.1:8000"), "http://127.0.0.1:8000/");
	assert.equal(normalizeAtlasUrl(" https://atlas.example/study/?q=1#/camera "), "https://atlas.example/study/");
	for (const bad of ["", "javascript:alert(1)", "file:///atlas", "not a url", null]) assert.equal(normalizeAtlasUrl(bad), null, String(bad));
	assert.equal(atlasPageHref("http://127.0.0.1:8000/", "master-shots-vol2", 22), "http://127.0.0.1:8000/#/book/master-shots-vol2/22");
	const store = new Map(), storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
	assert.equal(readAtlasUrl(storage), null);
	assert.equal(writeAtlasUrl("http://localhost:8000", storage), "http://localhost:8000/");
	assert.equal(readAtlasUrl(storage), "http://localhost:8000/");
	assert.equal(writeAtlasUrl("", storage), null);
	assert.equal(readAtlasUrl(storage), null);
	const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
	assert.equal(readAtlasUrl(blocked), null);
	assert.equal(writeAtlasUrl("http://localhost:8000", blocked), "http://localhost:8000/");
});

// A2: the generator on the committed fixture, twice, into a temp file.
const work = mkdtempSync(join(tmpdir(), "atlas-refs-"));
try {
	const run = (name) => {
		const out = join(work, name);
		const log = execFileSync(process.execPath, [join(root, "tools/atlas-refs.mjs"), "--out", out], {
			cwd: root, encoding: "utf8", env: { ...process.env, ATLAS_DIR: join(root, "test/fixtures/atlas-refs") } });
		return { log, text: readFileSync(out, "utf8"), out };
	};
	const first = run("a.js"), second = run("b.js");
	check("the generator rewrites the data deterministically from a fixture atlas", () => {
		assert.match(first.log, /^atlas-refs: 4 entries with references, 71 without, 2 books -> /);
		assert.equal(first.text, second.text);
	});
	const generated = await import(pathToFileURL(first.out).href);
	check("the fixture output: scored pages, at most two pages per book, citable books only, nothing but citations", () => {
		assert.deepEqual(generated.REFERENCE_BOOKS, [
			{ id: "film-directing-shot-by-shot", title: "Fixture Camera Handbook", author: "A. Fixture", edition: "25th anniversary edition", year: 2001 },
			{ id: "master-shots-vol2", title: "Fixture Dialogue Primer", author: "B. Fixture", edition: null, year: 2002 },
		]);
		assert.deepEqual(generated.REFERENCES.techniques, {
			"close-up": [{ book: "film-directing-shot-by-shot", pages: [3, 4] }, { book: "master-shots-vol2", pages: [6] }],
			"pan-shot": [{ book: "film-directing-shot-by-shot", pages: [12, 20] }],
		});
		assert.deepEqual(generated.REFERENCES.patterns, { "dialogue-singles": [{ book: "film-directing-shot-by-shot", pages: [3, 4] }, { book: "master-shots-vol2", pages: [6] }] });
		assert.deepEqual(generated.REFERENCES.cuts, { line: [{ book: "master-shots-vol2", pages: [2] }] });
		assert.equal(generated.NO_REFERENCES.techniques.length, TECHNIQUES.length - 2);
		assert.ok(generated.NO_REFERENCES.cuts.includes("jump") && !generated.NO_REFERENCES.cuts.includes("line"));
		assert.doesNotMatch(first.text, /FIXTURE EXCERPT|FIXTURE PAGE TITLE|FIXTURE-SOURCE-NAME|Fixture Novel|fixture-novel|Pan Studies|Crossing Lines/);
	});
	check("the generator refuses to run without ATLAS_DIR", () => {
		const env = { ...process.env }; delete env.ATLAS_DIR;
		assert.throws(() => execFileSync(process.execPath, [join(root, "tools/atlas-refs.mjs"), "--out", join(work, "c.js")], { cwd: root, env, stdio: "pipe" }), /status 2|ATLAS_DIR/);
	});
} finally {
	rmSync(work, { recursive: true, force: true });
}
console.log(`\n${passed} checks passed`);
