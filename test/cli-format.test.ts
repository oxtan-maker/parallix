import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fmt from '../src/application/presentation/cli-format.js';

// Capture logged output instead of dumping to the console.
function capture() {
  const lines: string[] = [];
  const logger = {
    log: (...args: unknown[]) => { lines.push(args.map(String).join(' ')); },
    error: (...args: unknown[]) => { lines.push(args.map(String).join(' ')); },
  };
  const prev = fmt.setLogger(logger);
  return {
    lines,
    restore() { fmt.setLogger(prev); },
  };
}

test('colorize renders text through the styleText seam', () => {
  const out = fmt.colorize('red', 'boom');
  assert.equal(typeof out, 'string');
  assert.ok(out.includes('boom'));
});

test('stripAnsi removes SGR escape sequences', () => {
  const raw = '\u001b[31mred\u001b[0m';
  assert.equal(fmt.stripAnsi(raw), 'red');
});

test('stripAnsi returns the input unchanged when no escapes are present', () => {
  assert.equal(fmt.stripAnsi('plain text'), 'plain text');
});

test('stripAnsi coerces nullish input to a string', () => {
  assert.equal(fmt.stripAnsi(null as unknown as string), '');
  assert.equal(fmt.stripAnsi(undefined as unknown as string), '');
});

test('visibleWidth measures the post-strip length', () => {
  assert.equal(fmt.visibleWidth('\u001b[31mhello\u001b[0m'), 5);
  assert.equal(fmt.visibleWidth('abcdef'), 6);
});

test('padVisibleEnd pads to the target width using visible length', () => {
  assert.equal(fmt.padVisibleEnd('ab', 6), 'ab    ');
  // Already wide enough: no negative padding, string returned as-is.
  assert.equal(fmt.padVisibleEnd('abcdef', 3), 'abcdef');
});

test('padVisibleEnd coerces nullish input', () => {
  assert.equal(fmt.padVisibleEnd(null as unknown as string, 4), '    ');
});

test('status maps known levels through colorize', () => {
  const cap = capture();
  try {
    const out = fmt.status('PASS', 'ok');
    assert.ok(out.startsWith('[PASS]'));
    assert.ok(out.includes('ok'));
  } finally { cap.restore(); }
});

test('status falls back to an untagged bracket for unknown levels', () => {
  assert.equal(fmt.status('NOPE', 'x'), '[NOPE] x');
});

test('status returns the formatted string without logging', () => {
  const cap = capture();
  try {
    const out = fmt.status('FAIL', 'bad');
    assert.ok(out.includes('[FAIL]'));
    assert.ok(out.includes('bad'));
    assert.equal(cap.lines.length, 0, 'status() formats but does not log');
  } finally { cap.restore(); }
});

test('agent maps a known family through colorize', () => {
  assert.ok(fmt.agent('codex', 'runner-a').includes('runner-a'));
});

test('agent builds the custom (runner) label for the custom family', () => {
  assert.equal(fmt.agent('custom', 'custom', 'sonnet'), 'custom (sonnet)');
});

test('agent builds the custom (label) label when text is a custom label', () => {
  assert.equal(fmt.agent('custom', 'my-model'), 'custom (my-model)');
});

test('agent returns the raw label for an unknown family', () => {
  assert.equal(fmt.agent('unknown-family', 'label'), 'label');
});

test('bold, dim, path, slug, branch, sha, and command render through colorize', () => {
  assert.ok(fmt.bold('b').includes('b'));
  assert.ok(fmt.dim('d').includes('d'));
  assert.ok(fmt.path('p').includes('p'));
  assert.ok(fmt.slug('s').includes('s'));
  assert.ok(fmt.branch('br').includes('br'));
  assert.ok(fmt.sha('abc123').includes('abc123'));
  assert.ok(fmt.command('px').includes('px'));
});

test('kv bolds the key and appends the value', () => {
  const out = fmt.kv('name', 'value');
  assert.ok(out.endsWith('value'));
  assert.ok(out.includes('name'));
});

