// task-2500.01 CP-1: `integration.mode` is first-class repository configuration.
// Absent mode means `local`; the three supported modes parse; anything else is a
// fail-closed configuration error that names the value and the allowed set.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INTEGRATION_MODES,
  DEFAULT_INTEGRATION_MODE,
  isIntegrationMode,
  parseIntegrationMode,
} from '../src/domain/integration.js';
import {
  loadEffectiveConfig,
  resolveIntegrationMode,
  validateWorkflowConfig,
} from '../src/adapters/config/product-config.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(repoRoot, 'config', 'workflow.config.schema.json');

function withConfig(config: unknown | null, run: (_root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2500.01-integration-mode-'));
  try {
    if (config !== null) {
      fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify(config));
    }
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('integration mode defaults to local when no repository config is present', () => {
  withConfig(null, root => {
    assert.equal(resolveIntegrationMode(root), 'local');
    assert.equal(loadEffectiveConfig(root).integration.mode, 'local');
  });
});

test('integration mode defaults to local when the config omits the integration section', () => {
  withConfig({ adapters: { review: { provider: 'none' } } }, root => {
    assert.equal(resolveIntegrationMode(root), 'local');
  });
});

test('every supported integration mode resolves from repository configuration', () => {
  for (const mode of INTEGRATION_MODES) {
    withConfig({ integration: { mode } }, root => {
      assert.equal(resolveIntegrationMode(root), mode);
      assert.deepEqual(validateWorkflowConfig({ integration: { mode } }), []);
      assert.equal(loadEffectiveConfig(root).integration.mode, mode);
    });
  }
});

test('the public schema enum accepts exactly the three supported integration modes', () => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as {
    properties: { integration: { properties: { mode: { enum: string[] } } } };
  };
  assert.deepEqual(schema.properties.integration.properties.mode.enum, [...INTEGRATION_MODES]);
  assert.deepEqual([...INTEGRATION_MODES], ['local', 'github-publish', 'github-pr']);
  assert.equal(DEFAULT_INTEGRATION_MODE, 'local');
});

test('an unknown integration mode fails closed with the invalid value and the allowed set', () => {
  withConfig({ integration: { mode: 'gitlab-mr' } }, root => {
    assert.throws(() => resolveIntegrationMode(root), (error: Error) => {
      assert.match(error.message, /"gitlab-mr"/);
      assert.match(error.message, /\{ local, github-publish, github-pr \}/);
      return true;
    });
  });
  assert.deepEqual(validateWorkflowConfig({ integration: { mode: 'gitlab-mr' } }).length, 1);
  assert.match(
    validateWorkflowConfig({ integration: { mode: 'gitlab-mr' } })[0],
    /integration\.mode "gitlab-mr" is not a supported integration mode\. Allowed values: \{ local, github-publish, github-pr \}/,
  );
});

test('a non-object integration section is a configuration error', () => {
  assert.deepEqual(validateWorkflowConfig({ integration: [] }), ['integration must be an object']);
  withConfig({ integration: 'local' }, root => {
    assert.throws(() => resolveIntegrationMode(root), /integration must be an object/);
  });
});

test('parseIntegrationMode treats absent input as local and rejects unknown input', () => {
  assert.equal(parseIntegrationMode(undefined), 'local');
  assert.equal(parseIntegrationMode(null), 'local');
  assert.equal(parseIntegrationMode('github-pr'), 'github-pr');
  assert.throws(() => parseIntegrationMode(7), /is not a supported integration mode/);
  assert.equal(isIntegrationMode('local'), true);
  assert.equal(isIntegrationMode('LOCAL'), false);
});
