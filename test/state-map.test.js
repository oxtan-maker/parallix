const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadStateMap, resolveStateMapPath, SHIPPED_STATE_MAP_PATH, toVirtual } = require('../lib/core/state-map');

test('toVirtual matches mapped statuses case-insensitively', () => {
  const map = {
    draft: 'To Do',
    ready: 'To Do',
    active: 'In Progress',
    done: 'Done',
  };

  assert.equal(toVirtual('to do', map), 'draft');
  assert.equal(toVirtual('IN PROGRESS', map), 'active');
  assert.equal(toVirtual('Done', map), 'done');
});

test('loadStateMap resolves configured state map from target repo root', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-state-map-'));
  const repoMapPath = path.join(rootDir, 'config', 'board-state.json');
  fs.mkdirSync(path.dirname(repoMapPath), { recursive: true });
  fs.writeFileSync(repoMapPath, JSON.stringify({ ready: 'queued', approved: 'accepted' }), 'utf8');

  try {
    const options = {
      rootDir,
      config: { adapters: { tasks: { stateMap: 'config/board-state.json' } } },
    };
    assert.equal(resolveStateMapPath(options), repoMapPath);
    assert.deepEqual(loadStateMap(options), { ready: 'queued', approved: 'accepted' });
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('loadStateMap falls back to shipped state map when target repo override is absent', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-state-map-missing-'));

  try {
    const options = {
      rootDir,
      config: { adapters: { tasks: { stateMap: 'missing-state-map.json' } } },
    };
    assert.equal(resolveStateMapPath(options), SHIPPED_STATE_MAP_PATH);
    assert.deepEqual(loadStateMap(options), { ready: 'refined', approved: 'ready-for-integration' });
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
