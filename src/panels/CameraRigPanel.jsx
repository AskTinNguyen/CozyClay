import { useState } from "react";
import Foldout from "./Foldout.jsx";
import { ko } from "../locale.js";
import { useBus } from "../app-context.js";
import { useStudioShell } from "../shell/studio-shell-context.js";
import { F_STOPS, MOUNT_BONES, SHAKE_STYLES, SHUTTER_ANGLES } from "../camera-capabilities/fields.js";
import { speedLabel } from "../camera-capabilities/speed.js";
import "./camera-rig.css";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2];
const castName = (row) => (row.subject ?? row.name ?? row.id).split(",")[0];

/** A number that commits on Enter or when the field loses focus, so typing "20" is one edit, not two. */
function NumberCommit({ name, value, min, max, step, onCommit }) {
	const [draft, setDraft] = useState(null);
	const commit = () => {
		if (draft === null) return;
		const number = draft.trim() === "" ? null : Number(draft);
		setDraft(null);
		if (number === null || Number.isFinite(number)) onCommit(number === null ? null : Math.max(min, Math.min(max, number)));
	};
	return (
		<input data-camera-rig-field={name} type="number" min={min} max={max} step={step} value={draft ?? (value ?? "")} placeholder="—"
			onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") commit(); }} />
	);
}

/**
 * The shot camera's capabilities (camera-capabilities): roll, aperture and
 * focus, shake, body mount, speed and shutter, each a camera.set on the
 * selected shot, plus roll and focus rig keys at the playhead (camera.setKey),
 * which the timeline camera lane shows beside the framing keys.
 */
