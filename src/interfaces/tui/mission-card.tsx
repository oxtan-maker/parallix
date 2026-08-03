import React from 'react';
import { Box, Text } from 'ink';
import type { BoardLane } from '../../application/projections/mission-board.js';
import type { MissionCard as MissionCardFacts } from '../../application/projections/mission-board.js';

// ---------------------------------------------------------------------------
// MissionCard — renders the facts a BoardProjection supplies for one mission.
//
// The component never derives lifecycle state. Every fact it shows comes from
// the projection; a fact that is absent renders as UNAVAILABLE rather than
// being computed here (ADR 0051 — the projection is the single source).
// ---------------------------------------------------------------------------

/** Rendered in place of any projection fact that is null or absent. */
export const UNAVAILABLE = 'unavailable';

/** Default content width of a card body, in terminal columns. */
export const DEFAULT_CARD_WIDTH = 26;

/** Lanes that show agent assignment and checkpoint details (not intake). */
const IN_FLIGHT_LANES: readonly BoardLane[] = ['active', 'review', 'integration'];

/** Titles the backlog reader emits for a mission with no usable title. */
function isPlaceholderTitle(title: string | null | undefined): boolean {
  return title === null
    || title === undefined
    || title === '>- '
    || title === '>-'
    || title.trim() === '';
}

/**
 * Shorten `text` to `max` columns, marking the cut with an ellipsis.
 *
 * Truncation happens in the component rather than via Ink's `wrap` so that the
 * cut point is deterministic in `renderToString` output regardless of the
 * width Yoga resolves for the enclosing box.
 */
export function truncate(text: string, max: number): string {
  if (max <= 0) { return ''; }
  if (text.length <= max) { return text; }
  if (max === 1) { return '\u2026'; }
  return `${text.slice(0, max - 1)}\u2026`;
}

/** Human-readable gate text per design: "gate ✓", "gate ✗ FAIL", "gate · no-op". */
function gateText(gate: MissionCardFacts['gate'] | null | undefined): string {
  switch (gate) {
    case 'passed': return 'gate \u2713';
    case 'failed': return 'gate \u2717 FAIL';
    case 'running': return 'gate · running';
    case 'unknown': return 'gate · no-op';
    default: return 'gate · no-op';
  }
}

function gateColor(gate: MissionCardFacts['gate'] | null | undefined): 'green' | 'red' | 'yellow' | 'gray' {
  switch (gate) {
    case 'passed': return 'green';
    case 'failed': return 'red';
    case 'running': return 'yellow';
    default: return 'gray';
  }
}

/** Strip .md suffix from checkpoint filename for design parity ("CP-2" not "CP-2.md"). */
function formatCheckpoint(cp: string | null | undefined): string {
  if (cp === null || cp === undefined || cp === '') { return UNAVAILABLE; }
  return cp.replace(/\.md$/, '');
}

function agentColor(agent: string): 'blue' | 'yellow' | 'magenta' | 'green' {
  switch (agent) {
    case 'codex': return 'blue';
    case 'claude': return 'yellow';
    case 'mistral': return 'magenta';
    case 'custom': return 'green';
    default: return 'blue';
  }
}

/** Accent colour of the card gutter, derived only from projection facts. */
function gutterColor(card: MissionCardFacts): 'green' | 'red' | 'yellow' | 'blue' | 'magenta' | 'gray' {
  if (card.blockingReason) { return 'red'; }
  if (card.gate === 'failed') { return 'yellow'; }
  if (card.gate === 'passed') { return 'green'; }
  if (card.agent) { return agentColor(card.agent); }
  return 'gray';
}

export interface MissionCardProps {
  readonly card: MissionCardFacts;
  /** Content width available to the card, in columns. */
  readonly width?: number;
  /** View-only focus state owned by the board shell. */
  readonly selected?: boolean;
}

/**
 * Map a command to its contextual action label per design reference.
 *
 * Design specifies contextual labels (ckpt, review ▸, approve, integrate ▸,
 * handoff) instead of generic [kind] brackets. Intake lanes show the first
 * enabled action on the slug line; in-flight lanes show actions below details.
 */
function actionLabel(lane: BoardLane, command: string, flags: readonly string[]): string {
  // Gate-failed or agent-stuck missions show repair actions
  if (flags.includes('gate:failed') || flags.includes('agent:stuck')) {
    return command === 'active' ? 'repair \u25b6' : 'handoff';
  }

  switch (lane) {
    case 'backlog': return command === 'refine' ? 'refine \u25b6' : command;
    case 'refined': return command === 'active' ? 'start \u25b6' : command;
    case 'active': return command === 'active' ? 'ckpt' : 'handoff';
    case 'review': return command === 'review' ? 'review \u25b6' : 'handoff';
    case 'integration': return command === 'integrate' ? 'integrate \u25b6' : 'handoff';
    default: return command;
  }
}

/** Extract review round from flags like "review:round-2". */
function reviewRoundFromFlags(flags: readonly string[]): number | null {
  for (const flag of flags) {
    const m = flag.match(/^review:round-(\d+)$/);
    if (m) { return parseInt(m[1], 10); }
  }
  return null;
}

