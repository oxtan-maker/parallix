const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NO_COLOR = '1';

const {
  KNOWN_COMMANDS,
  main,
  printUsage,
  printAliases,
  suggestCommand,
  buildSuggestionSuffix,
  levenshteinDistance,
  deriveAliases,
  resolveAlias,
} = require('../index');

// ---------- KNOWN_COMMANDS ----------

test('KNOWN_COMMANDS includes all expected commands', () => {
  const expected = [
    'mission-start', 'verify-env', 'verify', 'setup', 'setup-review', 'draft', 'active', 'status',
    'checkpoint', 'review', 'integrate', 'resolve-conflict', 'rebase'
  ];
  for (const cmd of expected) {
    assert.ok(KNOWN_COMMANDS.includes(cmd), `missing known command: ${cmd}`);
  }
});

// ---------- suggestCommand ----------

test('suggestCommand returns closest match within levenshtein distance 2', () => {
  assert.equal(suggestCommand('reviw'), 'review');
  assert.equal(suggestCommand('drfat'), 'draft');
  assert.equal(suggestCommand('statu'), 'status');
});

test('suggestCommand returns null for too-distant input', () => {
  assert.equal(suggestCommand('xyzfoobar'), null);
  assert.equal(suggestCommand(''), null);
});

test('suggestCommand is case-insensitive', () => {
  assert.equal(suggestCommand('REVW'), 'review');
  assert.equal(suggestCommand('DRAFT'), 'draft');
});

// ---------- buildSuggestionSuffix ----------

test('buildSuggestionSuffix returns <slug> for resolve-conflict', () => {
  assert.equal(buildSuggestionSuffix('resolve-conflict'), ' <slug>');
});

test('buildSuggestionSuffix returns <slug> <cp-name> for checkpoint', () => {
  assert.equal(buildSuggestionSuffix('checkpoint'), ' <slug> <cp-name> "<next-action>"');
});

test('buildSuggestionSuffix returns empty string for other commands', () => {
  assert.equal(buildSuggestionSuffix('review'), '');
  assert.equal(buildSuggestionSuffix('draft'), '');
  assert.equal(buildSuggestionSuffix('active'), '');
});

// ---------- main ----------

test('main() prints usage and exits 0 when no args provided', async () => {
  const calls = [];

  await main([], {
    printUsageFn: () => calls.push('usage'),
    exitFn: (code) => calls.push(['exit', code]),
    errorFn: () => calls.push('error')
  });

  assert.deepEqual(calls, ['usage', ['exit', 0]]);
});

test('main() prints usage and exits 0 for help aliases', async () => {
  for (const arg of ['help', '--help', '-h']) {
    const calls = [];
    await main([arg], {
      printUsageFn: () => calls.push('usage'),
      exitFn: (code) => calls.push(['exit', code]),
      errorFn: () => calls.push('error')
    });
    assert.deepEqual(calls, ['usage', ['exit', 0]], `unexpected flow for ${arg}`);
  }
});

test('main() loads and invokes known command modules', async () => {
  const calls = [];

  await main(['draft', 'task-1038'], {
    existsSyncFn: () => true,
    requireFn: (targetLib) => {
      calls.push(['require', targetLib]);
      return async (args, options) => calls.push(['invoke', args, options]);
    },
    printUsageFn: () => calls.push('usage'),
    exitFn: (code) => calls.push(['exit', code]),
    errorFn: (msg) => calls.push(['error', msg])
  });

  assert.equal(calls[0][0], 'require');
  assert.deepEqual(calls[1], ['invoke', ['task-1038'], { command: 'draft' }]);
  assert.equal(calls.some(entry => Array.isArray(entry) && entry[0] === 'exit'), false);
});

test('main() skips standalone git bootstrap for read-only config command', async () => {
  const calls = [];

  await main(['config'], {
    existsSyncFn: () => true,
    ensureStandaloneGitRepoFn: () => calls.push('bootstrap'),
    requireFn: () => async () => calls.push('invoke'),
  });

  assert.deepEqual(calls, ['invoke']);
});

test('main() maps verify-env to mission-start.js', async () => {
  const calls = [];

  await main(['verify-env', 'task-1038'], {
    existsSyncFn: () => true,
    requireFn: (targetLib) => {
      calls.push(['require', targetLib]);
      return async (args, options) => calls.push(['invoke', args, options]);
    },
    printUsageFn: () => calls.push('usage'),
    exitFn: (code) => calls.push(['exit', code]),
    errorFn: (msg) => calls.push(['error', msg])
  });

  assert.ok(calls[0][1].endsWith('lib/commands/mission-start.js'));
  assert.deepEqual(calls[1], ['invoke', ['task-1038'], { command: 'verify-env' }]);
});

