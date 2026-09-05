// TASK-2455.01 regression: `product.targetUser` must be absent from every
// supported generation surface (code-owned defaults, public schema, and
// setup-generated workflow config). This test is written before the fix so it
// fails at the mission parent commit — where all three surfaces still expose
// the field — and turns green only once the retirement change removes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEffectiveConfig } from '../src/adapters/config/product-config.js';
import { buildWorkflowConfig } from '../src/adapters/review/setup-review-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(repoRoot, 'config', 'workflow.config.schema.json');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2455.01-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function productHasTargetUser(config: unknown): boolean {
  const product = (config as { product?: { targetUser?: unknown } } | null)?.product;
  return Boolean(product) && Object.prototype.hasOwnProperty.call(product, 'targetUser');
}

test('TASK-2455.01 defaults omit product.targetUser while keeping product.name', () => {
  withTempDir(root => {
    const effective = loadEffectiveConfig(root);
    assert.equal(productHasTargetUser(effective), false,
      'default configuration must not expose product.targetUser');
    assert.equal((effective as { product: { name: unknown } }).product.name, 'Workflow',
      'default configuration still sets product.name');
  });
});

test('TASK-2455.01 public schema does not declare product.targetUser', () => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as {
    properties: { product: { properties: { targetUser?: unknown } } };
  };
  assert.equal(
    'targetUser' in schema.properties.product.properties,
    false,
    'schema must not declare product.targetUser',
  );
});

test('TASK-2455.01 setup-generated workflow config omits product.targetUser', () => {
  const generated = buildWorkflowConfig({}) as { product: { name?: unknown; targetUser?: unknown } };
  assert.equal(productHasTargetUser(generated), false,
    'setup-generated workflow config must not include product.targetUser');
  assert.equal(typeof generated.product.name, 'string',
    'setup-generated workflow config still sets product.name');
});
