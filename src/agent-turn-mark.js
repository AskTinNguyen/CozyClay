// The agent turn's controls, and its mark. One user message is one editor transaction
// (#702, #715): every edit of the turn lands in one composed session, so the message is one
// undo step. A script runs inside that turn, after edits the same message already made (an
// installed take, a placed set). When the script fails, only its own edits roll back:
// agent.turn.mark records where it starts, and agent.turn.rollback restores exactly what came
// after the mark and leaves the turn open, so the earlier edits still land with the turn.
import { StudioProtocolError } from './studio-agent-protocol.js';

const TURN_CONTROLS = ['begin', 'mark', 'rollback', 'finish', 'cancel'];
/** The wire schema of each agent.turn.* control: the owning turn's id, nothing else. */
export const agentTurnControls = (object, identifier) => Object.fromEntries(TURN_CONTROLS.map(verb => [`agent.turn.${verb}`, object({ turnId: identifier })]));

/**
 * agent.turn.mark or agent.turn.rollback on the open turn. Answers the transaction its receipt
 * describes: a mark affects nothing, a rollback names the ids the rolled-back edits touched.
 * The bus adds each later edit's ids to `turn.mark.since`.
 */
export function markAgentTurn(id, turn) {
  if (id === 'agent.turn.mark') {
    turn.mark = { point: turn.session?.savepoint() ?? null, affectedIds: new Set(turn.affectedIds), since: new Set() };
    return { txId: turn.txId, affectedIds: [], toasts: [] };
  }
  const { mark } = turn;
  if (!mark) throw new StudioProtocolError('STALE_TARGET', 'The agent turn has no mark to roll back to.');
  turn.mark = null;
  // No session at the mark: everything the turn authored came after it.
  turn.session?.rollback(mark.point ?? undefined);
  turn.affectedIds = mark.affectedIds;
  return { txId: turn.txId, affectedIds: [...mark.since], toasts: [] };
}
