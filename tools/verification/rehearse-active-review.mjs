// Manual rehearsal outside test discovery. Supply the running public px path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { initCommittedRepository } from '../../test/fixtures/git-repository.ts';

const cli = process.argv[2];
const integrationRebound = process.argv.includes('--integration-rebound');
assert.ok(cli && path.isAbsolute(cli), 'supply the public px executable');
const repository = path.resolve(import.meta.dirname, '../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'px-unit-policy-rehearsal-'));
const root = path.join(scratch, 'repo');
const slug = 'task-unit-rehearsal';
const worktree = root + '-' + slug;
const countFile = path.join(scratch, 'unit-runs.jsonl');
const agent = path.join(scratch, 'opencode');
const env = { ...process.env, PARALLIX_HOME: path.join(scratch, 'home'),
  PRIMARY_WORKTREE: root, PARALLIX_EXECUTION_ROOT: '', PARALLIX_NO_BUBBLEWRAP: '1',
  OPENCODE_BIN: agent, FORGEJO_USER: 'custom', REHEARSAL_CLI: cli,
  REHEARSAL_STATE: scratch, REHEARSAL_COUNTS: countFile,
  PARALLIX_TEST_COVERAGE: 'true', FORCE_COLOR: '0', PARALLIX_NO_TUI: '1' };
if (integrationRebound) env.REHEARSAL_INTEGRATION_REBOUND = '1';
for (const key of ['NODE_OPTIONS', 'NODE_V8_COVERAGE', 'PI_BIN', 'CLAUDE_BIN', 'CODEX_BIN']) delete env[key];
const run = (cwd, args) => {
  const result = spawnSync(cli, args, { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
  fs.appendFileSync(path.join(scratch, 'cli.log'), 'px ' + args.join(' ') + '\n' + result.stdout + result.stderr + '\n');
  assert.equal(result.status, 0, 'px ' + args.join(' ') + '\n' + result.stdout + '\n' + result.stderr);
  return result.stdout;
};
try {
  fs.mkdirSync(root);
  fs.writeFileSync(agent, '#!' + process.execPath + '\n' + fs.readFileSync(path.join(import.meta.dirname, 'rehearsal-agent.cjs'), 'utf8'), { mode: 0o755 });
  const probe = [
    "const fs = require('node:fs'); const cp = require('node:child_process');",
    "const covered = process.env.PARALLIX_TEST_COVERAGE === '1';",
    "if(!covered && (process.env.PARALLIX_TEST_COVERAGE !== '0' || process.env.NODE_V8_COVERAGE || process.env.NODE_OPTIONS)) process.exit(8);",
    "const sha = cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();",
    "fs.appendFileSync(process.env.REHEARSAL_COUNTS, JSON.stringify({sha,covered,value:fs.readFileSync('src/value.js','utf8').trim(),checkout:process.cwd()})+'\\n');",
    "if(covered) { fs.mkdirSync('coverage',{recursive:true}); fs.writeFileSync('coverage/.lcov-unit.info','TN:\\nSF:src/value.js\\nDA:1,1\\nLF:1\\nLH:1\\nend_of_record\\n'); }",
  ].join('\n');
  initCommittedRepository(root, {
    '.gitignore': 'node_modules\ncoverage\n',
    ['backlog/tasks/' + slug + ' - Unit-rehearsal.md']: '---\nid: TASK-UNIT-REHEARSAL\ntitle: Unit rehearsal\nstatus: backlog\nassignee: []\nlabels: [ai_sdlc]\ndependencies: []\n---\n\nDisposable verification rehearsal.\n',
    'src/value.js': 'export const value = 0;\n',
    'unit-probe.cjs': probe,
    'integration-probe.cjs': "const fs=require('node:fs'); if(fs.readFileSync('src/value.js','utf8').includes('value = 2')) { console.error('Integration requires repaired value 3'); process.exit(1); } fs.copyFileSync('coverage/.lcov-unit.info','coverage/.lcov-integration-ci.info');\n",
    'package.json': JSON.stringify({ type: 'module', version: '1.0.0', scripts: { build: 'node -e ""', test: 'node unit-probe.cjs' } }),
    'scripts/verify-local.sh': fs.readFileSync(path.join(repository, 'scripts/verify-local.sh'), 'utf8'),
    'workflow.config.json': JSON.stringify({ adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog' },
      agents: { models: { custom: 'stub/custom' }, runners: { custom: 'opencode' } },
      missions: { baseDir: 'missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
      verification: { command: './scripts/verify-local.sh all', defaultArea: 'all' },
      review: { provider: 'none', tmpDir: path.join(scratch, 'review') },
      integrate: { postIntegrateCommand: 'echo hook >> "$REHEARSAL_STATE/post-squash-hooks"' },
      gates: { requirePreIntegration: true, preIntegration: [
        { key: 'unit', command: 'PARALLIX_FAST_UNIT=1 PARALLIX_TEST_COVERAGE=1 npm test -- --unit-test-headroom', order: 1 },
        { key: 'integration-ci', command: integrationRebound ? 'node integration-probe.cjs' : 'cp coverage/.lcov-unit.info coverage/.lcov-integration-ci.info', order: 2, after: ['unit'] },
        { key: 'coverage-merge', command: 'rm -f coverage/lcov.info && node --import tsx ' + repository + '/scripts/coverage-merge.ts "$PWD/coverage/lcov.info" "$PWD/coverage/.lcov-unit.info" "$PWD/coverage/.lcov-integration-ci.info" && test -s coverage/lcov.info', order: 3, after: ['unit', 'integration-ci'] },
        { key: 'quality-gate', command: 'test -s coverage/lcov.info', order: 4, after: ['coverage-merge'] },
      ] },
    } }),
  });
  fs.chmodSync(path.join(root, 'scripts/verify-local.sh'), 0o755);
  fs.symlinkSync(path.join(repository, 'scripts/verify-active-units.ts'), path.join(root, 'scripts/verify-active-units.ts'));
  spawnSync('git', ['add', '.'], { cwd: root });
  assert.equal(spawnSync('git', ['commit', '-m', 'install verifier'], { cwd: root }).status, 0);
  run(root, ['draft', slug, '--agent', 'custom']);
  fs.symlinkSync(path.join(repository, 'node_modules'), path.join(root, 'node_modules'));
  fs.symlinkSync(path.join(repository, 'node_modules'), path.join(worktree, 'node_modules'));
  run(worktree, ['active', slug, '--implementer', 'custom']);
  const approved = JSON.parse(run(worktree, ['status', slug, '--json']));
  assert.equal(approved.missionStatus, 'integration');
  const before = fs.readFileSync(countFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(before.some(row => row.covered), false);
  assert.equal(fs.existsSync(path.join(worktree, 'coverage')), false);
  assert.ok(new Set(before.map(row => row.sha)).size >= 2, 'repair changes the candidate');
  for (const sha of new Set(before.map(row => row.sha))) assert.equal(before.filter(row => row.sha === sha).length, 1);
  for (let index = 1; index < before.length; index++) {
    if (before[index].value !== before[index - 1].value) continue;
    const changed = spawnSync('git', ['diff', '--name-only', before[index - 1].sha, before[index].sha], { cwd: worktree, encoding: 'utf8' });
    console.log('Repeated source version between unit runs:', changed.stdout.trim());
  }
  for (const value of new Set(before.map(row => row.value))) {
    assert.equal(before.filter(row => row.value === value).length, 1,
      'one broad unit run per implementation/repair version; bookkeeping commits must not hide duplicate execution');
  }
  run(worktree, ['integrate', slug]);
  if (integrationRebound) {
    const repaired = JSON.parse(run(worktree, ['status', slug, '--json']));
    assert.equal(repaired.missionStatus, 'integration', 'repair must receive fresh review before another integration');
    assert.ok(fs.existsSync(path.join(scratch, 'integration-repaired')), 'integration failure launched the repair agent');
    run(worktree, ['integrate', slug]);
  }
  assert.equal(fs.readFileSync(path.join(scratch, 'post-squash-hooks'), 'utf8').trim().split('\n').length, 1,
    'configured post-squash maintenance runs once after landing');
  const after = fs.readFileSync(countFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(after.filter(row => row.covered).length, integrationRebound ? 2 : 1,
    'the repaired integration validation must be reused on the second integration');
  assert.equal(after.filter(row => !row.covered && row.checkout === root).length, 0,
    'local publication must not introduce a post-squash unit run');
  if (integrationRebound) {
    assert.equal(after.filter(row => !row.covered && row.checkout === worktree && row.value.includes('value = 3')).length, 1,
      'integration repair receives one uncovered run across re-review and handoff');
  }
  const proofReuses = fs.readFileSync(path.join(scratch, 'proof-reuse.log'), 'utf8').trim().split('\\n').length;
  assert.ok(proofReuses >= 2, 'unchanged execute and repair probes reuse proof');
  console.log(JSON.stringify({ lifecycle: integrationRebound ? 'active-review-repair-review-integration-active-repair-review-integration' : 'active-review-repair-review-integration', proofReuses, activeUnitRuns: after.filter(row => !row.covered && row.checkout === worktree),
    publicationUnitRuns: after.filter(row => !row.covered && row.checkout === root),
    integrationUnitRuns: after.filter(row => row.covered), successfulRunsPerUnchangedCandidate: 1,
    postSquashHookRuns: 1, coverageMerge: 'passed', isolatedQualityBoundary: 'passed (double; real Sonar wiring covered by owning contracts)' }, null, 2));
} catch (error) {
  console.error('Rehearsal log:\n' + (fs.existsSync(path.join(scratch, 'cli.log')) ? fs.readFileSync(path.join(scratch, 'cli.log'), 'utf8').slice(-18000) : ''));
  throw error;
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
