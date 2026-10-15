import React from 'react';
import { Box, Text } from 'ink';

import { projectMissionActivity } from '../../application/projections/mission-activity.js';
import { BoardLayout } from './board-layout.js';

import { moveSelection } from './navigation.js';

import { ConfirmationDialog } from './confirmation-dialog.js';
import { OutcomeBanner } from './outcome-banner.js';
import { FlowPanel } from './flow-panel.js';
import { AgentStrip } from './agent-strip.js';

import { AttentionItems } from './shell-attention.js';
import { KeyHandler } from './shell-keyboard.js';
import type { BoardShellState } from './shell.js';
export const RAIL_WIDTH = 34;

export function BoardShellView({ state }: { state: BoardShellState }): React.ReactElement {
  const { projection, width, height, mode, railBeside, boardWidth, attnCount, navigation, flowOpen, focusedAttentionIndex, focusedArea, doneCollapsed, queueItems, sourceStatusMap, exit, setNavigation, maxVisibleCards, setShowKeyboardHelp, setFlowOpen, setDoneCollapsed, setFocusedAttentionIndex, setFocusedArea, confirmation, outcome, controller, dispatchMissionAction, startAction, dispatchLifecycle, confirmAction, cancelAction } = state;
  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* ═══ TOP BAR ═══ */}
      <ShellHeader {...state} />

      {flowOpen && <FlowPanel metrics={projection.metrics} columns={width} />}

      {/* ═══ AGENT STRIP ═══ */}
      <AgentStrip
        agentAvailability={projection.metrics.agentAvailability}
        unattributedRunningSessions={projection.metrics.unattributedRunningSessions}
        missionActivity={projection.stages.flatMap((stage) => stage.cards).map(projectMissionActivity)}
      />

      {/* ═══ MAIN: attention rail + board, side by side or stacked ═══ */}
      <Box flexDirection={railBeside ? 'row' : 'column'} flexGrow={1} minHeight={15}>
        {/* ── OPERATOR RAIL ── */}
        <Box
          flexDirection="column"
          width={railBeside ? RAIL_WIDTH : undefined}
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          {/* The rail's first content is the attention heading. The previously
              rendered live-work count and `task-… · phase · agent` rows were
              unsupported rail content (task-2408): the authoritative work
              summary lives in the agent strip, not here. */}
          <Box flexDirection="row" paddingTop={1}>
            <Text bold color="yellow">▲ NEEDS YOU NEXT</Text>
            <Text color="gray">{' '}{attnCount}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} paddingTop={1}>
            <AttentionItems
              queue={projection.attentionQueue}
              selectedMissionId={navigation.selectedMissionId}
              focusedIndex={focusedArea === 'rail' ? focusedAttentionIndex : -1}
              sourceStatusMap={sourceStatusMap}
              commandController={controller}
            />
          </Box>
          <Box paddingTop={1}>
            <Text wrap="end" dimColor>{'ranked: integrate>review>active'}</Text>
          </Box>
        </Box>

        {/* ── BOARD AREA: the six lane columns ── */}
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          <BoardLayout
            projection={projection}
            mode={mode}
            columns={boardWidth}
            rows={height}
            selectedMissionId={navigation.selectedMissionId}
            visibleStarts={navigation.visibleStarts}
            doneCollapsed={doneCollapsed}
          />
        </Box>
      </Box>

      {confirmation && <ConfirmationDialog kind={confirmation.kind} missionId={confirmation.mission.id} />}
      {outcome && <OutcomeBanner outcome={outcome} />}

      {/* ═══ COMMAND LOG ═══ */}
      <ShellCommandLog {...state} />

      {/* Key handler */}
      <KeyHandler
        onExit={() => exit(0)}
        onNavigate={(key) => {
          if (key === 'self') { return; }
          setNavigation((previous) => moveSelection(previous, projection, key, maxVisibleCards));
        }}
        onToggleHelp={() => setShowKeyboardHelp((visible) => !visible)}
        onToggleFlow={() => setFlowOpen((visible) => !visible)}
        onToggleDone={() => setDoneCollapsed((c) => !c)}
        onEnterAttention={(item) => {
          setNavigation((previous) => ({ ...previous, selectedMissionId: item.missionId }));
          dispatchMissionAction(item.action.kind, item.card);
        }}
        onStartAction={startAction}
        selectedMissionId={navigation.selectedMissionId}
        onConfirm={() => { void confirmAction(); }}
        onCancel={cancelAction}
        onLifecycle={dispatchLifecycle}
        queueItems={queueItems}
        focusedAttentionIndex={focusedAttentionIndex}
        setFocusedIdx={setFocusedAttentionIndex}
        focusedArea={focusedArea}
        setFocusedArea={setFocusedArea}
      />
    </Box>
  );
}

function ShellHeader(state: Pick<BoardShellState, 'projection' | 'wipCount' | 'attnCount' | 'hasStale' | 'hasUnavailable' | 'flowOpen'>): React.ReactElement {
  const { projection, wipCount, attnCount, hasStale, hasUnavailable, flowOpen } = state;
  return (<Box flexDirection="row" borderBottomColor="gray" paddingBottom={0} paddingRight={0} paddingLeft={0} justifyContent="space-between">
    <Box>
      <Text bold color="green">px board</Text>
      <Text color="gray">{` ${projection.repositoryId}`}</Text>
      <Text color="gray">{` wip ${wipCount}`}</Text>
      <Text color="gray">{` · attention `}</Text>
      <Text color="yellow">{String(attnCount)}</Text>
    </Box>
    <Box>
      {(hasStale || hasUnavailable) && (
        <Text color="yellow">
          {hasStale ? '⚠ stale' : ''}
          {hasStale && hasUnavailable ? ' · ' : ''}
          {hasUnavailable ? '⚠ unavailable' : ''}
          {'  '}
        </Text>
      )}
      <Text color={flowOpen ? 'cyan' : 'gray'}>{flowOpen ? '▤ FLOW' : '▥ FLOW'}</Text>
    </Box>
  </Box>);
}
function ShellCommandLog(state: Pick<BoardShellState, 'projection' | 'liveEvents' | 'showKeyboardHelp'>): React.ReactElement {
  const { projection, liveEvents, showKeyboardHelp } = state;
  return (<Box flexDirection="column" borderTopColor="gray" paddingTop={1} minHeight={3}>
    {[...projection.operationLog, ...liveEvents].length > 0 ? (
      [...projection.operationLog, ...liveEvents].slice(-4).map((entry, idx) => (
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
    <Text color="gray">
      {showKeyboardHelp
        ? 'arrows/WASD: move · Enter: execute · Ctrl+D/A/R: lifecycle · Shift+X: cancel · Shift+S: done · f: FLOW · ?: hide help · q/Ctrl+C: quit'
        : 'arrows/WASD: move · Enter: execute · Ctrl+D/A/R: lifecycle · Shift+X: cancel · Shift+S: done · f: FLOW · ?: help · q: quit'}
    </Text>
  </Box>);
}
function formatLogEntry(entry: { operationId: string; phase: string; message: string; timestamp: string; agent?: string }): string {
  const agentTag = entry.agent ? ` [${entry.agent}]` : '';
  return `${entry.timestamp} ${entry.phase}${agentTag} ${entry.message}`;
}

