import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getAnalyticsOptOut, setAnalyticsOptOut } from "../analytics.js";
import { loadAutoColor, saveAutoColor } from "../auto-color.js";
import { ko, LOCALE, setLocale } from "../locale.js";
import { readStoredGridView, writeStoredGridView } from "../grid-view.js";
import { readTheme, saveTheme } from "../theme.js";
import "./preferences.css";

const LANGUAGES = [
	{ id: "en", label: "English", action: "Switch to English" },
	{ id: "ko", label: "한국어", action: "한국어로 전환" },
];

// Only pages whose settings reach the editor are listed; a control that
// changes nothing is not offered.
const NAV_GROUPS = [
	{
		label: ko("General", "일반"),
		items: [
			{ id: "Appearance", label: ko("Appearance", "모양") },
			{ id: "Viewport", label: ko("Viewport", "뷰포트") },
			{ id: "Hotkeys", label: ko("Hotkeys", "단축키") },
		],
	},
];
const NAV_LABELS = Object.fromEntries(NAV_GROUPS.flatMap((group) => group.items.map((item) => [item.id, item.label])));

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "") ? "⌘" : "Ctrl ";

const HOTKEYS = [
	["Move", "W", "이동"],
	["Rotate", "E", "회전"],
	["Scale", "R", "크기 조절"],
	["Frame selection", "F", "선택 프레임"],
	["Duplicate", `${MOD}D`, "복제"],
	["Drop to floor", "End", "바닥에 놓기"],
];

function PreferenceRow({ title, description, children, testid }) {
	return (
		<div className="v2-preferences__row" data-testid={testid}>
			<div className="v2-preferences__row-copy">
				<span className="v2-preferences__row-title">{title}</span>
				{description && <span className="v2-preferences__row-description">{description}</span>}
			</div>
			<div className="v2-preferences__row-control">{children}</div>
		</div>
	);
}

// A page with one section leaves out its title: the page header already names it.
function PreferenceSection({ title, children }) {
	return (
		<section className="v2-preferences__section">
			{title && <h2 className="v2-preferences__section-title">{title}</h2>}
			<div className="v2-preferences__section-rows">{children}</div>
		</section>
	);
}

function ToggleControl({ pressed, onChange, label, testid }) {
	return (
		<button
			type="button"
			className="v2-preferences__toggle"
			role="switch"
			aria-checked={pressed}
			aria-pressed={pressed}
			aria-label={label}
			data-testid={testid}
			onClick={() => onChange(!pressed)}
		>
			<span className="v2-preferences__toggle-thumb" aria-hidden="true" />
		</button>
	);
}

function ReadonlyHotkeys() {
	return (
		<div className="v2-preferences__hotkeys" data-testid="preferences-hotkeys">
			{HOTKEYS.map(([english, key, korean]) => (
				<div className="v2-preferences__hotkey" key={english}>
					<span>{ko(english, korean)}</span>
					<kbd>{key}</kbd>
				</div>
			))}
		</div>
	);
}

