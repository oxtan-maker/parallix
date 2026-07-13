const test = require('node:test');
const assert = require('node:assert/strict');

const {
  graphifyAvailable,
  probeGraphifyAvailability,
  updateGraphifyKnowledgeGraph,
} = require('../lib/core/mission-utils');

test('probeGraphifyAvailability and graphifyAvailable distinguish missing commands from probe failures', () => {
  const missing = probeGraphifyAvailability({
    commandRunner: () => {
      const error = new Error('missing');
      // @ts-expect-error TS2339 Property 'code' does not exist on type 'Error'.
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
  // @ts-expect-error TS2339 Property 'message' does not exist on type 'unknown'.
  assert.match(failure.error.message, /permission denied/);
});

test('updateGraphifyKnowledgeGraph logs missing, probe-failed, update-failed, and success outcomes', () => {
  const logs = [];
  const missing = updateGraphifyKnowledgeGraph({
    log: msg => logs.push(msg),
    commandRunner: () => {
      const error = new Error('missing');
      // @ts-expect-error TS2339 Property 'code' does not exist on type 'Error'.
      error.code = 'ENOENT';
      throw error;
    }
  });
  assert.deepEqual(missing, { updated: false, skipped: true, reason: 'missing-command' });

  const probeFailure = updateGraphifyKnowledgeGraph({
    log: msg => logs.push(msg),
    commandRunner: () => {
      throw new Error('boom');
    }
  });
  assert.equal(probeFailure.reason, 'probe-failed');

  let calls = [];
  const updateFailure = updateGraphifyKnowledgeGraph({
    rootDir: '/tmp/graph-root',
    log: msg => logs.push(msg),
    commandRunner: (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === '--help') return { status: 0 };
      return { status: 3 };
    }
  });
  assert.equal(updateFailure.reason, 'update-failed');
  assert.equal(calls[1].args.join(' '), 'update .');
  assert.equal(calls[1].options.cwd, '/tmp/graph-root');

  const success = updateGraphifyKnowledgeGraph({
    log: msg => logs.push(msg),
    commandRunner: (_command, args) => ({ status: args[0] === '--help' ? 0 : 0 })
  });
  assert.deepEqual(success, { updated: true, skipped: false });
  assert.ok(logs.some(msg => msg.includes('graphify not found')));
  assert.ok(logs.some(msg => msg.includes('graphify probe failed')));
  assert.ok(logs.some(msg => msg.includes('graphify update failed with status 3')));
});
