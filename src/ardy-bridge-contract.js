import { ko, isKo } from "./locale.js";
import { LINE_EDIT_TRACK_IDS, PINNED_CURVE_ENDS } from "./line-edit.js";
import { FK_TRACKS, IK_TRACKS, MID_TRACKS } from "./ardy/ik.js";

// Two clocks, one boundary. The app timeline runs the production 24 fps —
// the rate the reference footage and the recorded export are counted in.
// ARDY Core generates on its trained 20 fps clock and that cannot move, so
// takes are RETIMED inbound (bridge → app, retimeMotion) and frame numbers
// are CONVERTED outbound (app → bridge, toArdyFrame). Nothing between the
// boundaries may mix the clocks.
export const TIMELINE_FPS = 24;
// The motion bridge uses the Studio's fixed 24 fps production clock.
export const ARDY_FPS = 24;
export const toArdyFrame = (frame) => Math.round((frame * ARDY_FPS) / TIMELINE_FPS);

// Outbound converters: timeline-frame entries → strictly-ascending bridge
// frames. Rounding can land two timeline frames on one bridge frame; the
// first wins — the bridge refuses non-ascending lists outright.
/** Where a placed pose lands, in TIMELINE frames, for a clip of `clipFrames`. */
export function posePlacementFrame(placement, clipFrames, playheadFrame) {
	const last = Math.max(0, clipFrames - 1);
	if (placement === "end") return last;
	if (placement === "middle") return Math.round(last / 2);
	if (placement === "playhead") return Math.max(0, Math.min(last, playheadFrame));
	return 0;
}

export function toArdyFrameEntries(entries) {
	const out = [];
	for (const entry of entries) {
		const frame = toArdyFrame(entry.frame);
		if (out.length && frame <= out[out.length - 1].frame) continue;
		out.push({ ...entry, frame });
	}
	return out;
}

export function toArdySegments(segments) {
	const out = [];
	for (const segment of segments) {
		const startFrame = toArdyFrame(segment.startFrame);
		const endFrame = toArdyFrame(segment.endFrame);
		if (endFrame <= startFrame) continue; // a zero-length rounding remnant covers nothing
		out.push({ ...segment, startFrame, endFrame });
	}
	return out;
}

export const DEFAULT_DURATION_S = 15; // pre-motion timeline duration; shown as duration × TIMELINE_FPS frames
export const DEFAULT_PLAYBACK_SPEED = 1;
export const BRIDGE_RECHECK_MS = 3000;
export const ARDY_PROMPT_HORIZON_FRAMES = 2 * TIMELINE_FPS; // core model horizon: 2 seconds, counted on the timeline clock
export const MAX_WAYPOINTS = 32; // ARDY bridge contract: a root path holds 2..32 distinct waypoint frames
export const ARDY_PROMPT_MAX = 500; // bridge contract: prompt must be non-empty, capped at 500 chars
export const ARDY_DURATION_MIN = 1; // the UI works in whole seconds; the bridge floor is 0.15 s
export const ARDY_DURATION_MAX = 1200; // bridge contract: duration capped at 1200 s
export const ARDY_SEED_MAX = 2 ** 31 - 1; // bridge contract: optional seed, integer in 0..2**31-1
// Scheduled inpainting (contract C3): how hard a regeneration holds onto the
// take that is already loaded. 0 turns preserving OFF entirely; 0.5 is the
// paper's recommended setting. The app ships this RAW number and nothing else:
// the strength -> denoising-schedule mapping (sigma_s = round(1000 * strength),
// sigma_e = min(50, sigma_s), diffusion time 0..1000) lives on the box side, and
// duplicating it here is exactly how the two would silently drift apart.
export const ARDY_PRESERVE_DEFAULT = 0.5;
export const DEFAULT_PROMPT_CLIPS = [];

/** The prompt-block schedule: every authored block in frame order, with the gaps
 * between them filled by the base prompt so the bridge always receives one
 * contiguous 0..clipFrames sequence. Blocks shorter than 3 frames are dropped —
 * they cannot carry a generation.
 * Pure and shared on purpose: the request assembly decides which blocks count as
 * "edited", and the preserve panel has to name the SAME blocks. Re-deriving them
 * approximately beside the slider is how the UI starts promising a locality the
 * wire does not carry. */
