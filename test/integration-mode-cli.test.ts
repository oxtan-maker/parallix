// task-2500.01 CP-3: `px config` and `px status` surface the active integration
// mode. `local` (the default) and a configured mode both print a stable line.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

const config = mockModule<typeof import('../src/adapters/cli/commands/config.js')>('../src/adapters/cli/commands/config.js', import.meta.url);
const status = mockModule<typeof import('../src/adapters/cli/commands/status.js')>('../src/adapters/cli/commands/status.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());

function withTempConfig(config: unknown, run: (_root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2500.01-cli-'));
  try {
    if (config !== null) {
      fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify(config));
    }
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runConfig(root: string, args: string[] = []) {
  const logs: string[] = [];
  const errors: string[] = [];
  let exitCode: number | null = null;
  return config.default(args, {
    rootDir: root,
    logFn: message => logs.push(message),
    errorFn: message => errors.push(message),
    exitFn: code => { exitCode = code; },
  }).then(() => ({ logs, errors, exitCode }));
}

function runStatus(root: string) {
  const logs: string[] = [];
  let exitCode = 0;
  return status.default([], {
    exit: code => { exitCode = code; },
    log: message => logs.push(message),
    inferSlugFn: () => null,
    getCurrentBranchFn: () => 'main',
    findTaskFileFn: () => undefined,
    getTaskStatusFn: () => null,
    findMissionDirFn: () => undefined,
    findCheckpointsFn: () => undefined,
    getFirstLineFn: () => '',
    getPrStatusFn: () => ({ exists: false }),
    findStaleMissionWorktreesFn: () => [],
    readAgentConfigOrExitFn: () => ({}),
    eligibleAgentsForStepFn: () => [],
    allWorkflowAgentNamesFn: () => ['codex'],
    workflowLauncherStatusFn: () => ({ supported: false, agent: '' }),
    getLastThreeCommitsFn: () => [],
    getUncommittedCountFn: () => 0,
    detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
    buildProjectionFn: async () => { throw new Error('no projection in CLI surface test'); },
  }).then(() => ({ logs, exitCode }));
}

test('config prints an explicit active integration mode line', async () => {
  await withTempConfig({ integration: { mode: 'github-publish' } }, async root => {
    const result = await runConfig(root);
    assert.equal(result.exitCode, null);
    assert.match(result.logs.join('\n'), /Integration mode: github-publish/);
  });
  await withTempConfig(null, async root => {
    const result = await runConfig(root);
    assert.match(result.logs.join('\n'), /Integration mode: local/);
  });
});

test('status prints the active integration mode for the configured mode', async () => {
  await withTempConfig({ integration: { mode: 'github-pr' } }, async root => {
    const cwd = process.cwd();
    try {
      process.chdir(root);
      const { logs, exitCode } = await runStatus(root);
      assert.equal(exitCode, 0);
      assert.match(logs.join('\n'), /Integration mode: github-pr/);
    } finally {
      process.chdir(cwd);
    }
  });
});
