import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// SC2: Guardrail test — only the designated write-path module (backlog.ts)
// calls the BoardEventRecorder. Any other source file writing lane-transition
// events or importing the recorder violates the single-path contract.
//
// SC3: The recorder is called from exactly one location in
// transitionTaskOnIntegrationBranch; no other function calls it.

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

// The single allowed write-path module for BoardEventRecorder
const DESIGNATED_WRITER = 'src/adapters/backlog/backlog.ts';

// Files that define or test the recorder (allowed to import it without
// violating the guardrail — they are the recorder itself or its tests)
const RECORDER_MODULE = 'src/application/recording/board-event-recorder.ts';
const DOMAIN_MODULE = 'src/domain/board-event.ts';
const REPOSITORY_MODULE = 'src/adapters/sqlite/board-lane-event-repository.ts';
const PORTS_MODULE = 'src/adapters/sqlite/ports.ts';
const AUTHORITY_MAP_MODULE = 'src/adapters/sqlite/authority-map.ts';
const METRICS_ADAPTER_MODULE = 'src/application/projections/metrics-read-adapter.ts';
const STATUS_COMMAND_MODULE = 'src/adapters/cli/commands/status.ts';
const TUI_COMMAND_MODULE = 'src/interfaces/tui/ui-command.ts';
const INDEX_MODULE = 'src/adapters/sqlite/index.ts';
const MISSION_STORE_MODULE = 'src/adapters/sqlite/mission-store.ts';
const APPLICATION_PORTS_MODULE = 'src/application/ports.ts';
const COMPOSITION_ROOT_MODULE = 'src/composition/application-services.ts';
const BOARD_COMPOSITION_MODULE = 'src/composition/board-projection.ts';
const PRODUCTION_CAPABILITIES_MODULE = 'src/composition/production-capabilities.ts';

