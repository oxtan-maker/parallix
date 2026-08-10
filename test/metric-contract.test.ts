import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('statistics metric contract names every board and CLI decision metric with its semantic inputs', () => {
  const contract = fs.readFileSync(path.join(process.cwd(), 'docs/metric-contract.md'), 'utf8');
  for (const required of [
    'Repository identity',
    'Lifecycle authority',
    '`completedAt`',
    'Flow / WIP by lane',
    'Lifecycle cycle time',
    'Lane dwell',
    'Current lane age / bottleneck',
    'Throughput / weekly throughput',
    'Review bounce rate',
    'Review-fix rounds',
    'Agent runtime',
    'Tokens, cost, tool calls',
    'Cohort comparison',
  ]) {
    assert.match(contract, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
