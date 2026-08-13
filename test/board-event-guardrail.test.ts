import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Single-writer guardrail for lane-transition events (TASK-2347.02, SC5).
//
// `SqliteMissionStore.saveWithTransition` is the only code path that appends a
// `board_lane_events` row: it commits the aggregate change and the event that
// describes it as one unit (ADR 0053 transaction rule 1). Before this mission
// the designated writer was `src/adapters/backlog/backlog.ts`, which opened its
// own database and built its own event in parallel with the aggregate path —
// two writers that could disagree on agent, timestamp and idempotency key for
// the same transition. That block now delegates to the store, and these tests
// fail if any second writer reappears.

const repoRoot = path.resolve(process.cwd());

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Skip temp files created by other tests (e.g., __temp-violating-file.ts)
    // to avoid race conditions when tests run concurrently.
    if (entry.name.startsWith('__temp-')) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
      results.push(...findTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const rel = path.relative(repoRoot, fullPath);
      results.push(rel);
    }
  }
  return results;
}

/** The single module allowed to append lane events. */
const DESIGNATED_WRITER = 'src/adapters/sqlite/mission-store.ts';

/** The seam that used to write lane events itself and now delegates. */
const MARKDOWN_TRANSITION_MODULE = 'src/adapters/backlog/task-transitions.ts';

// Files that define, wire or read the event contract. They may name the
// recorder, repository or table without being a write path.
const RECORDER_MODULE = 'src/application/recording/board-event-recorder.ts';
const DOMAIN_MODULE = 'src/domain/board-event.ts';
const REPOSITORY_MODULE = 'src/adapters/sqlite/board-lane-event-repository.ts';
const PORTS_MODULE = 'src/adapters/sqlite/ports.ts';
const AUTHORITY_MAP_MODULE = 'src/adapters/sqlite/authority-map.ts';
const METRICS_ADAPTER_MODULE = 'src/application/projections/metrics-read-adapter.ts';
const STATUS_COMMAND_MODULE = 'src/adapters/cli/commands/status.ts';
/** Reads lane history to compare cohorts; it never appends. */
const STATS_COHORTS_COMMAND_MODULE = 'src/adapters/cli/commands/stats-cohorts.ts';
const TUI_COMMAND_MODULE = 'src/interfaces/tui/ui-command.ts';
const INDEX_MODULE = 'src/adapters/sqlite/index.ts';
const APPLICATION_PORTS_MODULE = 'src/application/ports.ts';
const OPERATION_HISTORY_PORT_MODULE = 'src/application/ports/operation-history.ts';
const COMPOSITION_ROOT_MODULE = 'src/composition/application-services.ts';
const BOARD_COMPOSITION_MODULE = 'src/composition/board-projection.ts';
const PRODUCTION_CAPABILITIES_MODULE = 'src/composition/production-capabilities.ts';

const CONTRACT_MODULES = new Set([
  RECORDER_MODULE,
  DOMAIN_MODULE,
  REPOSITORY_MODULE,
  PORTS_MODULE,
  AUTHORITY_MAP_MODULE,
  METRICS_ADAPTER_MODULE,
  STATUS_COMMAND_MODULE,
  STATS_COHORTS_COMMAND_MODULE,
  TUI_COMMAND_MODULE,
  INDEX_MODULE,
  APPLICATION_PORTS_MODULE,
  OPERATION_HISTORY_PORT_MODULE,
  COMPOSITION_ROOT_MODULE,
  BOARD_COMPOSITION_MODULE,
  PRODUCTION_CAPABILITIES_MODULE,
]);

function sourceFiles(): string[] {
  return findTsFiles(path.join(repoRoot, 'src'));
}

