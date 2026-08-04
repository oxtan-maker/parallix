// @ts-nocheck -- TASK-2277: preserve legacy CommonJS mock behavior while mock-shape typings are hardened separately.

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
} = require('../src/interfaces/cli/runtime.ts');

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
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'never'.
    exitFn: (code) => calls.push(['exit', code]),
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
    errorFn: () => calls.push('error')
  });

  assert.deepEqual(calls, ['usage', ['exit', 0]]);
});

test('main() prints usage and exits 0 for help aliases', async () => {
  for (const arg of ['help', '--help', '-h']) {
    const calls = [];
    await main([arg], {
      printUsageFn: () => calls.push('usage'),
      // @ts-expect-error TS2322 Type 'number' is not assignable to type 'never'.
      exitFn: (code) => calls.push(['exit', code]),
      // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
      errorFn: () => calls.push('error')
    });
    assert.deepEqual(calls, ['usage', ['exit', 0]], `unexpected flow for ${arg}`);
  }
});

test('main() invokes the selected command through an injected test command map', async () => {
  const calls = [];

  await main(['draft', 'task-1038'], {
    commandFns: { draft: async (args, options) => calls.push(['invoke', args, options]) },
    printUsageFn: () => calls.push('usage'),
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'never'.
    exitFn: (code) => calls.push(['exit', code]),
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
    errorFn: (msg) => calls.push(['error', msg])
  });

  assert.deepEqual(calls, [['invoke', ['task-1038'], { command: 'draft' }]]);
  assert.equal(calls.some(entry => Array.isArray(entry) && entry[0] === 'exit'), false);
});

test('main() dispatches an injected command without filesystem module lookup', async () => {
  const calls = [];

  await main(['integrate', '--dry-run'], {
    commandFns: { integrate: async (args, options) => calls.push(['invoke', args, options]) },
  });

  assert.deepEqual(calls, [['invoke', ['--dry-run'], { command: 'integrate' }]]);
});

test('main() skips standalone git bootstrap for read-only config command', async () => {
  const calls = [];

  await main(['config'], {
    // @ts-expect-error TS2322 Type 'number' is not assignable to type '{ changed: boolean; initialized: boolea
    ensureStandaloneGitRepoFn: () => calls.push('bootstrap'),
    commandFns: { config: async () => calls.push('invoke') },
  });

  assert.deepEqual(calls, ['invoke']);
});

test('main() maps verify-env through its injected command', async () => {
  const calls = [];

  await main(['verify-env', 'task-1038'], {
    commandFns: { 'verify-env': async (args, options) => calls.push(['invoke', args, options]) },
    printUsageFn: () => calls.push('usage'),
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'never'.
    exitFn: (code) => calls.push(['exit', code]),
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
    errorFn: (msg) => calls.push(['error', msg])
  });

  assert.deepEqual(calls, [['invoke', ['task-1038'], { command: 'verify-env' }]]);
});

test('main() dispatches verify command with requested area', async () => {
  const calls = [];

  await main(['verify', 'docs'], {
    commandFns: { verify: async (args, options) => calls.push(['invoke', args, options]) },
    printUsageFn: () => calls.push('usage'),
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'never'.
    exitFn: (code) => calls.push(['exit', code]),
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
    errorFn: (msg) => calls.push(['error', msg])
  });

  assert.deepEqual(calls, [['invoke', ['docs'], { command: 'verify' }]]);
});

test('main() rejects command modules that do not export a function', async () => {
  const errors = [];
  let exitCode = null;

  await main(['draft'], {
    commandFns: { draft: { notAFunction: true } },
    printUsageFn: () => {},
    // @ts-expect-error TS2322 Type '(code: number) => void' is not assignable to type '(_code?: number) => nev
    exitFn: (code) => { exitCode = code; },
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
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
    // @ts-expect-error TS2322 Type '(code: number) => void' is not assignable to type '(_code?: number) => nev
    exitFn: (code) => { exitCode = code; },
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
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
    // @ts-expect-error TS2322 Type '(code: number) => void' is not assignable to type '(_code?: number) => nev
    exitFn: (code) => { exitCode = code; },
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
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
  assert.match(all, /integrate \[<slug>\].*--real-agent codex.*--real-agent-model gpt-5\.6-luna/);
});

test('printUsage documents draft and active implementer-selection syntax', () => {
  const previousLog = console.log;
  const lines = [];
  console.log = (msg) => lines.push(msg);
  try {
    printUsage();
  } finally {
    console.log = previousLog;
  }

  const all = lines.join('\n');
  assert.match(all, /draft \[<slug>\] \[--agent <family>\]/);
  assert.match(all, /--agent to select the draft implementer family/);
  assert.match(all, /active \[<slug>\] \[--implementer <family>\]/);
  assert.match(all, /--implementer to select its family/);
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

test('deriveAliases returns base aliases when state-map is unavailable', () => {
  const result = deriveAliases();
  assert.equal(result['ready'], 'draft');
  assert.equal(result['approved'], 'integrate');
  assert.equal(result['done'], 'integrate');
});

test('deriveAliases derives actual-name aliases from injected state-map data', () => {
  const result = deriveAliases({ ready: 'refined', approved: 'ready-for-integration' });
  assert.equal(result['refined'], 'draft');
  assert.equal(result['ready-for-integration'], 'integrate');
  assert.equal(result['ready'], 'draft');
  assert.equal(result['approved'], 'integrate');
});

test('printAliases prints sorted alias table', () => {
  const lines = [];
  // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
  printAliases({ ready: 'draft', done: 'integrate' }, (msg) => lines.push(msg));
  assert.ok(lines.some(l => l.includes('done') && l.includes('integrate')));
  assert.ok(lines.some(l => l.includes('ready') && l.includes('draft')));
  const doneIdx = lines.findIndex(l => l.includes('done'));
  const readyIdx = lines.findIndex(l => l.includes('ready'));
  assert.ok(doneIdx < readyIdx, 'aliases should be sorted: done before ready');
});

test('printAliases prints "No aliases configured" when map is empty', () => {
  const lines = [];
  // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
  printAliases({}, (msg) => lines.push(msg));
  assert.ok(lines.some(l => l.includes('No aliases configured')));
});

test('main() resolves alias and delegates to canonical command', async () => {
  const logs = [];
  const calls = [];

  await main(['ready', 'task-1076'], {
    commandFns: { draft: async (args, opts) => calls.push({ args, opts }) },
    loadAliasesFn: () => ({ ready: 'draft' }),
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
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
    commandFns: { draft: async (args, opts) => calls.push({ args, opts }) },
    loadAliasesFn: () => ({ refined: 'draft' }),
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
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
    // @ts-expect-error TS2322 Type '(code: number) => void' is not assignable to type '(_code?: number) => nev
    exitFn: (code) => { exitCode = code; },
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
    errorFn: (msg) => errors.push(msg),
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type 'LogFunc'.
    logFn: () => {}
  });

  assert.equal(exitCode, 1);
  assert.ok(errors.some(msg => msg.includes('[FAIL] Unknown command: unknown-alias')));
});

test('main() prints alias table for "aliases" subcommand', async () => {
  const logs = [];

  await main(['aliases'], {
    loadAliasesFn: () => ({ ready: 'draft', done: 'integrate' }),
    // @ts-expect-error TS2322 Type 'number' is not assignable to type 'string'.
    logFn: (msg) => logs.push(msg),
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(_code?: number) => never'.
    exitFn: () => {},
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type 'LogFunc'.
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