function ThemeControls() {
	const [theme, setTheme] = useState(readTheme);
	const options = [
		{ id: "dark", label: ko("Dark", "다크") },
		{ id: "light", label: ko("Light", "라이트") },
	];
	return (
		<div className="v2-preferences__language-controls" role="group" aria-label={ko("Theme", "테마")}>
			{options.map((option) => (
				<button
					type="button"
					key={option.id}
					className={"v2-preferences__language" + (theme === option.id ? " is-selected" : "")}
					data-testid={`settings-theme-${option.id}`}
					aria-pressed={theme === option.id}
					onClick={() => setTheme(saveTheme(option.id))}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

function preferenceSection(section, props) {
	const { autoColor, setAutoColor, analyticsOptOut, setAnalyticsOptOutState, gridView, setGridView } = props;
	const languageControls = (
		<div className="v2-preferences__language-controls">
			{LANGUAGES.map((language) => (
				<button
					type="button"
					key={language.id}
					className={"v2-preferences__language" + (LOCALE === language.id ? " is-selected" : "")}
					data-testid={`settings-locale-${language.id}`}
					aria-pressed={LOCALE === language.id}
					title={language.action}
					onClick={() => setLocale(language.id)}
				>
					{language.label}
				</button>
			))}
		</div>
	);

	switch (section) {
		case "Appearance":
			return (
				<>
					<PreferenceSection title={ko("Display", "표시")}>
						<PreferenceRow title={ko("Language", "언어")} description={ko("Choose the labels used throughout the editor.", "에디터에서 사용할 언어를 선택하세요.")}>
							{languageControls}
						</PreferenceRow>
						<PreferenceRow title={ko("Theme", "테마")} description={ko("Dark keeps the studio dim around the stage; Light uses bright glass panels.", "다크는 무대 주변을 어둡게, 라이트는 밝은 유리 패널을 써요.")}>
							<ThemeControls />
						</PreferenceRow>
					</PreferenceSection>
					<PreferenceSection title={ko("Editor", "에디터")}>
						<PreferenceRow title={ko("Auto colour", "자동 색")} description={ko("Give scene objects stable display colours.", "씬 오브젝트에 고정된 표시 색을 사용해요.")}>
							<ToggleControl pressed={autoColor} onChange={(value) => { setAutoColor(value); saveAutoColor(value); }} label={ko("Auto colour", "자동 색")} testid="preferences-auto-color" />
						</PreferenceRow>
						<PreferenceRow title={ko("Anonymous analytics", "익명 사용 통계")} description={ko("Help improve CozyClay with anonymous product events.", "익명 제품 이벤트로 CozyClay 개선을 도와요.")}>
							<ToggleControl
								pressed={!analyticsOptOut}
								onChange={async (value) => setAnalyticsOptOutState(await setAnalyticsOptOut(!value))}
								label={ko("Anonymous analytics", "익명 사용 통계")}
								testid="settings-analytics"
							/>
						</PreferenceRow>
					</PreferenceSection>
				</>
			);
		case "Viewport":
			return (
				<PreferenceSection>
					<PreferenceRow title={ko("Reference grid", "기준 그리드")} description={ko("Use a dark reference grid instead of the clay deck.", "클레이 데크 대신 어두운 기준 그리드를 사용해요.")}>
						<ToggleControl pressed={gridView} onChange={(value) => { setGridView(value); writeStoredGridView(globalThis.localStorage, value); }} label={ko("Reference grid", "기준 그리드")} testid="preferences-grid" />
					</PreferenceRow>
				</PreferenceSection>
			);
		case "Hotkeys":
			return (
				<PreferenceSection>
					<p className="v2-preferences__section-note">{ko("Shortcuts are read-only here. They stay active whenever focus is outside a text field.", "단축키는 여기서 읽기 전용이에요. 텍스트 입력란 밖에서 항상 사용할 수 있어요.")}</p>
					<ReadonlyHotkeys />
				</PreferenceSection>
			);
		default:
			return null;
	}
}

export default function PreferencesDialog({ open, onClose, initialSection = "Appearance" }) {
	const dialogRef = useRef(null);
	const searchRef = useRef(null);
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	const [activeSection, setActiveSection] = useState(initialSection);
	const [query, setQuery] = useState("");
	const [analyticsOptOut, setAnalyticsOptOutState] = useState(getAnalyticsOptOut);
	const [autoColor, setAutoColor] = useState(() => loadAutoColor());
	const [gridView, setGridView] = useState(() => readStoredGridView(globalThis.localStorage));

	const filteredGroups = useMemo(() => {
		const term = query.trim().toLocaleLowerCase();
		if (!term) return NAV_GROUPS;
		return NAV_GROUPS.map((group) => ({
			...group,
			items: group.items.filter((item) => item.label.toLocaleLowerCase().includes(term)),
		})).filter((group) => group.items.length > 0);
	}, [query]);

	useEffect(() => {
		if (!open) return undefined;
		setActiveSection(initialSection);
		setQuery("");
		const frame = requestAnimationFrame(() => searchRef.current?.focus());
		const onKeyDown = (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				closeRef.current?.();
				return;
			}
			if (event.key !== "Tab") return;
			const focusable = [...dialogRef.current?.querySelectorAll("button:not([disabled]), input:not([disabled]), [tabindex=\"0\"]") ?? []];
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable.at(-1);
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open, initialSection]);

	if (!open || typeof document === "undefined") return null;
	const currentProps = { autoColor, setAutoColor, analyticsOptOut, setAnalyticsOptOutState, gridView, setGridView };

	return createPortal(
		<div className="v2-preferences" data-testid="preferences-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) closeRef.current?.(); }}>
			<div
				className="v2-preferences__dialog settings-menu"
				role="dialog"
				aria-modal="true"
				aria-labelledby="v2-preferences-title"
				ref={dialogRef}
				tabIndex={-1}
			>
				<aside className="v2-preferences__nav" aria-label={ko("Preferences navigation", "환경설정 탐색")}>
					<div className="v2-preferences__nav-title-row">
						<strong className="v2-preferences__nav-title">{ko("Preferences", "환경설정")}</strong>
						<button type="button" className="v2-preferences__close" data-testid="preferences-close" onClick={() => closeRef.current?.()} aria-label={ko("Close preferences", "환경설정 닫기")}>×</button>
					</div>
					<label className="v2-preferences__search">
						<span className="v2-preferences__search-icon" aria-hidden="true">⌕</span>
						<input ref={searchRef} data-testid="preferences-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={ko("Search", "검색")} aria-label={ko("Search preferences", "환경설정 검색")} />
					</label>
					<nav className="v2-preferences__nav-list" aria-label={ko("Preference sections", "환경설정 섹션")}>
						{filteredGroups.map((group) => (
							<div className="v2-preferences__nav-group" key={group.label}>
								<h2 className="v2-preferences__nav-group-title" data-testid="preferences-nav-group">{group.label}</h2>
								{group.items.map((item) => (
									<button
										type="button"
										key={item.id}
										className={"v2-preferences__nav-item" + (activeSection === item.id ? " is-active" : "")}
										data-testid="preferences-nav-item"
										aria-current={activeSection === item.id ? "page" : undefined}
										onClick={() => setActiveSection(item.id)}
									>
										{item.label}
									</button>
								))}
							</div>
						))}
					</nav>
				</aside>
				<main className="v2-preferences__content">
					<header className="v2-preferences__content-header">
						<h1 id="v2-preferences-title">{NAV_LABELS[activeSection] ?? activeSection}</h1>
					</header>
					<div className="v2-preferences__content-scroll">
						{preferenceSection(activeSection, currentProps)}
					</div>
				</main>
			</div>
		</div>,
		document.body,
	);
}