test('SC2: only the designated write-path module imports BoardEventRecorder outside the recorder package', () => {
  const srcDir = path.join(repoRoot, 'src');
  const allTsFiles = findTsFiles(srcDir);

  const offenders: string[] = [];

  for (const relPath of allTsFiles) {
    // Skip the recorder module itself, domain definitions, repository,
    // ports, and authority map (infrastructure files that define the contract)
    if (
      relPath === RECORDER_MODULE
      || relPath === DOMAIN_MODULE
      || relPath === REPOSITORY_MODULE
      || relPath === PORTS_MODULE
      || relPath === AUTHORITY_MAP_MODULE
    ) {
      continue;
    }

    const fullPath = path.join(repoRoot, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Check if this file imports BoardEventRecorder or recordLaneTransitionSafely
    // (the two exported names from the recorder module)
    const importsRecorder = content.includes('BoardEventRecorder')
      || content.includes('recordLaneTransitionSafely')
      || content.includes('eventToEntry')
      || content.includes('entryToEvent')
      || content.includes('laneTransitionEventToMissionTransition');

    if (importsRecorder && relPath !== DESIGNATED_WRITER) {
      // Verify it's an actual import (not just a comment or string literal)
      const importLine = content.match(/import.*(?:BoardEventRecorder|recordLaneTransitionSafely|eventToEntry|entryToEvent|laneTransitionEventToMissionTransition)/);
      if (importLine) {
        offenders.push(relPath);
      }
    }
  }

  assert.strictEqual(
    offenders.length,
    0,
    `Modules importing the board-event recorder outside the designated write path: ${offenders.join(', ')}. Only ${DESIGNATED_WRITER} may call the recorder.`,
  );
});

test('SC3: transitionTaskOnIntegrationBranch contains the recorder call and is the single call site', () => {
  const backlogPath = path.join(repoRoot, DESIGNATED_WRITER);
  const content = fs.readFileSync(backlogPath, 'utf8');

  // The function must contain a call to recordLaneTransitionSafely
  assert.ok(
    content.includes('recordLaneTransitionSafely'),
    'transitionTaskOnIntegrationBranch must call recordLaneTransitionSafely',
  );

  // The recorder import must be present (dynamic import)
  assert.ok(
    content.includes('board-event-recorder'),
    'backlog.ts must import the board-event-recorder module',
  );

  // Verify the call is inside transitionTaskOnIntegrationBranch (not in another function)
  const functionStart = content.indexOf('function transitionTaskOnIntegrationBranch(');
  assert.ok(functionStart !== -1, 'transitionTaskOnIntegrationBranch function must exist');

  // Find the next function declaration after transitionTaskOnIntegrationBranch
  const afterStart = content.slice(functionStart);
  // Look for the next 'function ' or 'export function ' after the first line
  const nextFunctionMatch = afterStart.slice(1).match(/^\s*(?:export\s+)?function\s+/m);
  const functionEnd = nextFunctionMatch ? functionStart + 1 + nextFunctionMatch.index : content.length;
  const functionBody = afterStart.slice(0, functionEnd);

  assert.ok(
    functionBody.includes('recordLaneTransitionSafely'),
    'recordLaneTransitionSafely must be called inside transitionTaskOnIntegrationBranch',
  );
});

test('SC3: no other function in backlog.ts calls the recorder', () => {
  const backlogPath = path.join(repoRoot, DESIGNATED_WRITER);
  const content = fs.readFileSync(backlogPath, 'utf8');

  // Count occurrences of recordLaneTransitionSafely in the file
  const matches = content.match(/recordLaneTransitionSafely/g);
  assert.ok(matches, 'recordLaneTransitionSafely must appear in backlog.ts');

  // There should be exactly two occurrences (the import reference + the call)
  assert.equal(
    matches.length,
    2,
    `recordLaneTransitionSafely should appear exactly twice (import + call), found ${matches.length}`,
  );
});

test('SC2: no source file writes lane-transition events outside backlog.ts', () => {
  const srcDir = path.join(repoRoot, 'src');
  const allTsFiles = findTsFiles(srcDir);

  const offenders: string[] = [];

  for (const relPath of allTsFiles) {
    // Skip the recorder module, domain module, repository, ports,
    // authority map, metrics adapter, composition root, status command,
    // and designated writer (all are infrastructure or read-path files)
    if (
      relPath === RECORDER_MODULE
      || relPath === DOMAIN_MODULE
      || relPath === REPOSITORY_MODULE
      || relPath === PORTS_MODULE
      || relPath === AUTHORITY_MAP_MODULE
      || relPath === METRICS_ADAPTER_MODULE
      || relPath === STATUS_COMMAND_MODULE
      || relPath === TUI_COMMAND_MODULE
      || relPath === INDEX_MODULE
      || relPath === MISSION_STORE_MODULE
      || relPath === APPLICATION_PORTS_MODULE
      || relPath === 'src/application/ports/operation-history.ts'
      || relPath === COMPOSITION_ROOT_MODULE
      || relPath === BOARD_COMPOSITION_MODULE
      || relPath === PRODUCTION_CAPABILITIES_MODULE
      || relPath === DESIGNATED_WRITER
    ) {
      continue;
    }

    const fullPath = path.join(repoRoot, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Check if this file references the board_lane_events table directly
    // (bypassing the BoardLaneEventRepository)
    const writesLaneEvents = content.includes('board_lane_events')
      || content.includes('BoardLaneEventRepository')
      || content.includes('BoardLaneEventEntry');

    if (writesLaneEvents) {
      // Verify it's not just a comment
      const lines = content.split('\n');
      const codeLines = lines.filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
      });
      const codeContent = codeLines.join('\n');
      if (
        codeContent.includes('board_lane_events')
        || codeContent.includes('BoardLaneEventRepository')
        || codeContent.includes('BoardLaneEventEntry')
      ) {
        offenders.push(relPath);
      }
    }
  }

  assert.strictEqual(
    offenders.length,
    0,
    `Source files writing lane-transition events outside backlog.ts: ${offenders.join(', ')}`,
  );
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
