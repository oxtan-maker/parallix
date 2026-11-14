import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentRunId, agentRunIdentity } from '../../../../src/domain/agent-run.js';
import { createRunHistoryStore, openRunCapture } from '../../../../src/adapters/filesystem/run-history-store.js';
import { observeProviderExecution, projectProviderExecution } from '../../../../src/application/projections/provider-execution.js';
import { validateWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import { makeCard, makeProjection } from '../../../fixtures/board-projection.js';
import { webProjection } from '../../../fixtures/web-projection.js';
import { mkdtemp } from '../../../helpers/temp-dir.js';

test('production live invocation roles survive web transport validation (PX-0046.06 F9)', () => {
  const root = mkdtemp('px-web-execution-role-');
  const identity = agentRunIdentity({ repositoryId: 'repo', missionId: 'px-0046-web-role',
    role: 'review', family: 'custom', attempt: 1, startedAtMs: 1_790_000_000_000 });
  const capture = openRunCapture({ worktree: root, identity, runId: agentRunId(identity), terminalHost: 'pipe' });
  try {
    capture.observeExecution(4242, 'review-provider');
    const store = createRunHistoryStore({ repositoryRoot: root, repositoryKey: identity.repositoryId,
      executionAlive: () => true });
    const execution = observeProviderExecution(store, identity);
    assert.deepEqual(execution.invocations.map(run => run.role), ['review']);
    const board = makeProjection({ review: [makeCard({ id: identity.missionId, lane: 'review', status: 'review' })] });
    const snapshot = webProjection.snapshot(projectProviderExecution(board, { observe: () => execution }));
    const validation = validateWebBoardSnapshot(JSON.parse(JSON.stringify(snapshot)));
    assert.equal(validation.ok, true, JSON.stringify(validation));
    const malformed = JSON.parse(JSON.stringify(snapshot));
    malformed.stages.flatMap((stage: { cards: unknown[] }) => stage.cards)[0].execution.invocations[0].role = 42;
    assert.equal(validateWebBoardSnapshot(malformed).ok, false, 'role remains a fail-closed string field');
  } finally {
    capture.finish({ exitCode: 0, signal: null });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
