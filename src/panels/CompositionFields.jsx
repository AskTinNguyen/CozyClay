import { ko } from "../locale.js";
import { COMPOSITION_PLACES, HEADROOMS, LEAD_ROOMS } from "../camera-coverage/composition.js";

const LABELS = {
	place: { auto: ["Auto (lead room)", "자동 (리드룸)"], "left-third": ["Left third", "왼쪽 1/3"], centre: ["Centre", "가운데"], "right-third": ["Right third", "오른쪽 1/3"] },
	headroom: { tight: ["Tight", "좁게"], normal: ["Normal", "보통"], loose: ["Loose", "넉넉히"] },
	leadRoom: { none: ["None", "없음"], facing: ["Facing", "시선 방향"], travel: ["Travel", "이동 방향"], more: ["More", "더 많이"] },
};
const FIELDS = [["place", COMPOSITION_PLACES, ["Place", "배치"]], ["headroom", HEADROOMS, ["Headroom", "헤드룸"]], ["leadRoom", LEAD_ROOMS, ["Lead room", "리드룸"]]];

/**
 * Composition controls in the technique popover (camera-coverage): where the
 * subject's eyes sit. Off until a placement is picked; each change re-applies
 * the stack with the composition. The shot's guide overlay (Thirds) shows the lines.
 */
export default function CompositionFields({ value, onChange }) {
	const on = Boolean(value);
	return (
		<div className="technique-composition" data-technique-composition={on ? `${value.place}/${value.headroom}/${value.leadRoom}` : "off"}>
			<label className="technique-param">
				<span>{ko("Compose", "구도")}</span>
				<input type="checkbox" data-composition-on checked={on} onChange={(event) => onChange(event.target.checked ? { place: "auto", headroom: "normal", leadRoom: "facing" } : null)} />
			</label>
			{on && FIELDS.map(([key, options, [en, kr]]) => (
				<label key={key} className="technique-param">
					<span>{ko(en, kr)}</span>
					<select data-composition={key} value={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.value })}>
						{options.map((option) => <option key={option} value={option}>{ko(...LABELS[key][option])}</option>)}
					</select>
				</label>
			))}
		</div>
	);
}
