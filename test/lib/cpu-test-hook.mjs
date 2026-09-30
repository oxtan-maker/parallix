import { beforeEach } from 'node:test';

// Loaded inside each isolated file worker. Node's default in-file scheduling is
// serial; the fullName check fails closed if a test opts into sibling overlap.
const active = [];
const budgetUs = Number(process.env.PARALLIX_UNIT_TEST_CPU_BUDGET_US || 1_000_000);
const headroomUs = Number(process.env.PARALLIX_UNIT_TEST_CPU_HEADROOM_US || 0);

function cpuUs(start) {
  const delta = process.cpuUsage(start);
  return delta.user + delta.system;
}

beforeEach((context) => {
  if (!Number.isSafeInteger(budgetUs) || budgetUs <= 0) {
    throw new Error('invalid PARALLIX_UNIT_TEST_CPU_BUDGET_US');
  }
  const name = context.fullName;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('node:test did not provide a test identity for CPU accounting');
  }
  const parent = active.at(-1);
  if (parent && !name.startsWith(`${parent.name} > `)) {
    throw new Error(`overlapping unit tests cannot share one process CPU counter: ${parent.name}, ${name}`);
  }
  const sample = { context, name, start: process.cpuUsage(), childUs: 0 };
  active.push(sample);
  // A context.after callback runs after the test's own afterEach hooks. A
  // preload-level afterEach registered first would miss their CPU entirely.
  context.after(() => finish(context));
});

function finish(context) {
  const sample = active.pop();
  if (!sample || sample.context !== context) {
    throw new Error('unit test CPU accounting lost test identity or nesting order');
  }
  const inclusiveUs = cpuUs(sample.start);
  const exclusiveUs = inclusiveUs - sample.childUs;
  if (!Number.isFinite(exclusiveUs) || exclusiveUs < 0) {
    throw new Error(`invalid CPU measurement for ${sample.name}`);
  }
  const parent = active.at(-1);
  if (parent) { parent.childUs += inclusiveUs; }
  const limitUs = headroomUs > 0 ? headroomUs : budgetUs;
  if (exclusiveUs > limitUs) {
    throw new Error(`[unit-test-cpu:${headroomUs > 0 ? 'headroom' : 'exceeded'}] ${sample.name}: ${(exclusiveUs / 1e6).toFixed(3)} CPU seconds > ${(limitUs / 1e6).toFixed(3)}`);
  }
}
