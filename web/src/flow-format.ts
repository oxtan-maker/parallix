/**
 * Mission flow display text. These helpers only format projected values:
 * units, rounding and names. None of them derives a count, rate or interval.
 */
import type { WebFlowLane as FlowLaneId, WebFlowNodeId as FlowNodeId } from '../../src/interfaces/web/transport.js';
import { FLOW } from './palette.js';

const MINUTE = 60_000;

/** Whole minutes, the reference's unit for averages ("82m", "1235m"). */
export function minutesText(ms: number): string {
  return `${Math.round(ms / MINUTE)}m`;
}

/** Hours with one decimal, the reference's unit for the cycle-time figure ("20.6h"). */
export function hoursText(ms: number): string {
  return `${(ms / (60 * MINUTE)).toFixed(1)}h`;
}

/** The p90 step: minutes under 100, then tenths of an hour, then whole hours ("96m", "4.1h", "48h"). */
export function compactDuration(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 100) { return `${minutes}m`; }
  const hours = ms / (60 * MINUTE);
  return hours < 10 ? `${hours.toFixed(1)}h` : `${Math.round(hours)}h`;
}

export function percentText(share: number): string {
  return `${Math.round(share * 100)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "28 Oct – 3 Nov" from the projection's inclusive local calendar dates. */
export function windowText(startDate: string, endDate: string): string {
  const day = (value: string) => {
    const [, month, date] = value.split('-').map(Number);
    return `${date} ${MONTHS[(month ?? 1) - 1]}`;
  };
  return `${day(startDate)} – ${day(endDate)}`;
}

const STEP_LABELS: Readonly<Record<string, string>> = {
  'workflow-admission': 'Refined, waiting to start',
  preparation: 'Preparation',
  draft: 'Refine',
  implement: 'Implement',
  repair: 'Rework',
  recovery: 'Recovery',
  'gate-admission': 'Gate queue',
  'declared-gates': 'Declared gates',
  'direct-rebase': 'Direct rebase',
  'pre-review-rebase': 'Rebase before review',
  'integration-rebase': 'Rebase before integration',
  'agent-review': 'Agent review',
  'human-review': 'Human review',
  'responsibility-handoff': 'Handoff wait',
  'lead-escalation': 'Escalated to you',
  integrate: 'Integration',
};

/** A recorded step name for people; an unrecognised step keeps its recorded identity. */
export function stepText(step: string): string {
  return STEP_LABELS[step] ?? step;
}

const ACTOR_LABELS: Readonly<Record<string, string>> = {
  human: 'You', parallix: 'Parallix', lead: 'px lead', external: 'External', unattributed: 'Unattributed',
};

export function actorText(actor: string): string {
  return ACTOR_LABELS[actor] ?? actor;
}

export interface LaneStyle {
  readonly role: string;
  readonly fallback: string;
  readonly accent: string;
  readonly text: string;
}

export const LANE_STYLE: Readonly<Record<FlowLaneId, LaneStyle>> = {
  'refine-agent': { role: 'refines', fallback: 'Refining agent', accent: FLOW.refine, text: FLOW.refineText },
  'implement-agent': { role: 'implements, resolves', fallback: 'Implementing agent', accent: FLOW.amber, text: FLOW.amberText },
  parallix: { role: 'rebase + gates', fallback: 'Parallix', accent: FLOW.cyan, text: FLOW.cyanText },
  'review-agent': { role: 'reviews', fallback: 'Reviewing agent', accent: FLOW.purple, text: FLOW.purpleText },
  lead: { role: 'queues, recovers', fallback: 'px lead', accent: FLOW.lead, text: FLOW.leadText },
  human: { role: 'try it, decide', fallback: 'You', accent: FLOW.red, text: FLOW.redText },
  external: { role: 'between steps', fallback: 'External', accent: FLOW.flow, text: FLOW.control },
  main: { role: 'landed work', fallback: 'main', accent: FLOW.blue, text: FLOW.blueText },
};

/** The lane's people-facing name: the concrete families that held it, else its role. */
export function laneTitle(lane: FlowLaneId, families: readonly string[]): string {
  return families.length > 0 && LANE_STYLE[lane].fallback !== 'Parallix' ? families.join(' · ') : LANE_STYLE[lane].fallback;
}

export const NODE_TEXT: Readonly<Record<FlowNodeId, { readonly title: string; readonly unit: string }>> = {
  refine: { title: 'Refine', unit: 'from backlog' },
  implement: { title: 'Implement', unit: 'rework' },
  'pre-review-rebase': { title: 'Rebase', unit: 'runs' },
  'pre-review-resolve': { title: 'Resolve', unit: 'conflicts' },
  'declared-gates': { title: 'Declared gates', unit: 'runs' },
  'agent-review': { title: 'Agent review', unit: 'rounds' },
  'human-review': { title: 'Human review', unit: 'rounds' },
  'integration-rebase': { title: 'Rebase', unit: 'runs' },
  'integration-resolve': { title: 'Resolve', unit: 'conflicts' },
  'integration-gates': { title: 'Integration', unit: 'gates' },
  landed: { title: 'Landed', unit: '' },
  lead: { title: 'px lead', unit: 'recoveries' },
};
