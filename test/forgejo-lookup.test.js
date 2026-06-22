const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getPrNumber } = require('../lib/tools/forgejo.js');

test('getPrNumber robust matching', (t) => {
  const apiCall = (method, apiPath) => {
    if (apiPath.includes('state=open')) return { ok: true, data: [] };
    return {
      ok: true,
      data: [
        { number: 101, head: { ref: 'other', label: 'user:mission/task-101' } },
        { number: 102, head: { ref: 'mission/task-102', label: 'mission/task-102' } }
      ]
    };
  };

  assert.strictEqual(getPrNumber('mission/task-101', 'token', { apiCall }), 101, 'Should match by label suffix');
  assert.strictEqual(getPrNumber('mission/task-102', 'token', { apiCall }), 102, 'Should match by ref');
});

test('getPrNumber pagination and sorting', (t) => {
  const calls = [];
  const apiCall = (method, apiPath) => {
    calls.push(apiPath);
    return { ok: true, data: [] };
  };

  getPrNumber('any', 'token', { apiCall });
  
  assert.ok(calls[0].includes('state=open'), 'Should check open PRs first');
  assert.ok(calls[0].includes('sort=recentupdate'), 'Should use sorting');
  assert.ok(calls[1].includes('state=all'), 'Should check all PRs if open check fails');
});