export function buildPromptSchedule(sourcePromptClips, clipFrames, prompt) {
	const segments = [];
	let cursor = 0;
	for (const clip of sourcePromptClips) {
		const startFrame = Math.max(cursor, Math.min(clipFrames, clip.startFrame));
		const endFrame = Math.max(startFrame, Math.min(clipFrames, clip.endFrame));
		if (startFrame > cursor) segments.push({ startFrame: cursor, endFrame: startFrame, prompt });
		if (endFrame - startFrame >= 3) segments.push({ startFrame, endFrame, prompt: clip.text.trim() || prompt });
		cursor = Math.max(cursor, endFrame);
		if (cursor >= clipFrames) break;
	}
	if (cursor < clipFrames) segments.push({ startFrame: cursor, endFrame: clipFrames, prompt });
	if (segments.length === 0) segments.push({ startFrame: 0, endFrame: clipFrames, prompt });
	return segments;
}

/** The DISTINCT ik track ids keyed inside the half-open timeline span
 * [startFrame, endFrame). `ikState.keys` is Map(frame -> Map(trackId -> pose)),
 * so a frame with several dragged effectors contributes all of them. */
export function ikTracksInRange(ikState, ikFrames, startFrame, endFrame) {
	const tracks = new Set();
	for (const frame of ikFrames) {
		if (frame < startFrame || frame >= endFrame) continue;
		for (const trackId of ikState?.keys?.get(frame)?.keys() ?? []) tracks.add(trackId);
	}
	return [...tracks];
}

/* Which limb a keyed IK track frees once the preserve mask is grouped
   (contract C3v2). The single source of truth for track -> mask group is
   TRACK_GROUPS in tools/kimodo/preserve-mask.mjs; nothing under tools/ may be
   imported into src/, so the rule is transcribed here — as USER-FACING LABELS
   only, never as a second copy of the mapping the wire depends on:
     leftHand,  leftElbow  -> leftArm     rightHand, rightElbow -> rightArm
     leftFoot,  leftKnee   -> leftLeg     rightFoot, rightKnee  -> rightLeg
     head,      neck       -> head        spine, chest, leftShoulder,
     hips                  -> torso AND root      rightShoulder -> torso
   The track ids are the same namespace on both sides (src/ardy/ik.js owns
   them), so the app ships whatever ids it has and the mask builder maps them.
   Torso and pelvis tracks are worded as the whole body: the pelvis carries the
   global transform as well as a bone, and naming a limb beside it would promise
   a locality the mask does not have. */
export const PRESERVE_TRACK_LIMBS = {
	leftHand: "leftArm",
	leftElbow: "leftArm",
	rightHand: "rightArm",
	rightElbow: "rightArm",
	leftFoot: "leftLeg",
	leftKnee: "leftLeg",
	rightFoot: "rightLeg",
	rightKnee: "rightLeg",
	head: "head",
	neck: "head",
	spine: "body",
	chest: "body",
	leftShoulder: "body",
	rightShoulder: "body",
	hips: "body",
};
// A fixed reading order, so the same edit always reads back the same way.
export const PRESERVE_LIMB_ORDER = ["head", "leftArm", "rightArm", "leftLeg", "rightLeg"];
export const preserveLimbLabel = (limb) => ({
	head: ko("head", "머리"),
	leftArm: ko("left arm", "왼팔"),
	rightArm: ko("right arm", "오른팔"),
	leftLeg: ko("left leg", "왼발"),
	rightLeg: ko("right leg", "오른발"),
}[limb]);

/** One muted line naming what a grouped preserve run will regenerate, or "" when
 * no track can be attributed — then the request carries no `tracks` either and
 * the panel's existing whole-take wording is already the truth. */
export function preserveTracksSummary(tracks) {
	const limbs = new Set();
	for (const trackId of tracks) {
		const limb = PRESERVE_TRACK_LIMBS[trackId];
		if (limb) limbs.add(limb);
	}
	if (limbs.size === 0) return "";
	if (limbs.has("body")) return ko("regenerates the whole body", "몸 전체를 다시 생성");
	const names = PRESERVE_LIMB_ORDER.filter((limb) => limbs.has(limb)).map(preserveLimbLabel);
	return isKo ? `${names.join("·")}만 다시 생성` : `regenerates ${names.join(" · ")} only`;
}

