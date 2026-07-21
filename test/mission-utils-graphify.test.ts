
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  graphifyAvailable,
  probeGraphifyAvailability,
  updateGraphifyKnowledgeGraph,
} = require('../dist/lib/core/mission-utils');

test('probeGraphifyAvailability and graphifyAvailable distinguish missing commands from probe failures', () => {
  const missing = probeGraphifyAvailability({
    commandRunner: () => {
      const error = new Error('missing');
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `code` absent from its inferred mock shape.
      error.code = 'ENOENT';
      throw error;
    }
  });
  assert.equal(missing.available, false);
  assert.equal(missing.reason, 'missing-command');
  assert.equal(graphifyAvailable({ commandRunner: () => ({ status: 0 }) }), true);

  const failure = probeGraphifyAvailability({
    commandRunner: () => {
      throw new Error('permission denied');
    }
  });
  assert.equal(failure.available, false);
  assert.equal(failure.reason, 'probe-failed');
  assert.match(failure.error.message, /permission denied/);
});

test('updateGraphifyKnowledgeGraph logs missing graph, missing command, probe-failed, update-failed, and success outcomes', () => {
  const graphRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graphify-update-test-'));
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graphify-empty-test-'));
  fs.mkdirSync(path.join(graphRoot, 'graphify-out'), { recursive: true });
  fs.writeFileSync(path.join(graphRoot, 'graphify-out', 'graph.json'), '{}\n');
  const logs = [];
  let missingGraphRunnerCalled = false;
  const missingGraph = updateGraphifyKnowledgeGraph({
    rootDir: emptyRoot,
    log: msg => logs.push(msg),
    commandRunner: () => {
      missingGraphRunnerCalled = true;
      return { status: 0 };
    }
  });
  assert.deepEqual(missingGraph, { updated: false, skipped: true, reason: 'missing-graph' });
  assert.equal(missingGraphRunnerCalled, false);

  const missing = updateGraphifyKnowledgeGraph({
    rootDir: graphRoot,
    log: msg => logs.push(msg),
    commandRunner: () => {
      const error = new Error('missing');
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `code` absent from its inferred mock shape.
      error.code = 'ENOENT';
      throw error;
    }
  });
  assert.deepEqual(missing, { updated: false, skipped: true, reason: 'missing-command' });

  const probeFailure = updateGraphifyKnowledgeGraph({
    rootDir: graphRoot,
    log: msg => logs.push(msg),
    commandRunner: () => {
      throw new Error('boom');
    }
  });
  assert.equal(probeFailure.reason, 'probe-failed');

  let calls = [];
  const updateFailure = updateGraphifyKnowledgeGraph({
    rootDir: graphRoot,
    log: msg => logs.push(msg),
    commandRunner: (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === '--help') return { status: 0 };
      return { status: 3 };
    }
  });
  assert.equal(updateFailure.reason, 'update-failed');
  assert.equal(calls[1].args.join(' '), 'update .');
  assert.equal(calls[1].options.cwd, graphRoot);

  const success = updateGraphifyKnowledgeGraph({
    rootDir: graphRoot,
    log: msg => logs.push(msg),
    commandRunner: (_command, args) => ({ status: args[0] === '--help' ? 0 : 0 })
  });
  assert.deepEqual(success, { updated: true, skipped: false });
  assert.ok(logs.some(msg => msg.includes('No existing graphify graph found')));
  assert.ok(logs.some(msg => msg.includes('graphify not found')));
  assert.ok(logs.some(msg => msg.includes('graphify probe failed')));
  assert.ok(logs.some(msg => msg.includes('graphify update failed with status 3')));
  fs.rmSync(graphRoot, { recursive: true, force: true });
  fs.rmSync(emptyRoot, { recursive: true, force: true });
});
