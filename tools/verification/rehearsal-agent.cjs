// Deterministic disposable-repository agent for the manual CLI rehearsal.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const prompt = process.argv.at(-1) || '';
if (process.argv.includes('--help')) { console.log('run --format json'); process.exit(0); }
const slug = 'task-unit-rehearsal';
function px(args) {
  const result = cp.spawnSync(process.env.REHEARSAL_CLI, args, { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(args.join(' ') + '\n' + result.stdout + result.stderr);
  if (result.stdout.includes('reused successful')) {
    fs.appendFileSync(path.join(process.env.REHEARSAL_STATE, 'proof-reuse.log'), 'reused\\n');
  }
  return result.stdout;
}
function version() { return String(JSON.parse(px(['status', slug, '--json'])).version); }
function write(args) { return px([...args, '--slug', slug, '--expected-version', version()]); }
function commit(message) {
  for (const args of [['add', '.'], ['commit', '-m', message]]) {
    const result = cp.spawnSync('git', args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  }
}
if (/^Mode: draft\./m.test(prompt) || /Mission Slug:/m.test(prompt)) {
  write(['goal', 'set', '--goal', 'Rehearse units through public CLI', '--why', 'Observe exact candidate counts']);
  write(['scope', 'set', '--scope', 'Disposable active review repair integration', '--out-of-scope', 'Publishing and real agents']);
  write(['criterion', 'add', '--text', 'The disposable lifecycle reaches integration']);
  write(['gate', 'add', '--command', './scripts/verify-local.sh all']);
  write(['checkpoint', 'plan', '--name', 'CP-1', '--text', 'Verify the candidate']);
  write(['nel', 'set', '--predicted', 'Small']);
}
if (/^Mode: execute after lock\./m.test(prompt)) {
  fs.writeFileSync('src/value.js', 'export const value = 1;\n');
  write(['checkpoint', 'record', '--name', 'CP-1', '--criterion', 'The disposable lifecycle reaches integration',
    '--evidence', 'src/value.js: initial candidate', '--next', 'Review the candidate']);
  write(['mission', 'mark-complete', '--all']);
  commit('candidate');
  px(['verify', 'all']); px(['verify', 'all']);
}
if (/^Mode: act-on-review\./m.test(prompt)) {
  fs.writeFileSync('src/value.js', 'export const value = 2;\n');
  write(['resolve', '--actor', 'custom', '--finding', 'repair-value', '--fixed', 'src/value.js: value is now 2']);
  commit('repair value');
  px(['verify', 'all']); px(['verify', 'all']);
}
if (process.env.REHEARSAL_INTEGRATION_REBOUND === '1' && prompt.includes('The integration gate (not the review gate) failed')) {
  const state = JSON.parse(px(['status', slug, '--json']));
  if (state.missionStatus !== 'active') throw new Error('integration repair must run in active');
  const checkpoint = state.checkpoints.find(item => item.repair && !item.repair.verified);
  if (!checkpoint) throw new Error('integration repair must have an authorized checkpoint');
  fs.writeFileSync('src/value.js', 'export const value = 3;\n');
  cp.execFileSync(process.execPath, ['integration-probe.cjs'], { stdio: 'inherit' });
  write(['checkpoint', 'record', '--name', checkpoint.name,
    '--criterion', 'The disposable lifecycle reaches integration',
    '--evidence', 'src/value.js: repaired value 3; focused check: node integration-probe.cjs',
    '--next', 'Revalidate integration gates and obtain fresh independent review']);
  commit('repair integration value');
  px(['verify', 'all']); px(['verify', 'all']);
  fs.writeFileSync(path.join(process.env.REHEARSAL_STATE, 'integration-repaired'), 'repaired');
}
if (/^Mode: review\./m.test(prompt)) {
  px(['verify', 'all']);
  const marker = path.join(process.env.REHEARSAL_STATE, 'reviewed');
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, 'first review');
    write(['verdict', 'request-changes', '--actor', 'custom', '--finding', 'repair-value', '--summary', 'Set value to 2', '--location', 'src/value.js']);
  } else {
    write(['verdict', 'approve', '--actor', 'custom', '--comment', 'Repaired value and exact unit proof verified']);
  }
}
console.log('{"sessionID":"ses_unit_rehearsal"}');