/* --------------------------- line editing (C6) ---------------------------
 * "Grab the joint's motion path and pull it; the joint follows the pulled path
 * exactly" (ProjFlow). The arithmetic lives in ./line-edit.js; what stays here
 * is the panel's own vocabulary and the one thing App owns that the pure module
 * cannot — the mapping from a track id to a HUMAN LABEL, which is read straight
 * out of ik.js's three tables so the picker can never drift from the pose
 * studio's own naming. An id in LINE_EDIT_TRACK_IDS with no entry in those
 * tables is a bug, and falling back to the raw id makes it visible instead of
 * silent. */
export const LINE_EDIT_TRACK_OPTIONS = LINE_EDIT_TRACK_IDS.map((id) => ({
	value: id,
	label: [...IK_TRACKS, ...MID_TRACKS, ...FK_TRACKS].find((track) => track.id === id)?.label ?? id,
}));
/** The same human label, by id — what a version-strip chip says a refinement
 * touched ("Refine · Left Hand"). */
export const lineTrackLabel = (id) => LINE_EDIT_TRACK_OPTIONS.find((option) => option.value === id)?.label ?? id;
/** The default edited track: a wrist is the joint the paper's own demo draws
 * with, and the one whose screen trajectory a user can actually see. */
export const LINE_EDIT_DEFAULT_TRACK = "leftHand";
/** Draw a grab handle every Nth frame. Fewer would leave the curve looking
 * un-grabbable in the gaps; more turns a 200-frame range into a solid bead of
 * dots. The hit test tolerates CURVE_GRAB_RADIUS_PX regardless, so the handles
 * are an affordance rather than the actual geometry. */
export const LINE_CURVE_MARKER_STRIDE = 4;
/** The shortest curve with anything draggable in it: both ends are hard-pinned
 * to the original trajectory, so a range needs more than 2 x PINNED_CURVE_ENDS
 * frames before the middle can move at all. */
export const MIN_CURVE_POINTS = PINNED_CURVE_ENDS * 2 + 1;
/** How long a released drag has to sit still before it costs a preview. Long
 * enough that pull-pull-pull is one request instead of three, short enough that
 * the loop still feels like it answers the gesture — a preview round trip is
 * ~1 s on the warm service, so 150 ms is noise against it. */
export const LINE_PREVIEW_DEBOUNCE_MS = 150;
/** How often the line-edit capability is re-probed while the bridge is up and
 * the answer is still no.
 *
 * The bridge answers `capabilities.lineEdit` from a LAZY ssh probe of the
 * ProjFlow box behind a 5 s cache, so the very first /ardy/health of a session
 * can land on a cold cache and come back false — a box that is perfectly fine
 * two seconds later. Asking once per bridge-up transition therefore made the
 * whole mode dead until a reload (first boot broken, second boot fine, which is
 * exactly how it was reported). A capability is an ADVERTISEMENT, so it is
 * allowed to arrive late; what is not allowed is to assume it. 4 s sits just
 * under the bridge's own 5 s TTL, so a retry can actually see a new answer
 * rather than re-reading the same cached false. */
export const LINE_CAPABILITY_RETRY_MS = 4000;
/** Why a validateLineEdit code refused, said once, in the user's language.
 * Keyed by the pure module's stable codes so the copy and the check can never
 * disagree about which field was wrong. */
