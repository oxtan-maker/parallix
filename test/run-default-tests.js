'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testFiles = fs.readdirSync(__dirname)
  .sort()
  .filter(file => file.endsWith('.test.js'))
  .filter(file => file !== 'e2e-real-agent-smoke.test.js')
  .map(file => path.join(__dirname, file));

const result = spawnSync(
  process.execPath,
  [
    '--require',
    path.join(__dirname, 'bootstrap-parallix-home.js'),
    '--test',
    ...testFiles
  ],
  {
    stdio: 'inherit',
    env: process.env
  }
);

if (result.error) {
  throw result.error;
}

if (result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(result.status ?? 1);
