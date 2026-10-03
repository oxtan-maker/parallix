// Historical focused measurement harness. Runtime tier selection stays repository-owned.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const [checkoutArg, populationArg, stage] = process.argv.slice(2);
if (!checkoutArg || !populationArg || !stage) {
  throw new Error('Usage: node --import tsx measure.mjs <checkout> <focus.json> <before|after>');
}
const checkout = path.resolve(checkoutArg);
const { buildTestRunPlan, withCoverageReporters } = await import(pathToFileURL(path.join(checkout, 'test/lib/test-run-plan.ts')).href);
const { selectTierFiles } = await import(pathToFileURL(path.join(checkout, 'test/lib/test-tier-selection.ts')).href);
const population = JSON.parse(fs.readFileSync(populationArg, 'utf8'))[stage];
if (!Array.isArray(population) || population.length === 0) throw new Error('Empty measurement population');
const output = path.resolve('tools/review-consolidation');
const tiers = selectTierFiles(checkout);
const selected = new Set(population);
const summary = { stage, checkout, files: population, tiers: {} };
for (const [tier, flags] of [['unit', ['--unit-test-headroom']], ['integrationCi', ['--integration-ci']]]) {
  const files = tiers[tier].filter(file => selected.has(path.basename(file)));
  if (files.length === 0) continue;
  const plan = buildTestRunPlan({ executionRoot: checkout, requestedArgs: flags, coverage: true });
  const testIndex = plan.nodeArgs.indexOf('--test');
  const prefix = path.join(output, `matched-${stage}-${tier}`);
  const args = withCoverageReporters([...plan.nodeArgs.slice(0, testIndex + 1), ...files], `${prefix}.lcov`);
  const result = spawnSync('/usr/bin/time', ['-f', '%U %S %e', '-o', `${prefix}.time`, plan.testNode, ...args], {
    cwd: checkout, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024,
    env: { ...process.env, PARALLIX_UNIT_TEST_CPU_TIMEOUT_US: '1000000', PARALLIX_UNIT_TEST_CPU_HEADROOM_US: '500000' },
  });
  fs.writeFileSync(`${prefix}.log`, `${result.stdout}\n${result.stderr}`);
  const [userSeconds, systemSeconds, elapsedSeconds] = fs.readFileSync(`${prefix}.time`, 'utf8').trim().split(/\s+/).map(Number);
  const count = label => Number(new RegExp(`ℹ ${label} (\\d+)`).exec(result.stdout)?.[1] ?? 0);
  summary.tiers[tier] = {
    files: files.map(file => path.relative(checkout, file)), exitCode: result.status,
    tests: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'),
    userSeconds, systemSeconds, cpuSeconds: userSeconds + systemSeconds, elapsedSeconds,
    node: plan.testNode, nodeArgs: args,
  };
  console.log(stage, tier, summary.tiers[tier]);
  if (result.status !== 0) process.exitCode = 1;
}
if (Object.values(summary.tiers).reduce((count, tier) => count + tier.files.length, 0) !== population.length) {
  throw new Error('The focused population includes an absent or unsupported tier file');
}
fs.writeFileSync(path.join(output, `matched-${stage}.json`), `${JSON.stringify(summary, null, 2)}\n`);