test('main() dispatches verify command with requested area', async () => {
  const calls = [];

  await main(['verify', 'docs'], {
    existsSyncFn: () => true,
    requireFn: (targetLib) => {
      calls.push(['require', targetLib]);
      return async (args, options) => calls.push(['invoke', args, options]);
    },
    printUsageFn: () => calls.push('usage'),
    exitFn: (code) => calls.push(['exit', code]),
    errorFn: (msg) => calls.push(['error', msg])
  });

  assert.ok(calls[0][1].endsWith('lib/commands/verify.js'));
  assert.deepEqual(calls[1], ['invoke', ['docs'], { command: 'verify' }]);
});

test('main() rejects command modules that do not export a function', async () => {
  const errors = [];
  let exitCode = null;

  await main(['draft'], {
    existsSyncFn: () => true,
    requireFn: () => ({ notAFunction: true }),
    printUsageFn: () => {},
    exitFn: (code) => { exitCode = code; },
    errorFn: (msg) => errors.push(msg)
  });

  assert.equal(exitCode, 1);
  assert.ok(errors.some(msg => msg.includes("does not export a function")));
});

test('main() prints suggestion and exits 1 for unknown commands', async () => {
  const errors = [];
  let exitCode = null;
  let usageCount = 0;

  await main(['reviw'], {
    existsSyncFn: () => false,
    loadAliasesFn: () => ({}),
    printUsageFn: () => { usageCount += 1; },
    exitFn: (code) => { exitCode = code; },
    errorFn: (msg) => errors.push(msg)
  });

  assert.equal(exitCode, 1);
  assert.equal(usageCount, 1);
  assert.ok(errors.some(msg => msg.includes('Unknown command: reviw')));
  assert.ok(errors.some(msg => msg.includes('Did you mean: px review')));
});

test('main() prints usage without suggestion when unknown command is too distant', async () => {
  const errors = [];
  let exitCode = null;
  let usageCount = 0;

  await main(['totally-unknown-command'], {
    existsSyncFn: () => false,
    loadAliasesFn: () => ({}),
    printUsageFn: () => { usageCount += 1; },
    exitFn: (code) => { exitCode = code; },
    errorFn: (msg) => errors.push(msg)
  });

  assert.equal(exitCode, 1);
  assert.equal(usageCount, 1);
  assert.ok(errors.some(msg => msg.includes('Unknown command: totally-unknown-command')));
  assert.equal(errors.some(msg => msg.includes('Did you mean:')), false);
});

test('printUsage prints the command help text', () => {
  const previousLog = console.log;
  const lines = [];
  console.log = (msg) => lines.push(msg);
  try {
    printUsage();
  } finally {
    console.log = previousLog;
  }

  const all = lines.join('\n');
  assert.ok(lines.length >= 1);
  assert.match(all, /Usage: px <command> \[args\]/);
  assert.match(all, /mission-start/);
  assert.match(all, /No npm dependencies/);
  // Help must document every dispatchable command so px --help stays current.
  assert.match(all, /\bconfig\b/);
  assert.match(all, /\baliases\b/);
  assert.match(all, /shell-init/);
  assert.match(all, /review-event/);
  assert.match(all, /--version/);
});

test('printUsage documents every KNOWN_COMMANDS entry', () => {
  const previousLog = console.log;
  const lines = [];
  console.log = (msg) => lines.push(msg);
  try {
    printUsage();
  } finally {
    console.log = previousLog;
  }
  const all = lines.join('\n');
  for (const command of KNOWN_COMMANDS) {
    assert.match(all, new RegExp(`\\b${command}\\b`), `printUsage should document the '${command}' command`);
  }
});

// ---------- alias system ----------

test('KNOWN_COMMANDS includes aliases', () => {
  assert.ok(KNOWN_COMMANDS.includes('aliases'));
});

test('resolveAlias returns canonical command for a known alias', () => {
  assert.equal(resolveAlias('ready', { ready: 'draft' }), 'draft');
  assert.equal(resolveAlias('done', { done: 'integrate' }), 'integrate');
});

test('resolveAlias returns null for unknown alias', () => {
  assert.equal(resolveAlias('unknown-alias', {}), null);
  assert.equal(resolveAlias('draft', {}), null);
});

test('deriveAliases returns base aliases when state-map is missing', () => {
  const result = deriveAliases('/nonexistent/path/state-map.json');
  assert.equal(result['ready'], 'draft');
  assert.equal(result['approved'], 'integrate');
  assert.equal(result['done'], 'integrate');
});

