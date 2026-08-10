import test from 'node:test';
import assert from 'node:assert/strict';
import { IntegrateCommandUseCase } from '../src/application/integrate-command-use-case.js';
import { createIntegrateCommand } from '../src/interfaces/cli/integrate.js';
import { parseIntegrateCliRequest } from '../src/interfaces/cli/integrate.js';

test('integrate CLI interface delegates the unchanged argv and options to its application use case', async () => {
  const calls: unknown[][] = [];
  const command = createIntegrateCommand(new IntegrateCommandUseCase({ execute: (...args) => calls.push(args) }));
  await command(['task-2332.07', '--dry-run'], { source: 'test' });
  assert.deepEqual(calls, [[['task-2332.07', '--dry-run'], { source: 'test' }]]);
});

test('integrate CLI interface parses the public flags without adapter dependencies', () => {
  assert.deepEqual(parseIntegrateCliRequest(['task-2332.07', '--dry-run', '--real-agent', 'codex', '--real-agent-model', 'gpt-5.6-luna']), {
    explicitSlug: 'task-2332.07', dryRun: true, noIntegrationGates: false, noGate: false, realAgent: 'codex', realAgentModel: 'gpt-5.6-luna',
  });
});
