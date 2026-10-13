import Foldout from "./Foldout.jsx";
import { ko, isKo } from "../locale.js";
import { HIERARCHY_INSPECTOR_TITLES, lineTrackLabel } from "../app-stage.jsx";
import { Field } from "../ui.jsx";
import { RangePinPanel } from "../range-pin-panel.jsx";
import { TRAIL_TRACKS } from "../motion-trail.js";
import "./pose.css";

export default function RigControlPanel({
 isRigSelection, rigSelection, ikChains, ikFocus, footSnap, ikMode, poseObjectOpacity = 0.2, setPoseObjectOpacity,
 motion, tlFrame, ikEditTool, setIkEditTool, showTrails, setShowTrails,
 trailFalloffS, setTrailFalloffS, trailTrackFocus = null, selectTrailTrack, clearTrailTrackFocus, pendingIkEdit = null, applyPendingIkEdit, cancelPendingIkEdit,
 rangePins = [], rangePinResiduals = new Map(), rangePinSelection = null, rangePinPartPick = null,
 rangePinPreview = null, objects = [], setRangePinSelection, setRangePinPartPick,
 previewRangePinDraft, applyRangePinDraft, deleteRangePin,
}) {
 const activeTool = ikEditTool === "trail" ? "Path fix" : ikEditTool === "pin" ? "Pin" : "IK";
 return <Foldout hidden={!isRigSelection} title={ko("Pose", "포즈")}>
  <div className="pose-details" data-testid="pose-details">
   <section className="pose-section">
    <h4>{ko("Pose", "포즈")}</h4>
    <div className="pose-row"><span>{ko("Foot lock", "발 고정")}</span><b>{footSnap ? ko("On", "켜짐") : ko("Off", "꺼짐")}</b></div>
    <div className="pose-row"><span>{ko("Body contact", "몸 접촉")}</span><b>{ikChains ? ko("Ready", "준비됨") : ko("Unavailable", "사용 불가")}</b></div>
    <div className="pose-row"><span>{ko("Influence", "영향")}</span><b>{ikFocus ?? ko("All", "전체")}</b></div>
    {setPoseObjectOpacity && <div className="pose-row pose-object-opacity">
     <span>{ko("Object opacity", "오브젝트 투명도")}</span>
     <input type="range" min={0} max={100} step={5} value={Math.round(poseObjectOpacity * 100)}
      data-testid="pose-object-opacity" aria-label={ko("Scene object opacity while posing", "포즈 편집 중 오브젝트 불투명도")}
      onChange={(event) => setPoseObjectOpacity(Number(event.target.value) / 100)} />
     <b>{Math.round(poseObjectOpacity * 100)}%</b>
    </div>}
    <p className="inspector-hint">{rigSelection && rigSelection.token !== "rig" ? (isKo ? `${HIERARCHY_INSPECTOR_TITLES[rigSelection.token]}이 활성 제어 그룹입니다.` : `${HIERARCHY_INSPECTOR_TITLES[rigSelection.token]} is the active control group.`) : ko("Select a body group to pose it in the viewport.", "몸 그룹을 선택해 뷰포트에서 포즈를 잡으세요.")}</p>
   </section>
   {ikMode && <section className="pose-section" data-testid="pose-active-tool">
    <h4>{ko("Active tool", "활성 도구")} · {ko(activeTool, activeTool === "Path fix" ? "경로 수정" : activeTool === "Pin" ? "고정" : "IK")}</h4>
    <div className="pose-actions">
     <button type="button" className={"btn" + (ikEditTool === "ik" ? " primary" : "")} aria-pressed={ikEditTool === "ik"} onClick={() => setIkEditTool("ik")}>{ko("IK", "IK")}</button>
     <button type="button" className={"btn" + (ikEditTool === "trail" ? " primary" : "")} aria-pressed={ikEditTool === "trail"} disabled={!showTrails} onClick={() => setIkEditTool("trail")}>{ko("Path fix", "경로 수정")}</button>
     <button type="button" data-testid="range-pin-tool" className={"btn" + (ikEditTool === "pin" ? " primary" : "")} aria-pressed={ikEditTool === "pin"} disabled={!motion} onClick={() => { setIkEditTool("pin"); setRangePinPartPick?.(null); }}>{ko("Pin", "고정")}</button>
    </div>
    {pendingIkEdit && <div className="pose-section" data-testid="ik-pending-edit">
     <div className="pose-row"><span>{ko("IK preview", "IK 미리보기")}</span><b>{pendingIkEdit.startFrame}–{pendingIkEdit.endFrame}</b></div>
     <p className="inspector-hint">{ko("The drag is previewed. Apply it to the selected motion block or cancel it.", "드래그를 미리 보고 있어요. 선택한 모션 블록에 적용하거나 취소하세요.")}</p>
     <div className="pose-actions">
      <button type="button" className="btn primary" data-testid="ik-apply-range" onClick={applyPendingIkEdit}>{ko("Apply range", "구간 적용")}</button>
      <button type="button" className="btn" data-testid="ik-cancel-preview" onClick={cancelPendingIkEdit}>{ko("Cancel", "취소")}</button>
     </div>
    </div>}
    {ikEditTool === "pin" && <RangePinPanel active motion={motion} frame={tlFrame} frameCount={motion?.frames ?? 1} fps={motion?.fps ?? 24} pins={rangePins} residuals={rangePinResiduals} objects={objects} selectedPinId={rangePinSelection} partPick={rangePinPartPick} conflictFrames={rangePinPreview?.conflictFrames ?? []} overlapError={rangePinPreview?.overlapError ?? ""} onSelectPin={(id) => { setRangePinSelection?.(id); if (id) setIkEditTool("pin"); }} onApply={applyRangePinDraft} onCancel={() => { setRangePinSelection?.(null); setIkEditTool("ik"); }} onDelete={deleteRangePin} onPreviewTarget={previewRangePinDraft} />}
    {ikEditTool === "trail" && <>
     <button type="button" className="btn full" aria-pressed={showTrails} onClick={() => setShowTrails((value) => !value)}>{ko(`Trails ${showTrails ? "on" : "off"}`, `궤적선 ${showTrails ? "표시" : "숨김"}`)}</button>
     <label className="pose-row" data-testid="trail-selection"><span>{ko("Shown line", "표시 라인")}</span><select data-testid="trail-track-select" value={trailTrackFocus ?? ""} onChange={(event) => selectTrailTrack(event.target.value)}>
      <option value="" disabled>{ko("All lines", "모든 라인")}</option>
      {TRAIL_TRACKS.map((track) => <option key={track.id} value={track.id}>{lineTrackLabel(track.id)}</option>)}
     </select></label>
     {trailTrackFocus && <button type="button" className="btn full" data-testid="trail-show-all" onClick={clearTrailTrackFocus}>{ko("Show all lines", "모든 라인 보기")}</button>}
     <Field label={ko("Falloff", "영향 범위")}><div className="trail-falloff-row"><input type="range" min={0.1} max={2} step={0.1} value={trailFalloffS} onChange={(event) => setTrailFalloffS(Number(event.target.value))} /><span className="trail-falloff-value">{trailFalloffS.toFixed(1)}s</span></div></Field>
    </>}
    {ikEditTool === "ik" && <p className="inspector-hint">{ko("Grab a hand, foot, elbow or knee handle in the viewport.", "뷰포트에서 손·발·팔꿈치·무릎 핸들을 잡으세요.")}</p>}
   </section>}
  </div>
 </Foldout>;
}