export const LINE_EDIT_REFUSALS = {
	sourceMotion: ["The current take has no bridge source — generate it once before editing a path", "현재 테이크에 브리지 원본이 없어요 — 궤적을 편집하기 전에 한 번 생성하세요"],
	track: ["Pick a joint to edit first", "먼저 편집할 관절을 고르세요"],
	frameRange: ["The frame range must sit inside the clip and span at least 2 frames", "프레임 구간은 클립 안에 있어야 하고 최소 2프레임이어야 해요"],
	points: ["Pull a longer stretch of the path — a single point is not a path", "궤적을 좀 더 길게 잡아당겨 주세요 — 점 하나는 경로가 아니에요"],
	camera: ["The camera could not be captured — nudge the view and try again", "카메라를 캡처하지 못했어요 — 뷰를 조금 움직인 뒤 다시 시도하세요"],
	prompt: ["The motion prompt is not usable for a line edit", "모션 프롬프트를 라인 편집에 쓸 수 없어요"],
	pins: ["The pinned moments could not be sent — try clearing them and pinning again", "찍은 순간을 보낼 수 없어요 — 지우고 다시 찍어 보세요"],
	shape: ["The line edit could not be assembled", "라인 편집을 구성하지 못했어요"],
};
/** Why curveToPoints2d refused. Same shape, different stage: these are about
 * the CURVE, before there is a payload to validate. */
export const LINE_CURVE_REFUSALS = {
	empty: ["This joint is not visible over the chosen frames — frame it in view first", "선택한 구간에서 이 관절이 보이지 않아요 — 먼저 화면 안에 들어오도록 잡아 주세요"],
	offscreen: ["The pulled path leaves the frame — keep it inside the dashed border", "잡아당긴 궤적이 화면을 벗어났어요 — 점선 테두리 안에 두세요"],
};

