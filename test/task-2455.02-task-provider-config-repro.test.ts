import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getTaskStorage } from '../src/adapters/backlog/task-file-io.js';
import {
  resolveTaskProvider,
  resolveTaskStorage,
  validateWorkflowConfig,
} from '../src/adapters/config/product-config.js';

// task-2455.02: `adapters.tasks.provider` was schema-declared and written by
// setup, but no code read it. An operator could persist `other`, see it echoed
// back, and still get backlog-Markdown task behavior. `backlog-md` is the only
// supported provider in this release, so unsupported values must be rejected by
// configuration validation and must not resolve to a task adapter.

function withTempRoot(config: unknown, fn: (_root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2455-02-provider-'));
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const OTHER_PROVIDER_CONFIG = { adapters: { tasks: { provider: 'other' } } };

test('an unsupported adapters.tasks.provider is rejected by configuration validation', () => {
  const issues = validateWorkflowConfig(OTHER_PROVIDER_CONFIG);

  assert.ok(
    issues.some(issue => issue.includes('adapters.tasks.provider')),
    `expected a validation issue for adapters.tasks.provider, got ${JSON.stringify(issues)}`,
  );
  assert.ok(
    issues.some(issue => issue.includes('backlog-md')),
    `expected the supported value to be named in ${JSON.stringify(issues)}`,
  );
});

test('an unsupported adapters.tasks.provider does not compose the backlog-Markdown task adapter', () => {
  withTempRoot(OTHER_PROVIDER_CONFIG, root => {
    assert.throws(() => resolveTaskStorage(root), /adapters\.tasks\.provider/);
  });
});

test('an unsupported adapters.tasks.provider stops the backlog-Markdown task file adapter', () => {
  withTempRoot(OTHER_PROVIDER_CONFIG, root => {
    assert.throws(() => resolveTaskProvider(root), /adapters\.tasks\.provider/);
    assert.throws(() => getTaskStorage(root), /adapters\.tasks\.provider/);
  });
});

test('the supported adapters.tasks.provider selects the backlog-Markdown task adapter', () => {
  withTempRoot({ adapters: { tasks: { provider: 'backlog-md', storage: 'backlog' } } }, root => {
    assert.deepEqual(validateWorkflowConfig({ adapters: { tasks: { provider: 'backlog-md' } } }), []);
    assert.equal(resolveTaskProvider(root), 'backlog-md');
    assert.equal(getTaskStorage(root).tasksDir, path.join(root, 'backlog', 'tasks'));
  });
});

test('an omitted adapters.tasks.provider keeps the default backlog-Markdown selection', () => {
  withTempRoot({ adapters: { tasks: { storage: 'backlog' } } }, root => {
    assert.equal(resolveTaskProvider(root), 'backlog-md');
    assert.equal(resolveTaskStorage(root).tasksDir, path.join(root, 'backlog', 'tasks'));
  });
});