export default function CameraRigPanel({ hidden, activeShot }) {
	const { run } = useBus();
	const { characters = [], tlFrame = 0 } = useStudioShell() ?? {};
	const [status, setStatus] = useState(null);
	const camera = activeShot?.camera ?? {}, cast = characters.filter((row) => !row.hidden);
	const lens = camera.lens ?? {}, shake = camera.shake ?? null, mount = camera.mount ?? null;
	const focusValue = lens.focusTarget ?? (lens.focusDistance ? "distance" : "");
	function send(action, args) {
		if (!activeShot) return;
		const receipt = run(action, { shotId: activeShot.id, ...args });
		setStatus(receipt?.ok ? { ok: true, text: receipt.summary } : { ok: false, text: receipt?.message ?? "" });
	}
	const set = (patch) => send("camera.set", patch);
	const inShot = activeShot && tlFrame >= activeShot.startFrame && tlFrame <= activeShot.endFrame;
	const row = (label, control, unit = null) => (
		<label className="camera-rig-row"><span>{label}</span>{control}{unit && <small>{unit}</small>}</label>
	);
	return (
		<Foldout hidden={hidden} title={ko("Camera rig", "카메라 리그")}>
			<div className="camera-rig" data-camera-rig={activeShot?.id ?? ""}>
				{!activeShot && <p className="inspector-hint v2-details-hint">{ko("Select a shot first.", "먼저 샷을 선택하세요.")}</p>}
				{row(ko("Roll", "롤"), <NumberCommit name="roll" value={camera.rollDeg} min={-90} max={90} step={1} onCommit={(rollDeg) => set({ rollDeg })} />, "°")}
				{row(ko("Aperture", "조리개"), (
					<select data-camera-rig-field="fstop" value={lens.fStop ?? ""} disabled={!activeShot} onChange={(event) => set({ lens: { fStop: event.target.value ? Number(event.target.value) : null } })}>
						<option value="">{ko("Off (all sharp)", "끔 (전부 선명)")}</option>
						{F_STOPS.map((value) => <option key={value} value={value}>f/{value}</option>)}
					</select>
				))}
				{row(ko("Focus", "초점"), (
					<select data-camera-rig-field="focus" value={focusValue} disabled={!activeShot}
						onChange={(event) => set({ lens: event.target.value === "distance" ? { focusTarget: null, focusDistance: lens.focusDistance ?? 3 } : { focusTarget: event.target.value || null, focusDistance: null } })}>
						<option value="">{ko("The subject", "피사체")}</option>
						{cast.map((member) => <option key={member.id} value={member.id}>{castName(member)}</option>)}
						<option value="distance">{ko("A distance", "거리")}</option>
					</select>
				))}
				{focusValue === "distance" && row(ko("Distance", "거리"), <NumberCommit name="focus-distance" value={lens.focusDistance} min={0.05} max={1000} step={0.1} onCommit={(focusDistance) => set({ lens: { focusDistance } })} />, "m")}
				{row(ko("Shake", "흔들림"), (
					<select data-camera-rig-field="shake" value={shake?.style ?? ""} disabled={!activeShot}
						onChange={(event) => set({ shake: event.target.value ? { style: event.target.value, amplitude: shake?.amplitude ?? 0.4, seed: shake?.seed ?? 1 } : null })}>
						<option value="">{ko("Off", "끔")}</option>
						{SHAKE_STYLES.map((style) => <option key={style} value={style}>{style === "handheld" ? ko("Handheld", "핸드헬드") : ko("Vehicle", "차량")}</option>)}
					</select>
				))}
				{shake && row(ko("Amount", "세기"), <NumberCommit name="shake-amplitude" value={shake.amplitude} min={0.05} max={1} step={0.05} onCommit={(amplitude) => set({ shake: { ...shake, amplitude: amplitude ?? shake.amplitude } })} />, "0-1")}
				{row(ko("Mount", "마운트"), (
					<select data-camera-rig-field="mount" value={mount?.characterId ?? ""} disabled={!activeShot}
						onChange={(event) => set({ mount: event.target.value ? { characterId: event.target.value, bone: mount?.bone ?? "chest" } : null })}>
						<option value="">{ko("Off", "끔")}</option>
						{cast.map((member) => <option key={member.id} value={member.id}>{castName(member)}</option>)}
					</select>
				))}
				{mount && row(ko("Bone", "본"), (
					<select data-camera-rig-field="mount-bone" value={mount.bone} onChange={(event) => set({ mount: { characterId: mount.characterId, bone: event.target.value } })}>
						{MOUNT_BONES.map((bone) => <option key={bone} value={bone}>{bone}</option>)}
					</select>
				))}
				{row(ko("Speed", "속도"), (
					<select data-camera-rig-field="speed" value={camera.speed ?? 1} disabled={!activeShot} onChange={(event) => set({ speed: Number(event.target.value) === 1 ? null : Number(event.target.value) })}>
						{SPEEDS.map((value) => <option key={value} value={value}>{value === 1 ? ko("1× (normal)", "1× (보통)") : `${value}×${value < 1 ? ko(" slow motion", " 슬로모션") : ""}`}</option>)}
					</select>
				))}
				{row(ko("Shutter", "셔터"), (
					<select data-camera-rig-field="shutter" value={camera.shutterDeg ?? ""} disabled={!activeShot} onChange={(event) => set({ shutterDeg: event.target.value ? Number(event.target.value) : null })}>
						<option value="">{ko("Off (no blur)", "끔 (블러 없음)")}</option>
						{SHUTTER_ANGLES.map((value) => <option key={value} value={value}>{value}°</option>)}
					</select>
				))}
				<div className="camera-rig-keys">
					<button type="button" data-camera-rig-key="roll" disabled={!inShot} title={ko("Key the roll above at the playhead", "위의 롤 값을 재생 헤드에 키로")}
						onClick={() => send("camera.setKey", { frame: tlFrame, rollDeg: camera.rollDeg ?? 0 })}>{ko("Key roll", "롤 키")}</button>
					<button type="button" data-camera-rig-key="focus" disabled={!inShot || !lens.focusTarget} title={ko("Key the focus target at the playhead (two keys rack focus)", "초점 대상을 재생 헤드에 키로 (키 두 개 = 랙 포커스)")}
						onClick={() => send("camera.setKey", { frame: tlFrame, focus: { targetId: lens.focusTarget } })}>{ko("Key focus", "초점 키")}</button>
					{speedLabel(activeShot) && <small data-camera-rig-speed>{speedLabel(activeShot)}</small>}
				</div>
				{(camera.rigKeys ?? []).length > 0 && (
					<ul className="camera-rig-key-list" data-camera-rig-keys={camera.rigKeys.length}>
						{camera.rigKeys.map((key) => (
							<li key={key.offset}>
								<span>{ko("Frame", "프레임")} {activeShot.startFrame + key.offset}</span>
								<span>{[Number.isFinite(key.rollDeg) ? `${key.rollDeg}°` : null, key.focus ? (key.focus.targetId ? castName(cast.find((member) => member.id === key.focus.targetId) ?? { id: key.focus.targetId }) : `${key.focus.distance} m`) : null].filter(Boolean).join(" · ")}</span>
								<button type="button" data-camera-rig-remove={key.offset} title={ko("Remove this key", "이 키 지우기")}
									onClick={() => send("camera.setKey", { frame: activeShot.startFrame + key.offset, remove: true })}>×</button>
							</li>
						))}
					</ul>
				)}
				{status && <p className={status.ok ? "camera-rig-status" : "camera-rig-status refused"} data-camera-rig-status role="status">{status.text}</p>}
			</div>
		</Foldout>
	);
}
