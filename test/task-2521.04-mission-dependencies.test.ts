/**
 * TASK-2521.04 — Mission dependencies as a domain value and a reported field.
 *
 * The end-to-end `px depends` round trip through a real database lives in
 * `test/task-2521.04-mission-dependencies.integration.test.ts`. This suite
 * covers the rules and the two reads that show them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MissionDependencyViolation,
  missionDependencies,
} from '../src/domain/mission-dependencies.js';
import { renderStatus, statusJson } from '../src/interfaces/cli/status.js';
import { missionId } from '../src/domain/mission.js';
import type { StatusMissionData, StatusResult } from '../src/application/ports/cli-workflows.js';

const OWNER = missionId('task-2521.04');

function status(dependencies: readonly string[] | undefined): StatusResult {
  const missionData = {
    backlogStatus: 'active',
    assignee: 'claude',
    reviewHistory: [],
    dependencies,
  } as unknown as StatusMissionData;
  return {
    slug: 'task-2521.04',
    branch: 'mission/task-2521.04',
    missionData,
    staleWorktrees: [],
    agents: [],
    lastThreeCommits: [],
    uncommittedCount: 0,
  } as unknown as StatusResult;
}

describe('Mission dependencies', () => {
  it('records an ordered, distinct list of mission ids', () => {
    assert.deepEqual(
      missionDependencies(['task-2521.01', 'task-2521.03'], OWNER),
      ['task-2521.01', 'task-2521.03'],
    );
  });

  it('rejects a self-reference', () => {
    assert.throws(
      () => missionDependencies(['task-2521.01', 'task-2521.04'], OWNER),
      (error: unknown) => error instanceof MissionDependencyViolation
        && /cannot depend on itself/.test(error.message),
    );
  });

  it('rejects a duplicate and an id that is not a mission slug', () => {
    assert.throws(
      () => missionDependencies(['task-2521.01', 'task-2521.01'], OWNER),
      /already declared/,
    );
    assert.throws(
      () => missionDependencies(['TASK-2521.01'], OWNER),
      /is not a mission slug/,
    );
  });

  it('px status reports the recorded dependencies', () => {
    const lines: string[] = [];
    renderStatus(status(['task-2521.01', 'task-2521.03']), (message) => lines.push(message));
    assert.ok(
      lines.includes('Depends on: task-2521.01, task-2521.03'),
      `status output names the dependencies: ${lines.join(' | ')}`,
    );
  });

  it('px status says so when nothing is recorded', () => {
    const lines: string[] = [];
    renderStatus(status(undefined), (message) => lines.push(message));
    assert.ok(lines.includes('Depends on: nothing recorded'));
  });

  it('px status --json reports the recorded dependencies', () => {
    assert.deepEqual(
      JSON.parse(statusJson(status(['task-2521.01']))).dependencies,
      ['task-2521.01'],
    );
    assert.deepEqual(JSON.parse(statusJson(status(undefined))).dependencies, []);
  });
});
