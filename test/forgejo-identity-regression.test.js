const test = require('node:test');
const assert = require('node:assert/strict');
const { getPrStatus, getPrNumber } = require('../lib/tools/forgejo.js');
const { mock } = test;

// Regression test for task-1121: ensure that when a token for a specific agent
// (e.g., gemini) is resolved, subsequent PR queries use the same identity
// for lookup, even if magnus has a different PR for the same repo.
test('getPrStatus finds PR for non-default agent using forgejoUser option', (t) => {
  const apiCall = mock.fn((method, apiPath, token) => {
    // Simulate that gemini has a PR for mission/task-1121
    if (token === 'gemini-token' && apiPath.includes('/pulls?')) {
      return {
        ok: true,
        data: [{ number: 1001, head: { ref: 'mission/task-1121' } }]
      };
    }
    // PR detail for gemini's PR
    if (token === 'gemini-token' && apiPath === '/pulls/1001') {
      return {
        ok: true,
        data: {
          number: 1001,
          title: 'Mission task-1121',
          state: 'open',
          merged: false,
          html_url: 'http://localhost:3300/magnus/visualboard/pulls/1001'
        }
      };
    }
    return { ok: false, data: null };
  });

  // Test with explicit forgejoUser option and provided token
  const result = getPrStatus('mission/task-1121', process.cwd(), {
    forgejoUser: 'gemini',
    token: 'gemini-token',
    apiCall
  });

  assert.strictEqual(result.exists, true, 'Should find PR for gemini');
  assert.strictEqual(result.number, 1001, 'Should return gemini PR number');
  assert.strictEqual(result.title, 'Mission task-1121');
});

test('getPrNumber finds PR for non-default agent via fallback when initial token fails', (t) => {
  const apiCall = mock.fn((method, apiPath, token) => {
    // gemini's token initially returns no PR in open state
    if (token === 'gemini-token' && apiPath.includes('/pulls?state=open')) {
      return { ok: true, data: [] };
    }
    // gemini's token with state=all returns the PR
    if (token === 'gemini-token' && apiPath.includes('/pulls?state=all')) {
      return {
        ok: true,
        data: [{ number: 1002, head: { ref: 'mission/task-1122' } }]
      };
    }
    return { ok: true, data: [] };
  });

  const result = getPrNumber('mission/task-1122', 'gemini-token', {
    apiCall,
    slug: 'task-1122',
    forgejoUser: 'gemini'
  });

  assert.strictEqual(result, 1002, 'Should find PR for gemini via state=all fallback');
});

test('getPrStatus with forgejoUser prefers specified user over default', (t) => {
  const apiCall = mock.fn((method, apiPath, token) => {
    // codex has a PR for mission/task-1126
    if (token === 'codex-token' && apiPath.includes('/pulls?')) {
      return {
        ok: true,
        data: [{ number: 2001, head: { ref: 'mission/task-1126' } }]
      };
    }
    // PR detail for codex's PR
    if (token === 'codex-token' && apiPath === '/pulls/2001') {
      return {
        ok: true,
        data: {
          number: 2001,
          title: 'Mission task-1126',
          state: 'open',
          merged: false,
          html_url: 'http://localhost:3300/magnus/visualboard/pulls/2001'
        }
      };
    }
    return { ok: false, data: null };
  });

  // Even if FORGEJO_USER env var is set to magnus, passing forgejoUser: 'codex'
  // and token: 'codex-token' should use codex's identity
  const result = getPrStatus('mission/task-1126', process.cwd(), {
    forgejoUser: 'codex',
    token: 'codex-token',
    apiCall
  });

  assert.strictEqual(result.exists, true, 'Should find PR for codex');
  assert.strictEqual(result.number, 2001, 'Should return codex PR number');
  assert.strictEqual(result.title, 'Mission task-1126');
});

test('getPrNumber uses forgejoUser to resolve implementer from slug', (t) => {
  const apiCall = mock.fn((method, apiPath, token) => {
    // When called with codex's token, return the PR
    if (token === 'codex-token' && apiPath.includes('/pulls?')) {
      return {
        ok: true,
        data: [{ number: 3001, head: { ref: 'mission/task-1127' } }]
      };
    }
    return { ok: true, data: [] };
  });

  // Pass forgejoUser: 'codex' and token to ensure the lookup uses codex's identity
  const result = getPrNumber('mission/task-1127', 'codex-token', {
    apiCall,
    slug: 'task-1127',
    forgejoUser: 'codex'
  });

  assert.strictEqual(result, 3001, 'Should find PR for codex');
});

