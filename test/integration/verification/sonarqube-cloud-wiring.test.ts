// TASK-2546 — focused coverage for the single SonarQube Cloud scan entrypoint
// shared by local mission verification and GitHub `ci-required` (ADR 0060).
// Hermetic: reads repository configuration from disk and injects the scanner
// spawn. No Docker, no network, no committed token.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runSonar, resolveSonarContext } from '../../../scripts/sonar-local.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const COVERAGE_COMMAND = 'rm -f coverage/lcov.info && npm run coverage:merge && test -s coverage/lcov.info';

// Each call owns its Git repository, scanner directory and environment. The
// runner also tracks mkdtemp roots for cleanup after worker timeout/signal/exit.
function captureScan(env: Record<string, string | undefined>, status = 0,
  scanOptions: { branch?: string, waitForGate?: boolean, detached?: boolean } = {}) {
  const captured: { value: { command: string, args: string[], token?: string, scannerHome?: string } | null } = { value: null };
  let rootDir = '';
  let context: ReturnType<typeof resolveSonarContext> | undefined;
  const spawn = ((command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    captured.value = { command: String(command), args, token: options.env.SONAR_TOKEN, scannerHome: options.env.SONAR_USER_HOME };
    return { status } as ReturnType<typeof spawnSync>;
  }) as typeof spawnSync;
  const run = () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sonar-wiring-'));
    const changes: Record<string, string | undefined> = {
      ...Object.fromEntries(Object.keys(process.env).filter(key => key.startsWith('GIT_')).map(key => [key, undefined])),
      SONAR_TOKEN: undefined, SONAR_USER_HOME: undefined, GITHUB_ACTIONS: undefined,
      GITHUB_REF: undefined, GITHUB_REF_NAME: undefined, ...env,
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: '4', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null',
      GIT_CONFIG_KEY_1: 'user.name', GIT_CONFIG_VALUE_1: 'Sonar fixture',
      GIT_CONFIG_KEY_2: 'user.email', GIT_CONFIG_VALUE_2: 'sonar@example.invalid',
      GIT_CONFIG_KEY_3: 'commit.gpgSign', GIT_CONFIG_VALUE_3: 'false',
    };
    const previous = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
    try {
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      const git = (...args: string[]) => {
        const result = spawnSync('git', args, { cwd: fixture, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr || result.error?.message || 'git command failed');
      };
      git('init', '-b', 'main');
      git('commit', '--allow-empty', '-m', 'fixture');
      rootDir = path.join(fixture, 'worktree');
      git('worktree', 'add', ...(scanOptions.detached ? ['--detach'] : ['-b', 'fixture/worktree']), rootDir, 'HEAD');
      const result = runSonar({ rootDir, spawn, branch: scanOptions.branch, waitForGate: scanOptions.waitForGate });
      context = resolveSonarContext(rootDir);
      return result;
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  };
  return { run, read: () => captured.value, root: () => rootDir, context: () => context };
}

test('local sonar scan submits the worktree branch to the one Cloud project', () => {
  const { run, read, root } = captureScan({ SONAR_TOKEN: 'operator-token', GITHUB_ACTIONS: undefined });
  run();
  const captured = read()!;
  const branch = 'fixture/worktree';

  assert.equal(path.basename(captured.command), 'sonar-scanner');
  assert.deepEqual(captured.args, [
    '-Dsonar.host.url=https://sonarcloud.io',
    '-Dsonar.organization=oxtan-maker',
    '-Dsonar.projectKey=parallix',
    `-Dsonar.branch.name=${branch}`,
  ]);
  // The branch is the Git identity itself: no sanitisation, no hash, no
  // per-mission project key. The retired resolveSonarBranch export is gone
  // (SC2); branch selection is asserted through the runSonar args above.
  assert.equal(fs.existsSync(root()), false, 'the worktree fixture is removed');
  assert.equal(captured.token, 'operator-token', 'the scanner receives the environment token');
  assert.equal(captured.scannerHome, path.join(root(), 'tmp', 'sonar'), 'the scanner keeps temporary data in the worktree');
  assert.doesNotMatch(captured.args.join(' '), /operator-token/, 'the token is never passed as a scanner argument');
});

test('mission comparison uses one waited short branch against main', () => {
  const short = captureScan({ SONAR_TOKEN: 'operator-token', GITHUB_ACTIONS: undefined }, 0, { branch: 'candidate/mission/task-2560' });
  short.run();
  assert.ok(short.read()!.args.includes('-Dsonar.branch.target=main'));
  assert.ok(short.read()!.args.includes('-Dsonar.branch.name=candidate/mission/task-2560'));
  assert.ok(!short.read()!.args.includes('-Dsonar.qualitygate.wait=false'));
  const source = fs.readFileSync(path.join(repoRoot, 'scripts', 'sonar-local.ts'), 'utf8');
  assert.match(source, /runSonar\(\{ rootDir, branch: comparison \}\);\s+await assertShortBranch/);
  assert.doesNotMatch(source, /waitForGate: false|assertMissionTotalCode|assertNoOpenHighOrBlockerIssues|awaitAnalysis/,
    'local mission verification must not run a LONG scan, total-code query, or polling path');
});

test('github sonar scan derives PR identity in a detached merge worktree (TASK-2676)', () => {
  const { run, read, context } = captureScan({
    SONAR_TOKEN: 'ci-token', GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/pull/13/merge', GITHUB_REF_NAME: '13/merge',
  }, 0, { detached: true });
  run();

  assert.deepEqual(context(), { kind: 'github-pull-request', pullRequest: '13' });
  // The retired resolveSonarBranch export is gone (SC2); the GitHub path is
  // asserted through the runSonar args: no local branch is submitted.
  assert.doesNotMatch(read()!.args.join(' '), /sonar\.branch\.name/);
  // Everything else is identical to the local invocation: one entrypoint, one
  // project, differing only where the environment genuinely differs.
  assert.deepEqual(read()!.args, [
    '-Dsonar.host.url=https://sonarcloud.io',
    '-Dsonar.organization=oxtan-maker',
    '-Dsonar.projectKey=parallix',
  ]);
});

test('sonar scan fails closed when no token is supplied', () => {
  const { run, read } = captureScan({ SONAR_TOKEN: undefined, GITHUB_ACTIONS: undefined });
  assert.throws(run, /SONAR_TOKEN is not set/);
  assert.equal(read(), null, 'the scanner is never spawned without a token');
});

test('sonar scan fails closed when the quality gate does not pass', () => {
  // sonar.qualitygate.wait=true makes a failed gate a non-zero scanner exit,
  // so a non-zero status must abort the gate rather than pass it through.
  const { run } = captureScan({ SONAR_TOKEN: 'operator-token', GITHUB_ACTIONS: undefined }, 1);
  assert.throws(run, /analysis or quality gate failed/);
});

test('local detached sonar scan fails before spawning instead of submitting HEAD (TASK-2676)', () => {
  const { run, read, root } = captureScan({ SONAR_TOKEN: 'operator-token' }, 0, { detached: true });
  assert.throws(run, /Cannot resolve the Git branch.*check out a branch before scanning/);
  assert.equal(read(), null);
  assert.equal(fs.existsSync(root()), false, 'failure removes the fixture');
});

test('sonar fixtures restore every modified environment value on success and failure (TASK-2676)', () => {
  const previous = { ...process.env };
  for (const status of [0, 1]) {
    const scan = captureScan({ SONAR_TOKEN: 'fixture-token', GITHUB_ACTIONS: undefined,
      GITHUB_REF: undefined, GITHUB_REF_NAME: undefined, SONAR_USER_HOME: 'ignored-home' }, status);
    if (status === 0) scan.run();
    else assert.throws(scan.run, /analysis or quality gate failed/);
    assert.deepEqual({ ...process.env }, previous);
    assert.equal(fs.existsSync(scan.root()), false);
  }
});

test('local verification and GitHub invoke the same pinned sonar entrypoint', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'workflow.config.json'), 'utf8'));
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci-required.yml'), 'utf8');
  const lockfile = fs.readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8');

  assert.equal(manifest.scripts.sonar, 'tsx scripts/sonar-local.ts scan');
  const gates = config.adapters.gates.preIntegration as Array<{ key: string, command: string, after?: string[] }>;
  assert.equal(gates.find(gate => gate.key === 'coverage-merge')?.command, COVERAGE_COMMAND);
  assert.deepEqual(gates.find(gate => gate.key === 'quality-gate'),
    { key: 'quality-gate', command: 'npm run sonar', order: 10, after: ['coverage-merge'] },
    'the quality gate waits for fresh coverage and uses the shared scanner entrypoint');
  // GitHub and local share the single pinned sonar entrypoint (ADR 0060). The
  // hosted path no longer runs the combined coverage-plus-scan command (TASK-2547:
  // coverage is a reporting mode of the CI-safe execution); it unions the
  // per-tier LCOV fragments first, then reaches the same npm run sonar.
  assert.ok(workflow.includes('npm run sonar'), 'ci-required reaches the shared npm run sonar entrypoint');
  assert.ok(workflow.includes('npm run coverage:merge'), 'ci-required unions per-tier LCOV before the scan');

  // The scanner is lockfile-pinned, never fetched at gate time.
  assert.ok(manifest.devDependencies['sonar-scanner'], 'the scanner is a declared dependency');
  assert.match(lockfile, /^ {2}sonar-scanner@3\.1\.0:/m, 'the scanner is pinned in the lockfile');
  assert.doesNotMatch(workflow, /npx\s+--yes/);
});

