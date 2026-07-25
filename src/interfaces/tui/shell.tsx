import React from 'react';
import { useApp, useStdin, Box, Text } from 'ink';
import type { BoardProjection } from '../../application/projections/board.js';
import type { BoardLane, MissionCard } from '../../application/projections/mission-board.js';

// ---------------------------------------------------------------------------
// TUI Shell — static read-only board from a BoardProjection
// Layout derived from: /tmp/Parallix Kanban Board Controller.zip
//
// Design box hierarchy (Ink mapping):
//   root (flex column)
//     ├─ top bar (flex row): px board | repo | wip·attn | staleness
//     ├─ main (flex:1, flex ROW)
//     │   ├─ attention rail (width:32, flex column, border-right)
//     │   │   └─ cards: rank | slug | [reason] | why | $cmd
//     │   └─ board area (flex:1, flex ROW)
//     │       ├─ INTAKE (width:28, flex column)
//     │       │   ├─ Refined (border-bottom)
//     │       │   └─ Backlog (flex:1)
//     │       ├─ ACTIVE (flex:1)
//     │       ├─ REVIEW (flex:1)
//     │       └─ INTEGRATE (flex:1)
//     ├─ command log (flex-shrink:0, border-top)
//     └─ footer: $ prompt
// ---------------------------------------------------------------------------

const FLIGHT_LANES: readonly BoardLane[] = ['active', 'review', 'integrate'];

const LANE_LABELS: Record<BoardLane, string> = {
  backlog: 'BACKLOG',
  refined: 'REFINED',
  active: 'ACTIVE',
  review: 'REVIEW',
  integrate: 'INTEGRATE',
  shipped: 'SHIPPED',
};

/** Classify label to short badge (matches design: [cls] on cards). */
function classifyLabel(labels: readonly string[]): string {
  if (labels.length === 0) {
    return '';
  }
  return labels[0] || '';
}

/** Format attention reason into "why" text (matches design attention rail). */
function attentionWhy(reason: { kind: string; detail?: string }): string {
  switch (reason.kind) {
    case 'blocking':
      return reason.detail || 'mission is blocked';
    case 'gate-failed':
      return reason.detail || 'verification gate failed';
    case 'review-lane':
      return reason.detail || 'awaiting review decision';
    case 'integrate-lane':
      return reason.detail || 'awaiting integration';
    default:
      return reason.detail || '';
  }
}

/** Suggest the px command for an attention item. */
function attentionCommand(card: MissionCard, reason: { kind: string }): string {
  switch (reason.kind) {
    case 'integrate-lane':
      return `px integrate ${card.id}`;
    case 'review-lane':
      return `px review ${card.id}`;
    case 'gate-failed':
    case 'blocking':
      return `px active ${card.id}`;
    default:
      return `px ${card.lane} ${card.id}`;
  }
}

/**
 * BoardShell — renders the full design layout.
 *
 * In TTY mode: side-by-side columns (attention rail | board).
 * In headless mode (piped): Ink renders as static text dump.
 */
