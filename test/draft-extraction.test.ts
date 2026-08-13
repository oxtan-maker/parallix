import test from 'node:test';
import assert from 'node:assert/strict';
import * as setup from '../src/adapters/cli/commands/draft-setup.js';
import * as prompts from '../src/adapters/cli/commands/draft-prompts.js';
import * as conflicts from '../src/adapters/cli/commands/draft-conflicts.js';
import * as draftStats from '../src/adapters/cli/commands/draft-stats.js';

test('draft concern modules expose the extracted workflow boundaries', () => {
  for (const fn of [
    setup.ensureMissionBranch,
    setup.bootstrapBacklogTask,
    prompts.buildDraftPrompt,
    prompts.normalizeDraftClassification,
    conflicts.classifyDraftEntries,
    conflicts.enforceDraftCommitSafety,
    draftStats.recordDraftStats,
    draftStats.createDraftWorkflowAdapter,
  ]) {
    assert.equal(typeof fn, 'function');
  }
});