test('ci-required provisions Java 21+ via a SHA-pinned setup action before the Sonar gate', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci-required.yml'), 'utf8');

  // The Java provisioning action is pinned to an immutable 40-char release SHA
  // with a release-version comment (TASK-2636), same contract as every other
  // action in this workflow (TASK-2549). No floating reference or `npx --yes`.
  const setupJava = workflow.match(/actions\/setup-java@([0-9a-f]{40})\s*#\s*v(\d+\.\d+\.\d+)/);
  assert.ok(setupJava, 'ci-required pins setup-java to an immutable SHA with a version comment');

  // Java 21 or newer is required: SonarQube Cloud Scanner 3.1+ rejects Java < 21.
  const javaVersion = workflow.match(/java-version:\s*['"]?(\d+)/);
  assert.ok(javaVersion, 'ci-required declares an explicit java-version');
  assert.ok(javaVersion && Number(javaVersion[1]) >= 21, 'the provisioned Java runtime is 21 or newer');

  // Java must be provisioned before the mandatory quality gate can invoke the
  // shared scanner entrypoint: the pinned setup step precedes the runnable
  // `npm run sonar` invocation, ignoring the same literal quoted in comments.
  const setupIdx = workflow.indexOf(setupJava![0]);
  const sonarIdx = [...workflow.matchAll(/npm run sonar/g)].find((m) => {
    const lineStart = workflow.lastIndexOf('\n', m.index) + 1;
    return !workflow.slice(lineStart, m.index).trimStart().startsWith('#');
  })?.index ?? -1;
  assert.ok(setupIdx >= 0 && sonarIdx >= 0, 'both the setup-java step and the runnable sonar entrypoint exist');
  assert.ok(setupIdx < sonarIdx, 'Java is provisioned before npm run sonar');
});

test('sonar analysis configuration consumes LCOV without a Cloud-unsupported new-code override', () => {
  const props = fs.readFileSync(path.join(repoRoot, 'sonar-project.properties'), 'utf8');

  assert.match(props, /sonar\.javascript\.lcov\.reportPaths=coverage\/lcov\.info/);
  assert.match(props, /sonar\.sources=src/);
  assert.doesNotMatch(props, /sonar\.newCode\.referenceBranch|sonar\.projectVersion=/);
  // Local and GitHub merge the same per-tier fragments into coverage/lcov.info
  // before the shared scanner runs; no dedicated c8 test pass is involved.
  assert.ok(COVERAGE_COMMAND.includes('coverage:merge'), 'the local pre-integration gate merges the LCOV fragments');
});

test('no local SonarQube path survives anywhere in the tracked tree', () => {
  const tracked = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  // ADR 0060 and this file are excluded on purpose: a decision record names the
  // mechanisms it rejects, and this test must quote the retired literals to
  // search for them. Neither is surviving machinery.
  const self = path.relative(repoRoot, fileURLToPath(import.meta.url));
  const sources = tracked.filter((file) => file !== self).filter((file) => /^(src|test|scripts|\.github)\//.test(file)
    || ['package.json', 'workflow.config.json', 'sonar-project.properties'].includes(file))
    .filter((file) => fs.existsSync(path.join(repoRoot, file)));

  assert.equal(tracked.filter((file) => file.startsWith('infra/sonarqube/') && fs.existsSync(path.join(repoRoot, file))).length, 0, 'the Compose stack is gone');
  // Use the hosted runner's text scanner for the full source inventory rather
  // than decoding every file in JS. -a includes binary content, and explicit
  // paths retain untracked files and symlink targets from the inventory above.
  // Keep the individual assertions for precise diagnostics on every match.
  const scan = spawnSync('grep', ['-a', '-l', '-E',
    '127\\.0\\.0\\.1:9000|SONAR_MODE|resolveSonarProjectKey|encodeBranchIdentity|sanitizeProjectKey',
    '--', ...sources], { cwd: repoRoot, encoding: 'utf8' });
  assert.ok(scan.status === 0 || scan.status === 1, scan.stderr || scan.error?.message || 'source scan failed');
  for (const file of scan.stdout.split('\n').filter(Boolean)) {
    const contents = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(contents, /127\.0\.0\.1:9000/, `${file} must not reference the retired local server`);
    assert.doesNotMatch(contents, /SONAR_MODE/, `${file} must not reintroduce a local/cloud toggle`);
    assert.doesNotMatch(contents, /resolveSonarProjectKey|encodeBranchIdentity|sanitizeProjectKey/, `${file} must not resolve a per-mission project key`);
  }
});
