const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const git = require('../lib/core/git');

test('git function defaults stdio to ignore stdin', (t) => {
  const originalSpawnSync = childProcess.spawnSync;
  let capturedOptions = null;
  
  // Mock spawnSync
  childProcess.spawnSync = (cmd, args, options) => {
    capturedOptions = options;
    return { status: 0, stdout: '', stderr: '' };
  };
  
  try {
    git.git(['status']);
    assert.deepEqual(capturedOptions.stdio, ['ignore', 'pipe', 'pipe']);
  } finally {
    childProcess.spawnSync = originalSpawnSync;
  }
});

test('git function allows overriding stdio', (t) => {
  const originalSpawnSync = childProcess.spawnSync;
  let capturedOptions = null;
  
  childProcess.spawnSync = (cmd, args, options) => {
    capturedOptions = options;
    return { status: 0, stdout: '', stderr: '' };
  };
  
  try {
    git.git(['status'], { stdio: 'inherit' });
    assert.equal(capturedOptions.stdio, 'inherit');
  } finally {
    childProcess.spawnSync = originalSpawnSync;
  }
});

test('run function defaults stdio to ignore stdin', (t) => {
  const originalSpawnSync = childProcess.spawnSync;
  let capturedOptions = null;
  
  childProcess.spawnSync = (cmd, args, options) => {
    capturedOptions = options;
    return { status: 0, stdout: '', stderr: '' };
  };
  
  try {
    git.run('echo', ['hello']);
    assert.deepEqual(capturedOptions.stdio, ['ignore', 'pipe', 'pipe']);
  } finally {
    childProcess.spawnSync = originalSpawnSync;
  }
});
