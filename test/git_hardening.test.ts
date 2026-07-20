// @ts-nocheck -- TASK-2277: preserve legacy CommonJS mock behavior while mock-shape typings are hardened separately.

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const git = require('../dist/lib/core/git');

test('git function defaults stdio to ignore stdin', (t) => {
  const originalSpawnSync = childProcess.spawnSync;
  let capturedOptions = null;
  
  // Mock spawnSync
  // @ts-expect-error TS2322 Type '(cmd: any, args: any, options: any) => { status: number; stdout: string; s
  childProcess.spawnSync = (cmd, args, options) => {
    capturedOptions = options;
    return { status: 0, stdout: '', stderr: '' };
  };
  
  try {
    git.git(['status']);
    // @ts-expect-error TS18047 'capturedOptions' is possibly 'null'.
    assert.deepEqual(capturedOptions.stdio, ['ignore', 'pipe', 'pipe']);
  } finally {
    childProcess.spawnSync = originalSpawnSync;
  }
});

test('git function allows overriding stdio', (t) => {
  const originalSpawnSync = childProcess.spawnSync;
  let capturedOptions = null;
  
  // @ts-expect-error TS2322 Type '(cmd: any, args: any, options: any) => { status: number; stdout: string; s
  childProcess.spawnSync = (cmd, args, options) => {
    capturedOptions = options;
    return { status: 0, stdout: '', stderr: '' };
  };
  
  try {
    git.git(['status'], { stdio: 'inherit' });
    // @ts-expect-error TS18047 'capturedOptions' is possibly 'null'.
    assert.equal(capturedOptions.stdio, 'inherit');
  } finally {
    childProcess.spawnSync = originalSpawnSync;
  }
});

test('run function defaults stdio to ignore stdin', (t) => {
  const originalSpawnSync = childProcess.spawnSync;
  let capturedOptions = null;
  
  // @ts-expect-error TS2322 Type '(cmd: any, args: any, options: any) => { status: number; stdout: string; s
  childProcess.spawnSync = (cmd, args, options) => {
    capturedOptions = options;
    return { status: 0, stdout: '', stderr: '' };
  };
  
  try {
    git.run('echo', ['hello']);
    // @ts-expect-error TS18047 'capturedOptions' is possibly 'null'.
    assert.deepEqual(capturedOptions.stdio, ['ignore', 'pipe', 'pipe']);
  } finally {
    childProcess.spawnSync = originalSpawnSync;
  }
});
