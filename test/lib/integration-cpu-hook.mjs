import { beforeEach } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { readCpuBudgetPolicy, positiveCpuBudget } from './test-cpu-policy.mjs';

const modulePath = process.env.PARALLIX_CHILD_CPU_USAGE_MODULE;
if (!modulePath) throw new Error('integration CPU accounting module is missing');
const { waitedChildCpuUs } = createRequire(import.meta.url)(modulePath);
const root = process.env.PARALLIX_EXECUTION_ROOT || process.cwd();
const policy = readCpuBudgetPolicy(root);
const profile = process.env.PARALLIX_TEST_COVERAGE === '1' || process.env.PARALLIX_TEST_COVERAGE === 'true' ? 'covered' : 'plain';
const active = [];

function sampleUs() {
  const own = process.cpuUsage();
  const children = waitedChildCpuUs();
  if (!Number.isSafeInteger(children) || children < 0) throw new Error('invalid waited-child CPU measurement');
  return own.user + own.system + children;
}

beforeEach(context => {
  const name = context.fullName;
  if (typeof name !== 'string' || !name) throw new Error('integration test CPU identity is missing');
  const parent = active.at(-1);
  if (parent && !name.startsWith(`${parent.name} > `)) {
    throw new Error(`overlapping integration tests cannot share one process CPU counter: ${parent.name}, ${name}`);
  }
  const file = path.relative(path.join(root, 'test'), context.filePath || process.argv[1]);
  const limitMs = positiveCpuBudget(process.env.PARALLIX_INTEGRATION_TEST_CPU_BUDGET_MS
    ?? policy.integrationCases[profile][file] ?? policy.integrationCases.defaultMs, 'integration case');
  if (!Number.isSafeInteger(limitMs) || limitMs <= 0) throw new Error('invalid integration test CPU budget');
  const sample = { context, name, file, limitMs, start: sampleUs(), childUs: 0 };
  active.push(sample);
  // Node runs afterEach before context.after; append the counter after the
  // case-owned context.after callbacks so their teardown is charged too.
  context.after(() => context.after(() => {
    if (active.pop() !== sample) throw new Error('integration CPU accounting lost nesting order');
    const inclusiveUs = sampleUs() - sample.start;
    const exclusiveUs = inclusiveUs - sample.childUs;
    if (!Number.isFinite(exclusiveUs) || exclusiveUs < 0) throw new Error('invalid integration CPU delta');
    const outer = active.at(-1);
    if (outer) outer.childUs += inclusiveUs;
    const record = { file, name, profile, cpuMs: exclusiveUs / 1000, limitMs };
    const destination = process.env.PARALLIX_TEST_CPU_PROFILE_DIR;
    if (destination) {
      fs.mkdirSync(destination, { recursive: true });
      fs.appendFileSync(path.join(destination, `cases-${process.pid}.jsonl`), JSON.stringify(record) + '\n');
    }
    if (exclusiveUs > limitMs * 1000) {
      throw new Error(`[integration-test-cpu:exceeded] ${name}: ${(exclusiveUs / 1e6).toFixed(3)} CPU seconds > ${(limitMs / 1000).toFixed(3)}`);
    }
  }));
});
