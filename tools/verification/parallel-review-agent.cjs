const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

const runner = path.basename(process.argv[1]);
const family = runner === 'opencode' ? 'custom' : runner;
if (process.argv.includes('--help') || process.argv.includes('--version')) {
  console.log(family === 'claude' ? 'Claude Code 2.1.317' : `${family} rehearsal`);
  process.exit(0);
}
const prompt = fs.readFileSync(0, 'utf8');
const state = process.env.PARALLEL_REVIEW_STATE;
const cli = process.env.PARALLEL_REVIEW_CLI;
const mainSlug = 'task-parallel-review';
const holderSlug = 'task-capacity-holder';
const slug = /Mission Slug:\s*(\S+)/.exec(prompt)?.[1]
  || (process.cwd().endsWith(`-${holderSlug}`) ? holderSlug : mainSlug);

function px(args) {
  const result = cp.spawnSync(cli, args, { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`px ${args.join(' ')}\n${result.stdout}${result.stderr}`);
  return result.stdout;
}
function version() { return String(JSON.parse(px(['status', slug, '--json'])).version); }
function write(args) { return px([...args, '--slug', slug, '--expected-version', version()]); }
function writeCurrent(args) { return px([...args, '--slug', slug]); }
function commit(message) {
  cp.execFileSync('git', ['add', '.']);
  cp.execFileSync('git', ['commit', '-m', message]);
}
function waitFor(file, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (!fs.existsSync(file)) {
    if (Date.now() >= end) throw new Error(`timed out waiting for ${file}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}

if (/^Mode: draft\./m.test(prompt) || /Mission Slug:/m.test(prompt)) {
  write(['goal', 'set', '--goal', `Rehearse ${slug} through public CLI`, '--why', 'Measure parallel review ownership']);
  write(['scope', 'set', '--scope', 'Disposable isolated review rehearsal', '--out-of-scope', 'Publishing and real agents']);
  write(['criterion', 'add', '--text', 'The disposable candidate reaches authoritative review completion']);
  write(['gate', 'add', '--command', './scripts/verify-local.sh all']);
  write(['checkpoint', 'plan', '--name', 'CP-1', '--text', 'Prepare the disposable candidate']);
  write(['nel', 'set', '--predicted', 'Small']);
}

if (/^Mode: execute after lock\./m.test(prompt) && slug === holderSlug) {
  fs.writeFileSync('src/holder.js', 'export const holder = true;\n');
  write(['checkpoint', 'record', '--name', 'CP-1', '--criterion', 'The disposable candidate reaches authoritative review completion',
    '--evidence', 'src/holder.js: disposable capacity-holder candidate', '--next', 'Release capacity and run independent review']);
  write(['mission', 'mark-complete', '--all']);
  commit('prepare capacity holder candidate');
  fs.writeFileSync(path.join(state, 'holder-started'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
  waitFor(path.join(state, 'holder-release'), 30000);
}

if (/^Mode: execute after lock\./m.test(prompt) && slug === mainSlug) {
  fs.writeFileSync('src/value.js', 'export const value = 1;\n');
  write(['checkpoint', 'record', '--name', 'CP-1', '--criterion', 'The disposable candidate reaches authoritative review completion',
    '--evidence', 'src/value.js: disposable candidate', '--next', 'Run independent review']);
  write(['mission', 'mark-complete', '--all']);
  commit('prepare parallel review candidate');
  fs.writeFileSync(path.join(state, 'implementation-ready'), JSON.stringify({ sha: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }));
  waitFor(path.join(state, 'implementation-release'), 30000);
}

if (/^Mode: review\./m.test(prompt) && slug === mainSlug) {
  const sha = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const source = fs.readFileSync('src/value.js', 'utf8');
  const marker = path.join(state, `reviewer-${family}.json`);
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, JSON.stringify({ family, pid: process.pid, startedAt: Date.now(), sha,
      sourceHash: crypto.createHash('sha256').update(source).digest('hex'), stdinIsTTY: Boolean(process.stdin.isTTY),
      promptHash: crypto.createHash('sha256').update(prompt).digest('hex') }));
  }
  waitFor(path.join(state, 'reviewers-release'), 30000);
  writeCurrent(['verdict', 'approve', '--actor', family, '--comment', `${family} verified ${sha}`]);
}

if (/^Mode: review\./m.test(prompt) && slug === holderSlug) {
  writeCurrent(['verdict', 'approve', '--actor', family, '--comment', `${family} released the capacity-holder candidate`]);
}

const sessionID = `${family}-parallel-${process.pid}`;
if (family === 'claude') {
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionID }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'complete', session_id: sessionID }));
} else {
  console.log(JSON.stringify({ sessionID }));
}