// Named ingest failures, in both locales. A reason the user cannot act on is
// not a message: each line says what was wrong with THIS source.
export const MULTIMODEL_REASONS = {
	"url-empty": ["Enter a video URL first", "영상 URL을 먼저 입력하세요"],
	"url-protocol-relative": ["Use a full https:// address", "https:// 로 시작하는 전체 주소를 쓰세요"],
	"url-scheme-unsupported": ["Only http(s) or a local /path is accepted", "http(s) 또는 로컬 /경로만 사용할 수 있어요"],
	"url-platform-page": [
		"YouTube/Vimeo pages are players, not video files, and block browser downloads. Start the dev bridge to use the URL directly, or download the clip and use Choose video.",
		"유튜브·비메오 주소는 영상 파일이 아니라 플레이어 페이지이고 브라우저 다운로드를 막습니다. 개발 브리지를 켜면 URL을 그대로 쓸 수 있고, 아니면 영상을 내려받아 '영상 선택'을 쓰세요.",
	],
	"url-malformed": ["That address could not be parsed", "주소를 해석할 수 없어요"],
	"fetch-failed": ["The host refused a browser download (CORS or offline)", "호스트가 브라우저 다운로드를 거부했어요(CORS 또는 오프라인)"],
	"not-a-video": ["That address did not return a video (check the path)", "그 주소는 영상을 반환하지 않았어요(경로를 확인하세요)"],
	"decode-failed": ["This browser cannot decode that video", "이 브라우저가 디코딩할 수 없는 영상이에요"],
	"duration-unreadable": ["The clip length could not be read", "클립 길이를 읽지 못했어요"],
	"dimensions-unreadable": ["The frame size could not be read", "프레임 크기를 읽지 못했어요"],
	"probe-timeout": ["The video never reported metadata", "영상이 메타데이터를 보내지 않았어요"],
	"fetch-unavailable": ["This browser cannot download files", "이 브라우저는 파일을 내려받을 수 없어요"],
	"footage-load-timeout": ["The clip never became seekable", "클립이 탐색 가능한 상태가 되지 않았어요"],
	"seek-timeout": ["Seeking inside the clip stalled", "클립 내부 탐색이 멈췄어요"],
	"pose-runtime-unavailable": ["The pose engine is missing from this build", "이 빌드에 포즈 엔진이 없어요"],
	"pose-model-download-failed": ["The pose model could not be downloaded (offline?)", "포즈 모델을 내려받지 못했어요(오프라인인가요?)"],
	"pose-engine-download-failed": ["The pose engine could not be downloaded (offline?)", "포즈 엔진을 내려받지 못했어요(오프라인인가요?)"],
	"pose-engine-init-failed": ["The pose engine failed to start on this device", "이 기기에서 포즈 엔진을 시작하지 못했어요"],
	"rest-unavailable": ["The rig rest data (/ardy/cskel27-rest.json) could not be loaded", "리그 레스트 데이터(/ardy/cskel27-rest.json)를 불러오지 못했어요"],
	"no-person-found": ["No person was detected in the footage", "영상에서 사람을 감지하지 못했어요"],
	"no-person-in-photo": ["No person was detected in that photograph", "사진에서 사람을 감지하지 못했어요"],
	"image-load-timeout": ["The photograph never finished decoding", "사진 디코딩이 끝나지 않았어요"],
	"pose-partly-occluded": ["Shoulders and hips must both be visible in the photograph", "사진에 어깨와 골반이 모두 보여야 해요"],
	"no-usable-pose": ["A person was seen, but no stable pose could be fitted", "사람은 보였지만 안정적인 포즈를 만들지 못했어요"],
	"rig-not-loaded": ["Subject 1's rig is not loaded yet", "인물 1 리그가 아직 로드되지 않았어요"],
	"bridge-unreachable": ["The dev bridge did not answer", "개발 브리지가 응답하지 않아요"],
	"bridge-footage-incomplete": ["The bridge stream ended without footage", "브리지 전송이 영상 없이 끝났어요"],
	"footage-url-invalid": ["That address could not be used for a bridge download", "이 주소는 브리지 다운로드에 쓸 수 없어요"],
	"footage-probe-failed": ["The bridge could not read that page's video info", "브리지가 그 페이지의 영상 정보를 읽지 못했어요"],
	"footage-live-unsupported": ["Live streams have no fixed length and cannot be ingested", "라이브 스트림은 길이가 없어 인제스트할 수 없어요"],
	"footage-too-long": ["That video is over 15 minutes — trim or pick a shorter one", "15분이 넘는 영상이에요 — 잘라내거나 더 짧은 걸 골라 주세요"],
	"footage-download-failed": ["The bridge could not download that video", "브리지가 영상을 내려받지 못했어요"],
	"footage-normalize-failed": ["The bridge could not convert that video for extraction", "브리지가 영상을 추출용으로 변환하지 못했어요"],
	"footage-timeout": ["The bridge download took too long and was stopped", "브리지 다운로드가 너무 오래 걸려 중단됐어요"],
	"bridge-extract-incomplete": ["The bridge stream ended without a take", "브리지 전송이 테이크 없이 끝났어요"],
	"extract-host-missing": ["The bridge has no GPU box configured (CCLAY_EXTRACT_HOST)", "브리지에 GPU 박스가 설정돼 있지 않아요(CCLAY_EXTRACT_HOST)"],
	"extract-bridge-required": ["GVHMR extraction requires the local GPU bridge", "GVHMR 추출에는 로컬 GPU 브리지가 필요해요"],
	"extract-backend-unsupported": ["This bridge is not configured for GVHMR", "이 브리지가 GVHMR로 설정되지 않았어요"],
	"extract-upload-failed": ["The footage could not be copied to the GPU box", "영상을 GPU 박스로 복사하지 못했어요"],
	"extract-upload-too-large": ["That clip is too large to upload for extraction (300 MB cap)", "추출 업로드 한도(300MB)를 넘는 영상이에요"],
	"extract-upload-empty": ["No video bytes arrived at the bridge", "브리지에 영상 데이터가 도착하지 않았어요"],
	"extract-footage-unknown": ["The bridge no longer holds that download — re-ingest the URL", "브리지에 그 다운로드가 더 이상 없어요 — URL을 다시 넣어 주세요"],
	"extract-run-failed": ["GVHMR failed on the GPU box (see the bridge log)", "GPU 박스에서 GVHMR 실행이 실패했어요(브리지 로그 확인)"],
	"extract-no-person": ["The GPU box tracked no person in that footage", "GPU 박스가 영상에서 사람을 추적하지 못했어요"],
	"extract-convert-failed": ["The extracted take could not be converted for the timeline", "추출된 테이크를 타임라인용으로 변환하지 못했어요"],
	"extract-timeout": ["GPU extraction took too long and was stopped", "GPU 추출이 너무 오래 걸려 중단됐어요"],
};

// Extraction samples and bakes straight onto the production clock — an
// extracted take never touches ARDY, so it never needs retiming either.
export const MULTIMODEL_SAMPLE_FPS = TIMELINE_FPS;
