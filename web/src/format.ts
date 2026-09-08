/**
 * Fact formatting for the browser board: display of contract values only.
 * Nothing here derives a new fact, and no branch turns an unknown into a
 * success — an omitted, null and observed-zero value each print as itself.
 */
import type {
  WebAgentAvailability,
  WebDurationMs,
  WebMissionCard,
} from '../../src/interfaces/web/transport.js';
import { C } from './palette.js';

/** `finite` renders as its remaining span; `indefinite` never collapses to a number. */
export function durationText(duration: WebDurationMs): string {
  if (duration.kind === 'indefinite') {
    return 'indefinite';
  }
  let seconds = Math.max(0, Math.round(duration.ms / 1000));
  const units = [[365 * 24 * 60 * 60, 'y'], [30 * 24 * 60 * 60, 'mo'], [7 * 24 * 60 * 60, 'w'], [24 * 60 * 60, 'd'], [60 * 60, 'h'], [60, 'm'], [1, 's']] as const;
  const first = units.findIndex(([size]) => seconds >= size);
  if (first < 0) { return '0s'; }
  const [size, label] = units[first];
  const major = Math.floor(seconds / size);
  seconds %= size;
  const next = units[first + 1];
  return `${major}${label}${next && seconds >= next[0] ? ` ${Math.floor(seconds / next[0])}${next[1]}` : ''}`;
}

export const GATE_TEXT: Record<WebMissionCard['gate'], string> = {
  passed: 'gate ✓',
  failed: 'gate ✗ FAIL',
  running: 'gate · running',
  unknown: 'gate · unknown',
};

export const GATE_COLOR: Record<WebMissionCard['gate'], string> = {
  passed: C.green,
  failed: C.red,
  running: C.amber,
  unknown: C.faint,
};

/** The card's own work state, shown verbatim; `unknown` certainty stays unknown. */
export function workText(card: WebMissionCard): string {
  const work = card.activity.work;
  switch (work.kind) {
    case 'working': return `working · ${work.certainty}`;
    case 'blocked': return 'blocked';
    case 'idle': return 'idle';
  }
}

/**
 * The reference's actor line: one sentence about who is acting, taken from
 * the server's own summary rather than composed here.
 */
export function actorLine(card: WebMissionCard): { readonly text: string; readonly color: string } {
  const work = card.activity.work;
  switch (work.kind) {
    case 'working':
      return { text: work.summary, color: work.certainty === 'live' ? C.green : C.amber };
    case 'blocked':
      return { text: work.reason, color: C.red };
    case 'idle':
      return { text: 'no work observed', color: C.faint };
  }
}

/** Secondary recovery evidence, deliberately never used to infer current work. */
export function coordinatorText(card: WebMissionCard): string {
  const evidence = card.activity.coordinator;
  if (evidence.state === 'live') {
    return `recovery evidence: coordinator live${evidence.family === null ? '' : ` (${evidence.family})`}`;
  }
  return `recovery evidence: coordinator ${evidence.state}`;
}

/** A card's fan follows the shared current-work in-progress definition. */
export function isSpinning(card: WebMissionCard): boolean {
  return card.activity.work.kind === 'working' && card.activity.work.certainty !== 'stale';
}

/**
 * Presentation accent per agent family, transcribed from the reference. Any
 * family the reference did not colour falls back to the neutral tone; the map
 * decides a hue and nothing else.
 */
const FAMILY_ACCENT: Readonly<Record<string, string>> = {
  codex: '#19b48c',
  claude: '#d97757',
  mistral: '#ff7000',
  custom: '#7f97a8',
};

/**
 * Families the reference did not colour still need to be told apart, so their
 * accent is a stable hue derived from the name. It decides a hue and nothing
 * else — no ordering, no eligibility, no fact.
 */
function derivedAccent(family: string): string {
  let hash = 0;
  for (const char of family) {
    hash = (hash * 31 + char.codePointAt(0)!) % 360;
  }
  return `hsl(${hash} 45% 62%)`;
}

export function familyAccent(family: string | null): string {
  if (family === null) { return C.faint; }
  return FAMILY_ACCENT[family] ?? derivedAccent(family);
}

/**
 * The agent pill's session text. An omitted `runningSessions` key means no
 * liveness probe ran and prints nothing; `null` prints unknown; `0` prints the
 * observed zero. None of the three is ever shown as another.
 */
export function sessionsText(metric: WebAgentAvailability): string {
  const parts: string[] = [];
  if (!metric.available) {
    parts.push(`blocked · ${durationText(metric.blockedFor)}`);
  }
  if ('runningSessions' in metric) {
    parts.push(metric.runningSessions === null ? 'unknown' : String(metric.runningSessions));
  }
  return parts.join(' · ');
}
