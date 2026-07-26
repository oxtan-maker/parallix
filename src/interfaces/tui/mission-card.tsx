import React from 'react';
import { Box, Text } from 'ink';
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
  if (max === 1) { return '…'; }
  return `${text.slice(0, max - 1)}…`;
}

/** Human-readable gate text. `unknown` is a real projection value, not an absence. */
function gateText(gate: MissionCardFacts['gate'] | null | undefined): string {
  switch (gate) {
    case 'passed': return 'passed ✓';
    case 'failed': return 'failed ✗';
    case 'running': return 'running';
    case 'unknown': return 'unknown';
    default: return UNAVAILABLE;
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
}

/**
 * MissionCard — one mission row inside a LaneColumn.
 *
 * Fact slots, in render order: slug + agent, title, checkpoint + gate, next
 * action, pull request + review approval, and blocking reason when present.
 * Every other slot is always rendered so an operator can tell "not blocked"
 * from "we do not know".
 *
 * Each slot is one composed line, truncated to the card width before render.
 * Composing first keeps a narrow column from letting Yoga split a line across
 * several Text children mid-word, which is what corrupts a six-column board on
 * a 100-column terminal.
 */
export function MissionCard({ card, width = DEFAULT_CARD_WIDTH }: MissionCardProps): React.ReactElement {
  const inner = Math.max(1, width - 1);
  const agent = card.agent ?? UNAVAILABLE;
  const title = isPlaceholderTitle(card.title) ? UNAVAILABLE : card.title;
  const checkpoint = card.checkpoint ?? UNAVAILABLE;
  const nextAction = card.nextActionText === null || card.nextActionText === undefined || card.nextActionText === ''
    ? UNAVAILABLE
    : card.nextActionText;
  const pullRequest = card.pullRequest ? `PR ${card.pullRequest.id}` : `PR ${UNAVAILABLE}`;
  const review = card.reviewApproved ? 'review approved' : 'review pending';

  return (
    <Box flexDirection="column" width={width} marginBottom={1}>
      <Box flexDirection="row">
        <Text color={gutterColor(card)}>{'▍'}</Text>
        <Text wrap="truncate-end" bold color="blue">{truncate(`${card.id} · ${agent}`, inner)}</Text>
      </Box>

      <Text wrap="truncate-end" dimColor={title === UNAVAILABLE}>{truncate(title, width)}</Text>

      <Text wrap="truncate-end" color={gateColor(card.gate)}>
        {truncate(`cp ${checkpoint} · gate ${gateText(card.gate)}`, width)}
      </Text>

      <Text wrap="truncate-end" dimColor>{truncate(`next: ${nextAction}`, width)}</Text>

      <Text wrap="truncate-end" color={card.reviewApproved ? 'green' : 'gray'}>
        {truncate(`${pullRequest} · ${review}`, width)}
      </Text>

      {card.blockingReason !== null && card.blockingReason !== '' && (
        <Text wrap="truncate-end" bold color="red">
          {truncate(`\u25b2 ${card.blockingReason}`, width)}
        </Text>
      )}
    </Box>
  );
}
