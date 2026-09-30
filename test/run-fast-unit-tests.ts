import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildTestRunPlan, withCoverageReporters } from './lib/test-run-plan.js';
import { unitProcessPartition } from './lib/unit-process-partition.js';
import { mergeLcov } from '../src/adapters/verification/coverage-gate.js';
import { removeNonExecutableCoverage, removeTypeOnlyCoverage } from '../src/adapters/verification/type-only-coverage.js';

const root = path.resolve(process.env.PARALLIX_EXECUTION_ROOT || process.cwd());
const coverage = process.env.PARALLIX_TEST_COVERAGE === '1' || process.env.PARALLIX_TEST_COVERAGE === 'true';
const { unit, safe, isolated } = unitProcessPartition(root);
// The outer runner owns and removes the V8 scratch root even when its child
// is killed by the wall watchdog. Plain opt-in runs clean their own root.
const scratchParent = process.env.NODE_V8_COVERAGE || path.join(root, 'tmp');
fs.mkdirSync(scratchParent, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchParent, 'fast-unit-'));
const report = path.join(root, 'coverage', '.lcov-unit.info');
if (coverage) { fs.rmSync(report, { force: true }); }

async function runGroup(name: 'safe' | 'isolated', files: string[]) {
  const plan = buildTestRunPlan({ executionRoot: root, requestedArgs: ['--unit-test-headroom', ...files], coverage });
  if (plan.testFiles.length !== files.length || plan.runsIntegrationSuite) {
    throw new Error(`${name} group lost unit-test membership`);
  }
  const fragment = path.join(scratch, `${name}.lcov`);
  const argv = coverage ? withCoverageReporters(plan.nodeArgs, fragment) : [...plan.nodeArgs];
  argv.splice(argv.indexOf('--test'), 0, `--test-isolation=${name === 'safe' ? 'none' : 'process'}`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PARALLIX_EXECUTION_ROOT: root,
  };
  // The native test coverage reporter emits this group's LCOV directly.
  // NODE_V8_COVERAGE would additionally dump a raw payload for every worker,
  // which is unused by coverage:merge and materially increases CPU cost.
  delete env.NODE_V8_COVERAGE;
  const summary = await new Promise<string>((resolve, reject) => {
    const child = spawn(plan.testNode, argv, { cwd: root, env, stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); process.stdout.write(chunk); });
    child.stderr.pipe(process.stderr);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal || code !== 0) { reject(new Error(`${name} unit group failed: exit=${code} signal=${signal}`)); }
      else { resolve(stdout); }
    });
  });
  const tests = /ℹ tests (\d+)/.exec(summary);
  const passed = /ℹ pass (\d+)/.exec(summary);
  const failed = /ℹ fail (\d+)/.exec(summary);
  const cancelled = /ℹ cancelled (\d+)/.exec(summary);
  if (!tests || !passed || !failed || !cancelled || Number(tests[1]) <= 0
    || tests[1] !== passed[1] || failed[1] !== '0' || cancelled[1] !== '0') {
    throw new Error(`${name} unit group did not report a complete passing test result`);
  }
  if (coverage && (!fs.existsSync(fragment) || fs.statSync(fragment).size === 0)) {
    throw new Error(`${name} unit group did not produce LCOV`);
  }
  return { name, files: files.length, tests: Number(tests[1]), fragment };
}

try {
  const results = await Promise.allSettled([
    runGroup('safe', safe), runGroup('isolated', isolated),
  ]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') { throw failure.reason; }
  const [sharedResult, isolatedResult] = results.map(result => {
    if (result.status !== 'fulfilled') { throw new Error('missing unit group result'); }
    return result.value;
  });
  if (coverage) {
    const fragments = [sharedResult.fragment, isolatedResult.fragment].map(file => fs.readFileSync(file, 'utf8'));
    const merged = removeNonExecutableCoverage(removeTypeOnlyCoverage(mergeLcov(fragments), root), root);
    fs.writeFileSync(report, merged);
  }
  console.error(`[fast-unit] ${unit.length} files, ${sharedResult.tests + isolatedResult.tests} tests; shared=${safe.length}, isolated=${isolated.length}`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