function read(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

/** Drop comment lines so a mention in prose is not read as a write. */
function codeOnly(content: string): string {
  return content
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

test('SC5: only SqliteMissionStore appends lane events', () => {
  const offenders: string[] = [];

  for (const relPath of sourceFiles()) {
    if (relPath === DESIGNATED_WRITER || CONTRACT_MODULES.has(relPath)) {
      continue;
    }
    const content = codeOnly(read(relPath));
    // Appending an event means reaching the recorder or the repository/table
    // directly. Building a `LaneTransitionEvent` value is not a write: the
    // event still has to be handed to the store to become a row.
    const appendsLaneEvents = content.includes('board_lane_events')
      || content.includes('BoardLaneEventRepository')
      || content.includes('BoardLaneEventEntry')
      || content.includes('BoardEventRecorder')
      || content.includes('recordLaneTransitionSafely');

    if (appendsLaneEvents) {
      offenders.push(relPath);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Source files appending lane events outside ${DESIGNATED_WRITER}: ${offenders.join(', ')}`,
  );
});

test('SC5: the designated writer appends the event inside saveWithTransition', () => {
  const content = read(DESIGNATED_WRITER);

  assert.ok(
    content.includes('saveWithTransition'),
    `${DESIGNATED_WRITER} must expose saveWithTransition`,
  );

  const appendCalls = content.match(/this\.eventRepo\.append\(/g) ?? [];
  assert.equal(
    appendCalls.length,
    1,
    `the lane event must be appended from exactly one place in ${DESIGNATED_WRITER}, found ${appendCalls.length}`,
  );

  const transitionStart = content.indexOf('private async saveAggregateWithTransition(');
  assert.ok(transitionStart !== -1, 'saveAggregateWithTransition must exist');
  const appendIndex = content.indexOf('this.eventRepo.append(');
  assert.ok(
    appendIndex > transitionStart,
    'the append call must live inside saveAggregateWithTransition',
  );
});

test('SC5: the Markdown transition seam delegates instead of writing its own event', () => {
  const content = codeOnly(read(MARKDOWN_TRANSITION_MODULE));

  assert.ok(
    content.includes('saveWithTransition'),
    `${MARKDOWN_TRANSITION_MODULE} must record lane changes through saveWithTransition`,
  );
  for (const forbidden of [
    'board_lane_events',
    'BoardEventRecorder',
    'recordLaneTransitionSafely',
    'SqliteBoardLaneEventRepository',
  ]) {
    assert.ok(
      !content.includes(forbidden),
      `${MARKDOWN_TRANSITION_MODULE} must not reach ${forbidden} directly; the store owns lane events`,
    );
  }
});

test('SC6: no lane-event idempotency key is derived from the wall clock', () => {
  for (const relPath of sourceFiles()) {
    const content = codeOnly(read(relPath));
    const keyLines = content
      .split('\n')
      .filter((line) => line.includes('idempotencyKey'));
    for (const line of keyLines) {
      assert.ok(
        !line.includes('Date.now()'),
        `${relPath} derives an idempotency key from the wall clock: ${line.trim()}`,
      );
    }
  }
});

test('domain model: board_lane_events uses dedicated table (not operational_history JSON blobs)', () => {
  // Verify the migration creates a dedicated table, not indexes on operational_history
  const migrationPath = path.join(repoRoot, 'src/adapters/sqlite/migrations/0003-board-lane-events.sql');
  const content = fs.readFileSync(migrationPath, 'utf8');

  // Must create a table (not just indexes on operational_history)
  assert.ok(
    content.includes('CREATE TABLE') && content.includes('board_lane_events'),
    'migration 0003 must create a dedicated board_lane_events table',
  );

  // Must have typed columns (not just JSON in event_data)
  assert.ok(
    content.includes('mission_id TEXT'),
    'board_lane_events must have typed mission_id column',
  );
  assert.ok(
    content.includes('from_status TEXT'),
    'board_lane_events must have typed from_status column',
  );
  assert.ok(
    content.includes('to_status TEXT'),
    'board_lane_events must have typed to_status column',
  );
  assert.ok(
    content.includes('trigger TEXT'),
    'board_lane_events must have typed trigger column',
  );
});