test('deriveAliases derives actual-name aliases from state-map file', () => {
  const fs = require('fs');
  const os = require('os');
  const p = require('path');
  const tmpFile = p.join(os.tmpdir(), `state-map-test-${process.pid}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify({ ready: 'refined', approved: 'ready-for-integration' }));
  try {
    const result = deriveAliases(tmpFile);
    assert.equal(result['refined'], 'draft');
    assert.equal(result['ready-for-integration'], 'integrate');
    assert.equal(result['ready'], 'draft');
    assert.equal(result['approved'], 'integrate');
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

test('printAliases prints sorted alias table', () => {
  const lines = [];
  printAliases({ ready: 'draft', done: 'integrate' }, (msg) => lines.push(msg));
  assert.ok(lines.some(l => l.includes('done') && l.includes('integrate')));
  assert.ok(lines.some(l => l.includes('ready') && l.includes('draft')));
  const doneIdx = lines.findIndex(l => l.includes('done'));
  const readyIdx = lines.findIndex(l => l.includes('ready'));
  assert.ok(doneIdx < readyIdx, 'aliases should be sorted: done before ready');
});

test('printAliases prints "No aliases configured" when map is empty', () => {
  const lines = [];
  printAliases({}, (msg) => lines.push(msg));
  assert.ok(lines.some(l => l.includes('No aliases configured')));
});

test('main() resolves alias and delegates to canonical command', async () => {
  const logs = [];
  const calls = [];

  await main(['ready', 'task-1076'], {
    existsSyncFn: (p) => p.endsWith('draft.js'),
    requireFn: () => async (args, opts) => calls.push({ args, opts }),
    loadAliasesFn: () => ({ ready: 'draft' }),
    logFn: (msg) => logs.push(msg),
    exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
    errorFn: (msg) => { throw new Error(`unexpected error: ${msg}`); },
    printUsageFn: () => {}
  });

  assert.ok(logs.some(l => l.includes('Resolving alias ready → draft')));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['task-1076']);
});

test('main() resolves alias for actual backlog.md name (refined → draft)', async () => {
  const logs = [];
  const calls = [];

  await main(['refined', 'task-1076'], {
    existsSyncFn: (p) => p.endsWith('draft.js'),
    requireFn: () => async (args, opts) => calls.push({ args, opts }),
    loadAliasesFn: () => ({ refined: 'draft' }),
    logFn: (msg) => logs.push(msg),
    exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
    errorFn: (msg) => { throw new Error(`unexpected error: ${msg}`); },
    printUsageFn: () => {}
  });

  assert.ok(logs.some(l => l.includes('Resolving alias refined → draft')));
  assert.equal(calls.length, 1);
});

test('main() exits 1 for unknown alias (not in alias map)', async () => {
  const errors = [];
  let exitCode = null;

  await main(['unknown-alias'], {
    existsSyncFn: () => false,
    loadAliasesFn: () => ({}),
    printUsageFn: () => {},
    exitFn: (code) => { exitCode = code; },
    errorFn: (msg) => errors.push(msg),
    logFn: () => {}
  });

  assert.equal(exitCode, 1);
  assert.ok(errors.some(msg => msg.includes('[FAIL] Unknown command: unknown-alias')));
});

test('main() prints alias table for "aliases" subcommand', async () => {
  const logs = [];

  await main(['aliases'], {
    loadAliasesFn: () => ({ ready: 'draft', done: 'integrate' }),
    logFn: (msg) => logs.push(msg),
    exitFn: () => {},
    errorFn: () => {}
  });

  assert.ok(logs.some(l => l.includes('ready') && l.includes('draft')));
  assert.ok(logs.some(l => l.includes('done') && l.includes('integrate')));
});

// ---------- levenshteinDistance ----------

test('levenshteinDistance returns 0 for identical strings', () => {
  assert.equal(levenshteinDistance('hello', 'hello'), 0);
});

test('levenshteinDistance returns string length for completely different strings', () => {
  assert.equal(levenshteinDistance('', 'abc'), 3);
  assert.equal(levenshteinDistance('abc', ''), 3);
});

test('levenshteinDistance computes single character edit', () => {
  assert.equal(levenshteinDistance('abc', 'abd'), 1);
  assert.equal(levenshteinDistance('abc', 'xbc'), 1);
});

test('levenshteinDistance caps at distance 2 for suggestCommand filtering', () => {
  // 'reviw' -> 'review' should be distance <= 2
  assert.ok(levenshteinDistance('reviw', 'review') <= 2);
  // 'xyzfoobar' -> any known command should be > 2
  for (const cmd of KNOWN_COMMANDS) {
    assert.ok(levenshteinDistance('xyzfoobar', cmd) > 2, `expected xyzfoobar -> ${cmd} to be > 2`);
  }
});
