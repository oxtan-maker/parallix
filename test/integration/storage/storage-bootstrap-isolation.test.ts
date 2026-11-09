import { resolveConfiguration } from '../../../src/composition/config.js';
// TASK-2554 red-to-green reproduction: the standalone e2e test entries
// (`test:agent-e2e`, `test:lifecycle-e2e`) used to launch their test process
// with only `--import tsx`, so the process inherited the operator's
// PARALLIX_HOME (or resolved the platform default, e.g.
// ~/.local/state/parallix on Linux). The unit/integration runner isolates
// through test/bootstrap-parallix-home.ts, but these entries skipped it, so a
// test process that ever resolved the default home wrote fixture missions
// into the operator's real parallix.db.
//
// The reproduction runs each e2e entry's own import chain (read from
// package.json, so the real configured invocation is what is tested) against
// a probe that prints the effective PARALLIX_HOME, with PARALLIX_HOME removed
// from the environment. It fails at the parent commit (no isolation preload:
// the probe prints the operator default or nothing) and passes once the
// runner-wide isolation preload is part of the entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveParallixHome } from '../../../src/adapters/storage/storage.js';

const executionRoot = path.resolve(
  process.env.PARALLIX_EXECUTION_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
);
const packageJson = JSON.parse(fs.readFileSync(path.join(executionRoot, 'package.json'), 'utf8'));

const PROBE_CODE = 'process.stdout.write(process.env.PARALLIX_HOME ?? "")';
const ADMISSION_PROBE_CODE = 'process.stdout.write(JSON.stringify({home:process.env.PARALLIX_HOME,admission:process.env.PARALLIX_CUSTOM_ADMISSION_HOME}))';
const SMOKE_ADMISSION_PROBE_CODE = `
  const smoke = await import('./test/helpers/real-agent-smoke-selection.ts');
  process.stdout.write(smoke.configureRealAgentSmokeAdmissionHome());
`;

/**
 * Extract the `--import <module>` flags from an e2e npm script such as
 * `node --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/foo.test.ts`.
 * The trailing test-file argument is dropped; the probe replaces it.
 */
function e2eImportFlags(scriptName: string): string[] {
  const script = packageJson.scripts?.[scriptName];
  assert.equal(typeof script, 'string', `package.json script ${scriptName} is missing`);
  const tokens = script.trim().split(/\s+/);
  assert.equal(tokens[0], 'node', `expected ${scriptName} to invoke node directly, got: ${script}`);
  const flags: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === '--import') {
      assert.ok(tokens[i + 1], `dangling --import in ${scriptName}: ${script}`);
      flags.push('--import', tokens[i + 1]);
      i++;
    } else if (!tokens[i].startsWith('-')) {
      // The test-file argument (or later positional); the probe replaces it.
      break;
    }
  }
  assert.ok(
    flags.includes('tsx'),
    `expected ${scriptName} to register tsx in its import chain, got: ${script}`
  );
  return flags;
}

test('agent E2E entry permits only its explicit disposable admission-home override (PX-0049)', () => {
  const admissionHome = fs.mkdtempSync(path.join(os.tmpdir(), 'px-0049-bootstrap-admission-'));
  try {
    const env = {
      ...process.env,
      PARALLIX_HOME: undefined,
      PARALLIX_CUSTOM_ADMISSION_HOME: '/operator/admission/must-not-leak',
      PARALLIX_E2E_CUSTOM_ADMISSION_HOME: admissionHome,
    };
    const result = spawnSync(
      process.execPath,
      [...e2eImportFlags('test:agent-e2e'), '--input-type=module', '-e', ADMISSION_PROBE_CODE],
      { encoding: 'utf8', cwd: executionRoot, env, timeout: 30_000 }
    );
    assert.equal(result.error, undefined, `agent E2E admission probe failed to spawn: ${result.error?.message ?? ''}`);
    assert.equal(result.status, 0, `agent E2E admission probe exited ${result.status}: ${result.stderr || ''}`);
    const observed = JSON.parse(result.stdout) as { home: string; admission: string };
    assert.ok(observed.home.startsWith(os.tmpdir()));
    assert.notEqual(path.resolve(observed.home), path.resolve(admissionHome));
    assert.equal(path.resolve(observed.admission), path.resolve(admissionHome));
  } finally {
    fs.rmSync(admissionHome, { recursive: true, force: true });
  }
});

test('agent E2E public entry gives separate processes one shared disposable admission home (PX-0049)', () => {
  const probe = () => {
    const env = { ...process.env };
    delete env.PARALLIX_HOME;
    delete env.PARALLIX_E2E_CUSTOM_ADMISSION_HOME;
    env.PARALLIX_CUSTOM_ADMISSION_HOME = '/operator/admission/must-not-leak';
    const result = spawnSync(
      process.execPath,
      [...e2eImportFlags('test:agent-e2e'), '--input-type=module', '-e', SMOKE_ADMISSION_PROBE_CODE],
      { encoding: 'utf8', cwd: executionRoot, env, timeout: 30_000 }
    );
    assert.equal(result.error, undefined, `agent E2E shared admission probe failed to spawn: ${result.error?.message ?? ''}`);
    assert.equal(result.status, 0, `agent E2E shared admission probe exited ${result.status}: ${result.stderr || ''}`);
    return result.stdout;
  };
  const first = probe();
  const second = probe();
  assert.equal(first, second);
  assert.ok(first.startsWith(os.tmpdir()));
  assert.match(path.basename(first), /^parallix-smoke-admission-/);
  assert.notEqual(first, '/operator/admission/must-not-leak');
});

function probeEntryHome(scriptName: string): string {
  const env = { ...process.env };
  delete env.PARALLIX_HOME;
  const result = spawnSync(
    process.execPath,
    [...e2eImportFlags(scriptName), '--input-type=module', '-e', PROBE_CODE],
    { encoding: 'utf8', cwd: executionRoot, env, timeout: 30_000 }
  );
  assert.equal(result.error, undefined, `${scriptName} probe failed to spawn: ${result.error?.message ?? ''}`);
  assert.equal(
    result.status,
    0,
    `${scriptName} probe exited ${result.status}: ${result.stderr || ''}`
  );
  return result.stdout;
}

for (const scriptName of ['test:lifecycle-e2e', 'test:agent-e2e']) {
  test(`${scriptName} entry runs its test process with a temporary PARALLIX_HOME, not the operator default (task-2554)`, () => {
    const observed = probeEntryHome(scriptName);
    assert.ok(
      observed.length > 0,
      `${scriptName} entry does not establish a PARALLIX_HOME for its test process (observed: ${JSON.stringify(observed)})`
    );
    assert.ok(
      observed.startsWith(os.tmpdir()),
      `${scriptName} entry PARALLIX_HOME ${JSON.stringify(observed)} is not under the system temp dir`
    );
    const childEnv = { ...process.env, PARALLIX_HOME: undefined, HOME: process.env.HOME };
    const operatorDefault = resolveParallixHome({
      configuration: resolveConfiguration(childEnv),
      platform: process.platform,
      homedir: () => String(process.env.HOME)
    });
    assert.notEqual(
      path.resolve(observed),
      operatorDefault,
      `${scriptName} entry resolved the operator default PARALLIX_HOME ${operatorDefault}`
    );
  });
}
