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
import { resolveParallixHome } from '../src/adapters/storage/storage.js';

const executionRoot = path.resolve(
  process.env.PARALLIX_EXECUTION_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
);
const packageJson = JSON.parse(fs.readFileSync(path.join(executionRoot, 'package.json'), 'utf8'));

const PROBE_CODE = 'process.stdout.write(process.env.PARALLIX_HOME ?? "")';

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
      env: childEnv as Record<string, string>,
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
