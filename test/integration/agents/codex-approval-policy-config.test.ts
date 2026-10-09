import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveConfiguration } from '../../../src/composition/config.js';
import test from 'node:test';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';

const codexModule = mockModule<typeof import('../../../src/adapters/agents/codex.js')>('../../../src/adapters/agents/codex.js', import.meta.url);
await installModuleMocks();
const { buildCodexDraftInvocation, codexConfigPath, ensureCodexHome } = codexModule;

const CODEX_VERSION = '0.156.1';
const CODEX_PACKAGE = `@openai/codex@${CODEX_VERSION}`;

function cachedCodexBinary(npmCache: string): string | null {
  const npxRoot = path.join(npmCache, '_npx');
  try {
    for (const entry of fs.readdirSync(npxRoot)) {
      const binary = path.join(npxRoot, entry, 'node_modules', '.bin', 'codex');
      if (fs.existsSync(binary)) { return binary; }
    }
  } catch {
    // The first invocation populates the cache through npx.
  }
  return null;
}

function runPinnedCodex(args: string[], env: NodeJS.ProcessEnv, npmCache: string) {
  const binary = cachedCodexBinary(npmCache);
  const command = binary ?? 'npx';
  const commandArgs = binary ? args : ['--yes', '--package', CODEX_PACKAGE, 'codex', ...args];
  return childProcess.spawnSync(command, commandArgs, {
    encoding: 'utf8',
    env,
    timeout: 30_000,
  });
}

test('task-2570: generated Codex v0.156.1 mission config has supported approval policy settings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2570-'));
  const operatorCodexHome = path.join(root, 'operator-codex');
  const worktree = path.join(root, 'mission-worktree');
  const npmCache = path.join(root, 'npm-cache');
  fs.mkdirSync(operatorCodexHome, { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  fs.mkdirSync(npmCache, { recursive: true });

  try {
    const template = fs.readFileSync(path.resolve('templates/codex/config.toml'), 'utf8');
    const projectTable = template.slice(template.indexOf('[projects.'));
    assert.match(template, /^approval_policy = "never"$/m);
    assert.match(projectTable, /^trust_level = "trusted"$/m);
    assert.doesNotMatch(projectTable, /approval_policy/);

    fs.writeFileSync(path.join(operatorCodexHome, 'config.toml'), template);
    ensureCodexHome(worktree, resolveConfiguration({ CODEX_HOME: operatorCodexHome }));
    assert.equal(fs.readlinkSync(codexConfigPath(worktree)), path.join(operatorCodexHome, 'config.toml'));

    const invocation = buildCodexDraftInvocation({ prompt: 'config check', worktree, interactive: false });
    assert.ok(invocation.args.includes('approval_policy="never"'));
    assert.ok(invocation.args.some((arg: string) => arg.includes('.trust_level="trusted"')));
    assert.equal(invocation.args.some((arg: string) => arg.includes('.approval_policy=')), false);

    const env = { ...process.env, CODEX_HOME: invocation.options.env.CODEX_HOME, npm_config_cache: npmCache };
    // The initial npx invocation populates this case's isolated cache.  The
    // two strict-config probes below still execute the exact pinned CLI, but
    // bypass npx's repeated package-resolution process.
    const version = runPinnedCodex(['--version'], env, npmCache);
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout, new RegExp(`codex-cli ${CODEX_VERSION.replaceAll('.', '\\.')}`));

    // `--help` exits before Codex parses config.toml. Run `exec --strict-config`
    // instead so the pinned CLI validates the linked mission config. A missing
    // output schema stops the fixed launch before any provider is contacted.
    const launchArgs = [
      ...invocation.args.slice(0, -1),
      '--skip-git-repo-check',
      '--strict-config',
      '--output-schema',
      path.join(root, 'missing-output-schema.json'),
      invocation.args.at(-1)!,
    ];
    const launch = runPinnedCodex(launchArgs, env, npmCache);
    assert.notEqual((launch.error as NodeJS.ErrnoException | undefined)?.code, 'ETIMEDOUT', 'Codex did not reach config validation before timing out');
    assert.match(`${launch.stdout}\n${launch.stderr}`, /Failed to read output schema file/i);
    assert.doesNotMatch(`${launch.stdout}\n${launch.stderr}`, /unrecognized.*setting/i);

    const unsupportedParentConfig = template
      .replace(/^approval_policy = "never"\n\n/m, '')
      .replace(/^trust_level = "trusted"$/m, 'trust_level = "trusted"\napproval_policy = "never"');
    fs.writeFileSync(path.join(operatorCodexHome, 'config.toml'), unsupportedParentConfig);
    const unsupportedLaunch = runPinnedCodex(launchArgs, env, npmCache);
    assert.notEqual((unsupportedLaunch.error as NodeJS.ErrnoException | undefined)?.code, 'ETIMEDOUT', 'Codex did not reach config validation before timing out');
    assert.match(`${unsupportedLaunch.stdout}\n${unsupportedLaunch.stderr}`, /approval_policy/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
