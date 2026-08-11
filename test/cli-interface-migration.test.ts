import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createActiveCommand,
  parseActiveCliRequest,
  renderActiveProgress,
} from '../src/interfaces/cli/active.js';
import { createConfigCommand, parseConfigCliRequest, renderConfig } from '../src/interfaces/cli/config.js';
import { createDiffCommand, parseDiffCliRequest, renderDiffUsage } from '../src/interfaces/cli/diff.js';
import {
  createResolveConflictCommand,
  parseResolveConflictCliRequest,
  renderResolveConflictUsage,
} from '../src/interfaces/cli/resolve-conflict.js';
import { createSetupCommand, parseSetupCliRequest, renderSetupMode } from '../src/interfaces/cli/setup.js';
import { createVerifyCommand, parseVerifyCliRequest, renderVerifyStart } from '../src/interfaces/cli/verify.js';

test('CLI interface factories parse requests and delegate through injected workflow runners', async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  await createActiveCommand(request => { calls.push({ command: 'active', args: request.args }); })(['task-2332.15', '--implementer', 'codex']);
  await createConfigCommand(request => { calls.push({ command: 'config', args: request.args }); })([]);
  await createDiffCommand(request => { calls.push({ command: 'diff', args: request.args }); })(['task-2332.15']);
  await createResolveConflictCommand(request => { calls.push({ command: 'resolve-conflict', args: request.args }); })(['task-2332.15']);
  await createSetupCommand(request => { calls.push({ command: 'setup', args: request.args }); })(['--non-interactive']);
  createVerifyCommand(request => { calls.push({ command: 'verify', args: request.args }); })(['workflow']);

  assert.deepEqual(calls, [
    { command: 'active', args: ['task-2332.15', '--implementer', 'codex'] },
    { command: 'config', args: [] },
    { command: 'diff', args: ['task-2332.15'] },
    { command: 'resolve-conflict', args: ['task-2332.15'] },
    { command: 'setup', args: ['--non-interactive'] },
    { command: 'verify', args: ['workflow'] },
  ]);
});

test('CLI interface parsing and rendering exports preserve each command contract', () => {
  assert.deepEqual(parseActiveCliRequest(['task-2332.15', '--implementer', 'codex']).implementer, 'codex');
  assert.equal(parseConfigCliRequest(['--json']).args[0], '--json');
  assert.equal(parseDiffCliRequest(['task-2332.15']).explicitSlug, 'task-2332.15');
  assert.equal(parseResolveConflictCliRequest(['task-2332.15']).explicitSlug, 'task-2332.15');
  assert.equal(parseSetupCliRequest(['--non-interactive']).nonInteractive, true);
  assert.equal(parseVerifyCliRequest(['workflow']).area, 'workflow');
  assert.equal(renderConfig({ enabled: true }), '{\n  "enabled": true\n}');
  assert.equal(renderDiffUsage(), 'Usage: node parallix diff [<slug>]');
  assert.equal(renderResolveConflictUsage(), 'Usage: px resolve-conflict [<slug>]');
  assert.equal(renderSetupMode({ args: [], nonInteractive: true }), 'Non-interactive setup');
  assert.equal(renderVerifyStart({ args: [], area: 'workflow' }), 'Running verification gate for area: workflow...');
  const progress: string[] = [];
  renderActiveProgress({ phase: 'launch' }, message => progress.push(message));
  assert.deepEqual(progress, ['Launching execute agent...']);
});
