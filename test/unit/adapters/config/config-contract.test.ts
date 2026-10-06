// Historical regression provenance: TASK-1233, TASK-2500.01, TASK-2455.01, TASK-2455.02.
// Workflow configuration contract: discovery, readiness, integration mode,
// product defaults and task-provider validation. Each describe block keeps the
// historical task ID as regression provenance. Merged from the former
// config-contract-deferral (task-1233), integration-mode-config (task-2500.01),
// task-2455.01-target-user-repro and task-2455.02-task-provider-config-repro
// suites (TASK-2622.14).
import { describe, test } from 'node:test';
import { terminalHostConfig } from '../../../../src/adapters/config/terminal-host-config.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INTEGRATION_MODES,
  DEFAULT_INTEGRATION_MODE,
  isIntegrationMode,
  parseIntegrationMode,
} from '../../../../src/domain/integration.js';
import {
  configCandidates,
  evaluateRepositoryReadiness,
  findWorkflowConfig,
  loadEffectiveConfig,
  resolveIntegrationMode,
  resolveTaskProvider,
  resolveTaskStorage,
  validateWorkflowConfig,
} from '../../../../src/adapters/config/product-config.js';
import { getTaskStorage } from '../../../../src/adapters/backlog/task-file-io.js';
import { buildWorkflowConfig } from '../../../../src/adapters/review/setup-review-config.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const schemaPath = path.join(repoRoot, 'config', 'workflow.config.schema.json');

function withTempDir(fn: (_dir: string) => void): void {
  const dir = registeredMkdtemp('workflow-config-contract-');
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function withConfig(config: unknown | null, run: (_root: string) => void): void {
  withTempDir(root => {
    if (config !== null) {
      fs.writeFileSync(path.join(root, 'workflow.config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    }
    run(root);
  });
}

describe("workflow.config.json discovery and readiness", () => {
  // GAP from CP-2 row 2: malformed JSON reaches the parseError -> 'invalid' branch
  // of evaluateRepositoryReadiness, which had no direct unit coverage.
  test('evaluateRepositoryReadiness returns invalid for malformed workflow.config.json', () => {
    withTempDir(root => {
      fs.writeFileSync(path.join(root, 'workflow.config.json'), '{ not valid json');

      const result = evaluateRepositoryReadiness(root);
      assert.equal(result.mode, 'invalid');
      assert.ok(result.issues.some(i => i.startsWith('invalid JSON:')), JSON.stringify(result.issues));
    });
  });

  // With code-owned defaults, a repo with no workflow.config.json (e.g. the
  // WrGroceries layout) resolves to 'default' readiness with no issues — an absent
  // config is a valid, ready state, not a failure. WrGroceries keeps working with
  // zero repo config.
  test('evaluateRepositoryReadiness returns default mode without workflow.config.json', () => {
    withTempDir(root => {
      fs.mkdirSync(path.join(root, 'backlog'), { recursive: true });
      fs.mkdirSync(path.join(root, 'docs', 'missions'), { recursive: true });
      fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(root, 'scripts', 'verify-local.sh'), '#!/usr/bin/env bash\n');

      const result = evaluateRepositoryReadiness(root);
      assert.equal(result.mode, 'default');
      assert.equal(result.configPath, null);
      assert.deepEqual(result.issues, []);
    });
  });

  // Discovery guard: the contract consults only workflow.config.json — no example
  // file and no new filename (e.g. parallix.config.json). A foreign config name is
  // never consulted; the repo runs on code-owned defaults.
  test('config discovery is limited to workflow.config.json (no example, no new filename)', () => {
    withTempDir(root => {
      const candidates = configCandidates(root).map(c => path.basename(c));
      assert.deepEqual(candidates, ['workflow.config.json']);

      fs.writeFileSync(path.join(root, 'parallix.config.json'), '{"product":{}}');
      assert.equal(findWorkflowConfig(root), null);

      const result = evaluateRepositoryReadiness(root);
      assert.equal(result.mode, 'default');
    });
  });
});

describe("integration.mode configuration", () => {
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
});

describe("product.targetUser retirement", () => {
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
});

describe("adapters.tasks.provider validation", () => {
  const OTHER_PROVIDER_CONFIG = { adapters: { tasks: { provider: 'other' } } };

  test('an unsupported adapters.tasks.provider is rejected by configuration validation', () => {
    const issues = validateWorkflowConfig(OTHER_PROVIDER_CONFIG);

    assert.ok(
      issues.some(issue => issue.includes('adapters.tasks.provider')),
      `expected a validation issue for adapters.tasks.provider, got ${JSON.stringify(issues)}`,
    );
    assert.ok(
      issues.some(issue => issue.includes('backlog-md')),
      `expected the supported value to be named in ${JSON.stringify(issues)}`,
    );
  });

  test('an unsupported adapters.tasks.provider does not compose the backlog-Markdown task adapter', () => {
    withConfig(OTHER_PROVIDER_CONFIG, root => {
      assert.throws(() => resolveTaskStorage(root), /adapters\.tasks\.provider/);
    });
  });

  test('an unsupported adapters.tasks.provider stops the backlog-Markdown task file adapter', () => {
    withConfig(OTHER_PROVIDER_CONFIG, root => {
      assert.throws(() => resolveTaskProvider(root), /adapters\.tasks\.provider/);
      assert.throws(() => getTaskStorage(root), /adapters\.tasks\.provider/);
    });
  });

  test('the supported adapters.tasks.provider selects the backlog-Markdown task adapter', () => {
    withConfig({ adapters: { tasks: { provider: 'backlog-md', storage: 'backlog' } } }, root => {
      assert.deepEqual(validateWorkflowConfig({ adapters: { tasks: { provider: 'backlog-md' } } }), []);
      assert.equal(resolveTaskProvider(root), 'backlog-md');
      assert.equal(getTaskStorage(root).tasksDir, path.join(root, 'backlog', 'tasks'));
    });
  });

  test('an omitted adapters.tasks.provider keeps the default backlog-Markdown selection', () => {
    withConfig({ adapters: { tasks: { storage: 'backlog' } } }, root => {
      assert.equal(resolveTaskProvider(root), 'backlog-md');
      assert.equal(resolveTaskStorage(root).tasksDir, path.join(root, 'backlog', 'tasks'));
    });
  });
  test('adapters.terminal defaults to automatic tmux hosting and rejects unknown values (TASK-2643)', () => {
    assert.deepEqual(validateWorkflowConfig({ adapters: { terminal: { host: 'tmux', whenUnavailable: 'fail' } } }), []);
    assert.deepEqual(validateWorkflowConfig({ adapters: { terminal: { host: 'screen' } } }), ['adapters.terminal.host must be one of "auto", "pipe", "tmux"']);
    assert.deepEqual(validateWorkflowConfig({ adapters: { terminal: { whenUnavailable: 'ignore' } } }), ['adapters.terminal.whenUnavailable must be one of "fallback", "fail"']);
    assert.equal(validateWorkflowConfig({ adapters: { terminal: { attach: true } } }).length, 1);
    assert.deepEqual(terminalHostConfig({}), { host: 'auto', whenUnavailable: 'fallback' });
    assert.deepEqual(terminalHostConfig({ terminal: { host: 'tmux' } }), { host: 'tmux', whenUnavailable: 'fallback' });
  });
});