test('table renders padded rows and handles the empty case', () => {
  assert.equal(fmt.table([]), '');
  const rendered = fmt.table([['a', 'bb'], ['ccc', 'd']], { indent: 0, colPadding: 0 });
  const rows = rendered.split('\n');
  assert.equal(rows.length, 2);
  // Column 0 width is max(1, 3) = 3, so 'a' is padded to 'a  '.
  assert.equal(rows[0], 'a  bb');
});

test('table honours indent and colPadding options', () => {
  const rendered = fmt.table([['x']], { indent: 2, colPadding: 2 });
  assert.ok(rendered.startsWith('  '));
});

test('list renders items with the default bullet and indent', () => {
  const rendered = fmt.list(['one', 'two']);
  assert.equal(rendered, '  - one\n  - two');
});

test('list honours custom bullet and indent', () => {
  const rendered = fmt.list(['one'], { bullet: '*', indent: 4 });
  assert.equal(rendered, '    * one');
});

test('log.info prefixes untagged lines and leaves tagged lines intact', () => {
  const cap = capture();
  try {
    const plain = fmt.log.info('plain line');
    assert.ok(plain.includes('[INFO] plain line'));
    const already = fmt.log.info('[PASS] already tagged');
    assert.ok(already.includes('[PASS] already tagged'));
    assert.ok(!already.includes('[INFO] [PASS]'), 'no nested [INFO] prefix');
  } finally { cap.restore(); }
});

test('log.pass and log.warn route through the logger log channel', () => {
  const cap = capture();
  try {
    const pass = fmt.log.pass('done');
    assert.ok(pass.includes('[PASS]'));
    const warn = fmt.log.warn('careful');
    assert.ok(warn.includes('[WARN]'));
    assert.equal(cap.lines.length, 2);
  } finally { cap.restore(); }
});

test('log.fail and log.error route through the logger error channel', () => {
  const cap = capture();
  try {
    const fail = fmt.log.fail('nope');
    assert.ok(fail.includes('[FAIL]'));
    const error = fmt.log.error('kaboom');
    assert.ok(error.includes('[FAIL]'));
    assert.equal(cap.lines.length, 2);
  } finally { cap.restore(); }
});

test('log.debug is a no-op when DEBUG is unset and renders when set', () => {
  const cap = capture();
  try {
    const saved = process.env.DEBUG;
    delete process.env.DEBUG;
    assert.equal(fmt.log.debug('silent'), null);
    process.env.DEBUG = '1';
    const shown = fmt.log.debug('loud');
    assert.ok(shown.includes('[DEBUG] loud'));
    if (saved === undefined) { delete process.env.DEBUG; } else { process.env.DEBUG = saved; }
  } finally { cap.restore(); }
});

test('log.plain and log.plainError forward raw text without a prefix', () => {
  const cap = capture();
  try {
    const plain = fmt.log.plain('raw line');
    assert.equal(plain, 'raw line');
    assert.equal(cap.lines[cap.lines.length - 1], 'raw line');

    const err = fmt.log.plainError('raw error');
    assert.equal(err, 'raw error');
  } finally { cap.restore(); }
});

test('log.plain preserves multi-line text and returns it unchanged', () => {
  const cap = capture();
  try {
    const multi = 'line one\nline two';
    assert.equal(fmt.log.plain(multi), multi);
    assert.equal(cap.lines.length, 2);
  } finally { cap.restore(); }
});

test('setLogger swaps the active logger and returns the previous one', () => {
  const cap = capture();
  try {
    const a = fmt.setLogger({ log: () => {}, error: () => {} });
    assert.equal(typeof a.log, 'function');
    // Restoring the original logger must not throw.
    fmt.setLogger(a);
  } finally { cap.restore(); }
});

test('setLogger tolerates a bare function logger', () => {
  const prev = fmt.setLogger(() => {});
  fmt.log.plain('via function logger');
  fmt.setLogger(prev);
});

test('setLogger falls back when only log is provided', () => {
  const prev = fmt.setLogger({ log: () => {} });
  fmt.log.plain('error fallback path');
  fmt.setLogger(prev);
});

test('colors export exposes the palette token map', () => {
  assert.equal(fmt.colors.red, 'red');
  assert.equal(fmt.colors.green, 'green');
  assert.equal(typeof fmt.colors.bold, 'string');
});
