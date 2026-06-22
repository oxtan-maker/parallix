const test = require('node:test');
const assert = require('node:assert/strict');

// FORCE_COLOR so util.styleText emits ANSI in the test runner (no TTY).
process.env.FORCE_COLOR = '1';
delete process.env.NO_COLOR;

const fmt = require('../lib/core/fmt');

test('fmt.status returns ANSI colored text', () => {
  assert.ok(fmt.status('PASS', 'ok').includes('\x1b[32m[PASS]\x1b[39m'));
  assert.ok(fmt.status('FAIL', 'err').includes('\x1b[31m[FAIL]\x1b[39m'));
  assert.ok(fmt.status('WARN', 'att').includes('\x1b[33m[WARN]\x1b[39m'));
  assert.ok(fmt.status('INFO', 'log').includes('\x1b[36m[INFO]\x1b[39m'));
});

test('fmt.status returns plain text for unknown type', () => {
  assert.equal(fmt.status('CUSTOM', 'text'), '[CUSTOM] text');
});

test('fmt.agent returns colored agent name and handles qwen/opencode', () => {
  assert.equal(fmt.agent('gemini'), '\x1b[36mgemini\x1b[39m');
  assert.equal(fmt.agent('codex'), '\x1b[35mcodex\x1b[39m');
  assert.equal(fmt.agent('claude'), '\x1b[34mclaude\x1b[39m');
  assert.equal(fmt.agent('qwen'), '\x1b[33mqwen (opencode)\x1b[39m');

  assert.equal(fmt.agent('qwen', 'custom'), '\x1b[33mcustom\x1b[39m');
});

test('fmt.agent returns plain text for unknown family', () => {
  assert.equal(fmt.agent('unknown'), 'unknown');
});

test('fmt.bold and fmt.dim', () => {
  assert.equal(fmt.bold('header'), '\x1b[1mheader\x1b[22m');
  assert.equal(fmt.dim('details'), '\x1b[90mdetails\x1b[39m');
});

test('fmt.table preserves falsy values like 0 and false', () => {
  const rendered = fmt.table([
    ['count', 0],
    ['flag', false]
  ], { indent: 0, colPadding: 1 });
  assert.ok(rendered.includes('0'), 'expected "0" to be rendered');
  assert.ok(rendered.includes('false'), 'expected "false" to be rendered');
});

test('fmt.table aligns ANSI-colored cells by visible width', () => {
  const rendered = fmt.table([
    [fmt.agent('claude'), '3.33'],
    [fmt.agent('magnus', 'magnus'), '0.00']
  ], { indent: 0, colPadding: 2 });
  const lines = rendered.split('\n').map(line => fmt.stripAnsi(line));
  assert.equal(lines[0].indexOf('3.33'), lines[1].indexOf('0.00'));
});

test('fmt.semantic formatters apply correct colors', () => {
  assert.ok(fmt.path('/some/path').includes('\x1b[34m'));
  assert.ok(fmt.branch('main').includes('\x1b[35m'));
  assert.ok(fmt.sha('abc123').includes('\x1b[33m'));
  assert.ok(fmt.command('npm test').includes('\x1b[32m'));
  const slugResult = fmt.slug('my-slug');
  assert.ok(slugResult.includes('\x1b[36m'), 'slug should contain cyan');
  assert.ok(slugResult.includes('\x1b[1m'), 'slug should contain bold');
});

test('fmt.colors maps to util.styleText format names', () => {
  assert.equal(fmt.colors.red, 'red');
  assert.equal(fmt.colors.green, 'green');
  assert.equal(fmt.colors.bold, 'bold');
  assert.equal(fmt.colors.dim, 'gray');
});

test('fmt.colorize handles null/undefined gracefully', () => {
  assert.ok(fmt.colorize('red', null).includes(''));
  assert.ok(fmt.colorize('red', undefined).includes(''));
});