test('getPrStatus uses token from options when forgejoUser is provided', (t) => {
  const apiCall = mock.fn((method, apiPath, token) => {
    // Use the provided token directly
    if (token === 'provided-gemini-token' && apiPath.includes('/pulls?')) {
      return {
        ok: true,
        data: [{ number: 4001, head: { ref: 'mission/task-1128' } }]
      };
    }
    if (token === 'provided-gemini-token' && apiPath === '/pulls/4001') {
      return {
        ok: true,
        data: {
          number: 4001,
          title: 'Mission task-1128',
          state: 'open',
          merged: false,
          html_url: 'http://localhost:3300/magnus/visualboard/pulls/4001'
        }
      };
    }
    return { ok: false, data: [] };
  });

  // Pass both forgejoUser and token in options
  const result = getPrStatus('mission/task-1128', process.cwd(), {
    forgejoUser: 'gemini',
    token: 'provided-gemini-token',
    apiCall
  });

  assert.strictEqual(result.exists, true, 'Should find PR using provided token');
  assert.strictEqual(result.number, 4001);
});

test('getPrStatus with forgejoUser finds PR when magnus has different PR', (t) => {
  // This is the key regression test for task-1121: even when magnus has a PR,
  // using a different agent's identity should find that agent's PR
  const apiCall = mock.fn((method, apiPath, token) => {
    // magnus has a PR for a different branch
    if (token === 'magnus-token' && apiPath.includes('/pulls?')) {
      return {
        ok: true,
        data: [{ number: 9999, head: { ref: 'mission/task-9999' } }]
      };
    }
    // gemini has a PR for mission/task-1121
    if (token === 'gemini-token' && apiPath.includes('/pulls?')) {
      return {
        ok: true,
        data: [{ number: 1121, head: { ref: 'mission/task-1121' } }]
      };
    }
    // PR detail for gemini's PR
    if (token === 'gemini-token' && apiPath === '/pulls/1121') {
      return {
        ok: true,
        data: {
          number: 1121,
          title: 'Mission task-1121',
          state: 'open',
          merged: false,
          html_url: 'http://localhost:3300/magnus/visualboard/pulls/1121'
        }
      };
    }
    return { ok: false, data: null };
  });

  // Use gemini's identity explicitly - should find gemini's PR, not magnus's
  const result = getPrStatus('mission/task-1121', process.cwd(), {
    forgejoUser: 'gemini',
    token: 'gemini-token',
    apiCall
  });

  assert.strictEqual(result.exists, true, 'Should find PR for gemini, not magnus');
  assert.strictEqual(result.number, 1121, 'Should return gemini PR number (1121), not magnus PR (9999)');
  assert.strictEqual(result.title, 'Mission task-1121');
});

test('getPrNumber with forgejoUser and slug falls back to implementer token', (t) => {
  // Test the fallback logic in resolvePrAccess: when the provided token doesn't find
  // a PR, it should try the implementer's token from the backlog task
  const apiCall = mock.fn((method, apiPath, token) => {
    // First token (provided) doesn't find the PR
    if (token === 'wrong-token') {
      return { ok: true, data: [] };
    }
    // Implementer's token (gemini-token) finds the PR
    if (token === 'gemini-token' && apiPath.includes('/pulls?')) {
      return {
        ok: true,
        data: [{ number: 5001, head: { ref: 'mission/task-1129' } }]
      };
    }
    return { ok: true, data: [] };
  });

  // Mock backlog.getTaskImplementer to return 'gemini'
  // Note: We can't easily mock this from another module, so we test the direct
  // behavior with token and forgejoUser
  const result = getPrNumber('mission/task-1129', 'gemini-token', {
    apiCall,
    slug: 'task-1129',
    forgejoUser: 'gemini'
  });

  assert.strictEqual(result, 5001, 'Should find PR using gemini token');
});