/** Extract blocking findings count from flags like "review:blocking-2". */
function blockingFindingsFromFlags(flags: readonly string[]): number | null {
  for (const flag of flags) {
    const m = flag.match(/^review:blocking-(\d+)$/);
    if (m) { return parseInt(m[1], 10); }
  }
  return null;
}

/**
 * MissionCard — one mission row inside a LaneColumn.
 *
 * Layout per design reference:
 *   - Slug line: ▶ task-id [label]  agent (right-aligned for in-flight lanes)
 *   - Title line
 *   - In-flight details: cp/gate, next action, PR/review line
 *   - Action buttons: contextual labels (ckpt, review ▸, handoff, etc.)
 *   - Blocking indicator (if present)
 *
 * Every slot is always rendered so an operator can tell "not blocked"
 * from "we do not know".
 */
export function MissionCard({ card, width = DEFAULT_CARD_WIDTH, selected = false }: MissionCardProps): React.ReactElement {
  const inner = Math.max(1, width - 1);
  const agent = card.agent ?? UNAVAILABLE;
  const title = isPlaceholderTitle(card.title) ? UNAVAILABLE : card.title;
  const checkpoint = formatCheckpoint(card.checkpoint);
  const nextAction = card.nextActionText === null || card.nextActionText === undefined || card.nextActionText === ''
    ? UNAVAILABLE
    : card.nextActionText;
  const pullRequestId = card.pullRequest?.id ?? null;
  const review = card.reviewApproved ? 'approved' : 'pending';

  const label = card.labels[0];
  /* Reserve space for label badge so the mission id is never blanked.
   * Badge width = 4 (" [X]") + label length. Guarantee at least 8 cols
   * for the slug so it survives at MIN_LANE_WIDTH. */
  const slugBudget = label ? Math.max(8, inner - (label.length + 4)) : inner;
  const enabledCommands = card.commands.filter((cmd) => cmd.enabled);
  const reviewRound = reviewRoundFromFlags(card.flags);
  const blockingFindings = blockingFindingsFromFlags(card.flags);
  const reviewDetail = [reviewRound !== null ? `R${reviewRound}` : null, blockingFindings !== null && blockingFindings > 0 ? `${blockingFindings} blocking` : null].filter(Boolean).join(' · ');

  const isInFlight = IN_FLIGHT_LANES.includes(card.lane as BoardLane);

  /* Right-aligned element in the header: agent for in-flight, action for intake. */
  const headerRight = isInFlight
    ? agent
    : (enabledCommands.length > 0 ? actionLabel(card.lane as BoardLane, enabledCommands[0].command, card.flags) : null);

  /* Build PR/review line per design: "PR #47 · R2 · 2 blocking" or "PR unavailable · review pending". */
  const prLineParts = [
    pullRequestId !== null ? `PR #${pullRequestId}` : `PR ${UNAVAILABLE}`,
    reviewDetail ? reviewDetail : `review ${review}`,
  ];

  return (
    <Box flexDirection="column" width={width} marginBottom={1}>
      <Box flexDirection="row">
        <Text bold={selected} color={selected ? 'cyan' : gutterColor(card)}>{selected ? '\u25b6' : '\u2503'}</Text>
        <Box flexGrow={1}>
          <Text wrap="truncate-end" bold color="blue">
            {truncate(card.id, slugBudget)}
          </Text>
        </Box>
        {label && (
          <Text color="gray" wrap="truncate-end">{` [${truncate(label, Math.max(1, inner - slugBudget - 4))}]`}</Text>
        )}
        {headerRight && (
          <Text color={isInFlight ? agentColor(agent as string) : 'green'}>
            {truncate(headerRight, 12)}
          </Text>
        )}
      </Box>

      <Text wrap="truncate-end" dimColor={title === UNAVAILABLE}>{truncate(title, width)}</Text>

      {isInFlight && (
        <>
          <Box flexDirection="row">
            <Text wrap="truncate-end" color="gray">{truncate(checkpoint, Math.max(6, width - 14))}</Text>
            <Text wrap="truncate-end" color={gateColor(card.gate)} bold={card.gate === 'failed'}>
              {' '}{gateText(card.gate)}
            </Text>
          </Box>

          <Text wrap="truncate-end" dimColor>{truncate(`next: ${nextAction}`, width)}</Text>

          <Text wrap="truncate-end" color={card.reviewApproved ? 'green' : 'gray'}>
            {truncate(prLineParts.join(' · '), width)}
          </Text>
        </>
      )}

      {enabledCommands.length > 0 && (
        <Box flexDirection="row">
          {enabledCommands.map((cmd) => {
            const lbl = actionLabel(card.lane as BoardLane, cmd.command, card.flags);
            return (
              <Box key={cmd.command} marginRight={1}>
                <Text bold color="cyan">{lbl}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {card.blockingReason !== null && card.blockingReason !== '' && (
        <Text wrap="truncate-end" bold color="red">
          {truncate(`\u25b2 ${card.blockingReason}`, width)}
        </Text>
      )}
    </Box>
  );
}