export function BoardShell({ projection }: { readonly projection: BoardProjection }): React.ReactElement {
  const { exit } = useApp();

  const hasStale = projection.sourceFacts.some((fact) => fact.status === 'stale');
  const hasUnavailable = projection.sourceFacts.some((fact) => fact.status === 'unavailable');

  const wipCount = projection.wipCounts.reduce((sum, wc) => sum + wc.count, 0);
  const attnCount = projection.attentionQueue.filter(
    (item) => item.reason.kind !== 'none',
  ).length;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* ═══ TOP BAR ═══ */}
      <Box flexDirection="row" borderBottomColor="gray" paddingBottom={0} paddingRight={0} paddingLeft={0} justifyContent="space-between">
        <Box>
          <Text bold color="green">px board</Text>
          <Text color="gray">{` ${projection.repositoryId}`}</Text>
          <Text color="gray">{` wip ${wipCount}`}</Text>
          <Text color="gray">{` · attention `}</Text>
          <Text color="yellow">{String(attnCount)}</Text>
        </Box>
        {(hasStale || hasUnavailable) && (
          <Box>
            <Text color="yellow">
              {hasStale ? '⚠ stale' : ''}
              {hasStale && hasUnavailable ? ' · ' : ''}
              {hasUnavailable ? '⚠ unavailable' : ''}
            </Text>
          </Box>
        )}
      </Box>

      {/* ═══ MAIN: attention rail (left) | board (right) ═══ */}
      <Box flexDirection="row" flexGrow={1} minHeight={15}>
        {/* ── ATTENTION RAIL ── */}
        <Box flexDirection="column" width={34} borderStyle="single" borderColor="gray" paddingX={1}>
          <Box>
            <Text bold color="yellow">▲ NEEDS YOU NEXT</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} paddingTop={1}>
            <AttentionItems queue={projection.attentionQueue} />
          </Box>
          <Box paddingTop={1}>
            <Text wrap="end" dimColor>{'ranked: integrate>review>active'}</Text>
          </Box>
        </Box>

        {/* ── BOARD AREA ── */}
        <Box flexDirection="row" flexGrow={1} paddingX={1}>
          {/* INTAKE column: Refined (top) + Backlog (bottom) */}
          <Box flexDirection="column" width={30}>
            <LaneHeader lane="refined" count={getCount(projection, 'refined')} />
            <Box flexDirection="column" flexGrow={1}>
              {getStage(projection, 'refined')?.cards.map((card) => (
                <Card key={card.id} card={card} lane="refined" />
              ))}
              {(!getStage(projection, 'refined') || getStage(projection, 'refined')!.cards.length === 0) && (
                <Text dimColor>nothing refined — draft from backlog</Text>
              )}
            </Box>

            <Box marginTop={1}>
              <LaneHeader lane="backlog" count={getCount(projection, 'backlog')} />
            </Box>
            <Box flexDirection="column" flexGrow={2}>
              {getStage(projection, 'backlog')?.cards.slice(0, 8).map((card) => (
                <Card key={card.id} card={card} lane="backlog" />
              ))}
              {getStage(projection, 'backlog') && getStage(projection, 'backlog')!.cards.length > 8 && (
                <Text dimColor>{`+${getStage(projection, 'backlog')!.cards.length - 8} more`}</Text>
              )}
            </Box>
          </Box>

          {/* IN-FLIGHT columns: ACTIVE | REVIEW | INTEGRATE */}
          {FLIGHT_LANES.map((lane) => (
            <Box key={lane} flexDirection="column" flexBasis={26} flexGrow={1} paddingX={1}>
              <LaneHeader lane={lane} count={getCount(projection, lane)} />
              <Box flexDirection="column" flexGrow={1} paddingTop={1}>
                {getStage(projection, lane)?.cards.map((card) => (
                  <Card key={card.id} card={card} lane={lane} />
                ))}
                {(!getStage(projection, lane) || getStage(projection, lane)!.cards.length === 0) && (
                  <Text dimColor>nothing in {lane}</Text>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ═══ COMMAND LOG ═══ */}
      <Box flexDirection="column" borderTopColor="gray" paddingTop={1} minHeight={3}>
        {projection.operationLog.length > 0 ? (
          projection.operationLog.slice(-4).map((entry, idx) => (
            <Box key={idx}>
              <Text dimColor>{formatLogEntry(entry)}</Text>
            </Box>
          ))
        ) : (
          <Text dimColor>no recent operations</Text>
        )}
        <Box>
          <Text color="gray">$ </Text>
          <Text bold color="green">▌</Text>
        </Box>
      </Box>

      {/* Key handler */}
      <KeyHandler onExit={() => exit(0)} />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Attention items
// ---------------------------------------------------------------------------

function AttentionItems({ queue }: { readonly queue: BoardProjection['attentionQueue'] }): React.ReactElement {
  const items = queue.filter((item) => item.reason.kind !== 'none');

  if (items.length === 0) {
    return <Text dimColor>nothing needs attention</Text>;
  }

  return (
    <Box flexDirection="column">
      {items.slice(0, 5).map((item, idx) => (
        <Box key={item.missionId} flexDirection="column" marginBottom={1}>
          <Box>
            <Text color="gray">{String(idx + 1).padStart(2, '0')}</Text>
            <Text bold color="blue">{` ${item.card.id}`}</Text>
          </Box>
          <Box>
            <Text color={getReasonColor(item.reason.kind)}>{` [${item.reason.kind}]`}</Text>
          </Box>
          <Box>
            <Text wrap="end" dimColor>{attentionWhy(item.reason)}</Text>
          </Box>
          <Box>
            <Text wrap="end" color="gray">{`$ ${attentionCommand(item.card, item.reason)}`}</Text>
          </Box>
        </Box>
      ))}
      {items.length > 5 && (
        <Text dimColor>{`+${items.length - 5} more`}</Text>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Lane header: ── LANE_NAME count
// ---------------------------------------------------------------------------

function LaneHeader({ lane, count }: { readonly lane: BoardLane; readonly count: number }): React.ReactElement {
  return (
    <Box borderBottomColor="gray">
      <Text color="gray">── </Text>
      <Text bold>{LANE_LABELS[lane]}</Text>
      <Text color="gray">{` ${count}`}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Mission card: slug [cls] agent / title / cp · gate / next
// ---------------------------------------------------------------------------

function Card({ card, lane }: { readonly card: MissionCard; readonly lane: BoardLane }): React.ReactElement {
  const cls = classifyLabel(card.labels);
  const title = card.title && !isPlaceholderTitle(card.title) ? card.title : null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Header row: │ slug [cls] ... agent */}
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={getCardBorderColor(card)}>│ </Text>
        <Box>
          <Text bold color="blue">{card.id}</Text>
          {cls && <Text color="gray">{` [${cls}]`}</Text>}
        </Box>
        {card.agent && (
          <Text color={getAgentColor(card.agent)}>{card.agent}</Text>
        )}
      </Box>

      {/* Title */}
      {title && (
        <Box>
          <Text wrap="end">{title}</Text>
        </Box>
      )}

      {/* In-flight detail: checkpoint · gate / next */}
      {isInFlight(lane) && (
        <>
          {(card.checkpoint || (card.gate && card.gate !== 'unknown')) && (
            <Box>
              {card.checkpoint && <Text color="gray">{card.checkpoint}</Text>}
              {card.checkpoint && card.gate && card.gate !== 'unknown' && <Text color="gray">{' · '}</Text>}
              {card.gate && card.gate !== 'unknown' && (
                <Text color={card.gate === 'passed' ? 'green' : card.gate === 'failed' ? 'red' : 'gray'}>
                  {card.gate === 'passed' ? 'gate ✓' : card.gate === 'failed' ? 'gate ✗' : 'gate ·'}
                </Text>
              )}
            </Box>
          )}
          {card.nextActionText && (
            <Box>
              <Text color="gray">next: </Text>
              <Text wrap="end" dimColor>{card.nextActionText}</Text>
            </Box>
          )}
        </>
      )}

      {/* Review info */}
      {lane === 'review' && card.pullRequest && (
        <Box>
          <Text color="gray">{`PR ${card.pullRequest.id}`}</Text>
          {card.reviewApproved && <Text color="green"> approved</Text>}
        </Box>
      )}

      {/* Blocking flag */}
      {card.blockingReason && (
        <Box>
          <Text bold color="red">▲ </Text>
          <Text wrap="end" color="red">{card.blockingReason}</Text>
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStage(
  projection: BoardProjection,
  lane: BoardLane,
): { lane: BoardLane; cards: readonly MissionCard[]; count: number } | null {
  return projection.stages.find((s) => s.lane === lane) ?? null;
}

function getCount(projection: BoardProjection, lane: BoardLane): number {
  return projection.wipCounts.find((wc) => wc.lane === lane)?.count ?? 0;
}

function isInFlight(lane: BoardLane): boolean {
  return ['active', 'review', 'integrate'].includes(lane);
}

function isPlaceholderTitle(title: string): boolean {
  return title === '>- ' || title === '>-' || title.trim() === '';
}

function getCardBorderColor(card: MissionCard): 'green' | 'red' | 'yellow' | 'blue' | 'magenta' | 'gray' {
  if (card.blockingReason) { return 'red'; }
  if (card.gate === 'failed') { return 'yellow'; }
  if (card.gate === 'passed') { return 'green'; }
  if (card.agent) { return getAgentColor(card.agent); }
  return 'gray';
}

function getReasonColor(kind: string): 'green' | 'yellow' | 'red' | 'blue' {
  switch (kind) {
    case 'blocking': return 'red';
    case 'gate-failed': return 'yellow';
    case 'review-lane': return 'blue';
    case 'integrate-lane': return 'green';
    default: return 'yellow';
  }
}

function getAgentColor(agent: string): 'blue' | 'yellow' | 'magenta' | 'green' {
  switch (agent) {
    case 'codex': return 'blue';
    case 'claude': return 'yellow';
    case 'mistral': return 'magenta';
    case 'custom': return 'green';
    default: return 'blue';
  }
}

function formatLogEntry(entry: { operationId: string; phase: string; message: string; timestamp: string; agent?: string }): string {
  const agentTag = entry.agent ? ` [${entry.agent}]` : '';
  return `${entry.timestamp} ${entry.phase}${agentTag} ${entry.message}`;
}

// ---------------------------------------------------------------------------
// Key handler — exits on 'q' or Ctrl+C
// ---------------------------------------------------------------------------

function KeyHandler({ onExit }: { readonly onExit: () => void }): React.ReactElement {
  const { stdin, setRawMode } = useStdin();

  React.useEffect(() => {
    const handleData = (data: string | Buffer) => {
      const char = typeof data === 'string' ? data : data.toString();
      if (char === 'q' || char === '\u0003') {
        onExit();
      }
    };

    try {
      setRawMode(true);
    } catch {
      // stdin is not a TTY (piped / CI) — skip raw mode
    }
    stdin.resume();
    stdin.on('data', handleData);

    return () => {
      stdin.removeListener('data', handleData);
      try { setRawMode(false); } catch {}
    };
  }, [stdin, setRawMode, onExit]);

  return <></>;
}
