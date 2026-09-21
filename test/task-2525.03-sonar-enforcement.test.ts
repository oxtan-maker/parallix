// TASK-2525.03 — focused configuration coverage for the shared
// coverage-plus-SonarQube command wired into the GitHub required workflow and
// the repository-owned pre-integration gate plan. Hermetic: reads repo config
// from disk and injects the scanner spawn; no Docker, no real SonarQube server,
// no committed token.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// TASK-2547: coverage is a reporting mode of the CI-safe execution, not a second
// pass. GitHub unions the per-tier LCOV fragments with `npm run coverage:merge`
// after the unit and integration-ci populations run once with built in coverage;
// the local pre-integration gate still emits LCOV through `npm run test:coverage`
// (which selects through the planner, never a glob). Both reach the single
// `npm run sonar` entrypoint (ADR 0060).

function escaped(source: string): RegExp {
  return new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

test('task-2525.03: GitHub coverage is produced by the CI-safe execution and Sonar uses the single shared entrypoint', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci-required.yml'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'workflow.config.json'), 'utf8'));
  const preIntegration = config.adapters.gates.preIntegration as Array<{ key: string, command: string }>;

  // Coverage is a reporting mode of the CI-safe execution, not a second pass:
  // GitHub runs the unit and integration-ci populations once with coverage, unions
  // the per-tier LCOV fragments with `npm run coverage:merge`, and never runs a
  // broad test suite again to feed the scanner (SC3, SC7).
  assert.match(workflow, /npm run coverage:merge/, 'ci-required.yml unions per-tier LCOV before the scan');
  assert.doesNotMatch(workflow, /npm run test:coverage/, 'ci-required.yml must not run a second coverage test pass');

  // `npm run sonar` is the single SonarQube Cloud entrypoint shared by GitHub and
  // the local pre-integration gate (ADR 0060).
  assert.match(workflow, /npm run sonar/, 'ci-required.yml reaches the shared npm run sonar entrypoint');
  assert.ok(
    preIntegration.some((gate) => /npm run sonar/.test(gate.command)),
    'workflow.config.json preIntegration reaches the shared npm run sonar entrypoint',
  );
});

test('task-2525.03: GitHub workflow sources SONAR_TOKEN only from environment secrets', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci-required.yml'), 'utf8');

  // Secrets arrive through the GitHub secrets context, never a literal value,
  // set at the job level so the trusted-run guard can read them.
  assert.match(workflow, /SONAR_TOKEN:\s*\$\{\{\s*secrets\.SONAR_TOKEN\s*\}\}/);

  // The Cloud host is repository configuration (sonar-project.properties), not
  // a secret: SONAR_TOKEN is the only credential the workflow requires.
  assert.doesNotMatch(workflow, /SONAR_HOST_URL/);

  // The step guard branches on the event/repodata context, not the secrets
  // context: GitHub Actions rejects `secrets` in a step-level if: conditional,
  // so asserting it would lock in an expression GitHub refuses to validate.
  // Trusted runs (push + same-repo PRs) run SonarQube; untrusted fork PRs skip.
  assert.match(
    workflow,
    /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/,
    'runs on same-repo pull requests',
  );
  assert.doesNotMatch(
    workflow,
    /if:\s*\$\{\{\s*secrets\./,
    'step if: must not reference the secrets context',
  );

  // On trusted runs a missing token fails the job clearly (mandatory gate).
  assert.match(
    workflow,
    /SONAR_TOKEN environment secret is not configured/,
    'trusted runs fail clearly when the token is missing',
  );

  // No literal token value is committed to the workflow.
  assert.doesNotMatch(workflow, /SONAR_TOKEN:\s*['"][A-Za-z0-9_\-]{12,}['"]/);
});

test('task-2525.03: GitHub workflow waits for the quality gate and publishes it to the job summary', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci-required.yml'), 'utf8');

  // The scanner waits for the gate (sonar-project.properties); a failed gate
  // exits non-zero and fails the required job. The result is published for both
  // pass and fail outcomes.
  assert.match(workflow, /Publish SonarQube quality gate result/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.match(workflow, escaped('npm run sonar > "$GITHUB_WORKSPACE/sonar-quality-gate.log" 2>&1'));
});

test('task-2525.03: scanner configuration preserves the recorded legacy baseline and rejects new-code regressions', () => {
  const props = fs.readFileSync(path.join(repoRoot, 'sonar-project.properties'), 'utf8');
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci-required.yml'), 'utf8');

  // One Cloud project for every branch (ADR 0060), and the gate rejects
  // new-code regressions.
  assert.match(props, /sonar\.projectKey=parallix/);
  assert.match(props, /sonar\.host\.url=https:\/\/sonarcloud\.io/);
  assert.match(props, /sonar\.organization=oxtan-maker/);
  assert.match(props, /sonar\.qualitygate\.wait=true/);

  // Coverage is emitted as full LCOV (line threshold 0) by the CI-safe
  // execution; SonarQube owns the required 90% coverage condition for new
  // code, so the existing ~57% legacy baseline cannot mask a new regression.
  assert.match(workflow, /PARALLIX_TEST_COVERAGE/, 'ci-required.yml enables coverage during the CI-safe execution');
  assert.match(workflow, /npm run coverage:merge/, 'ci-required.yml unions the per-tier LCOV fragments');

  // No rule is disabled, suppressed, or lowered to lower the baseline. The
  // existing sonar.exclusions entry scopes build/node_modules/coverage out of
  // analysis (legitimate scope), which is distinct from suppressing findings.
  assert.doesNotMatch(props, /sonar\.comments|sonar\.issue\.effective|@sonar|@SuppressWarnings/);
});

test('task-2525.04: shared scanner rejects a quality gate that permits new High-or-worse issues', async () => {
  const { assertNewIssuesFail } = await import('../scripts/sonar-local.js');
  const request: typeof fetch = async (url) => new Response(JSON.stringify(String(url).includes('get_by_project')
    ? { qualityGate: { name: 'Parallix 90% new code' } }
    : { conditions: [{ metric: 'new_violations', op: 'GT', error: '0' }] }));
  await assertNewIssuesFail({ token: 'test-token', request });

  await assert.rejects(
    assertNewIssuesFail({ token: 'test-token', request: async (url) => new Response(JSON.stringify(String(url).includes('get_by_project')
      ? { qualityGate: { name: 'permissive' } }
      : { conditions: [] })) }),
    /must fail on every new issue/,
  );
});

test('task-2525.05: shared scanner rejects High-or-Blocker issues in the candidate analysis', async () => {
  const { assertNoOpenHighOrBlockerIssues } = await import('../scripts/sonar-local.js');
  const request: typeof fetch = async (url) => new Response(JSON.stringify(String(url).includes('project_branches/list')
    ? { branches: [{ name: 'mission/task-2525.05', type: 'LONG' }] }
    : { component: { measures: [{ value: '{"HIGH":0,"BLOCKER":0}' }] } }));
  await assertNoOpenHighOrBlockerIssues({ token: 'test-token', scope: { branch: 'mission/task-2525.05' }, request });

  await assert.rejects(
    assertNoOpenHighOrBlockerIssues({ token: 'test-token', scope: { branch: 'mission/task-2525.05' }, request: async (url) => new Response(JSON.stringify(String(url).includes('project_branches/list') ? { branches: [{ name: 'mission/task-2525.05', type: 'LONG' }] } : { component: { measures: [{ value: '{"HIGH":1}' }] } })) }),
    /mission analysis has unresolved HIGH\/BLOCKER impacts/,
  );
});

test('task-2525.05: total-code check rejects a short mission branch and skips pull-request analysis', async () => {
  const { assertNoOpenHighOrBlockerIssues } = await import('../scripts/sonar-local.js');
  await assert.rejects(
    assertNoOpenHighOrBlockerIssues({ token: 'test-token', scope: { branch: 'mission/task-2525.05' }, request: async () => new Response(JSON.stringify({ branches: [{ name: 'mission/task-2525.05', type: 'SHORT' }] })) }),
    /must be analysed as LONG/,
  );
  await assertNoOpenHighOrBlockerIssues({ token: 'test-token', scope: { pullRequest: '123' }, request: async () => { throw new Error('PR scans must not use total-code branch metrics'); } });
});

test('task-2525.05: candidate scope identifies local branches and GitHub pull requests', async () => {
  const { resolveIssueScope } = await import('../scripts/sonar-local.js');
  const saved = Object.fromEntries(['GITHUB_ACTIONS', 'GITHUB_REF', 'GITHUB_REF_NAME'].map((key) => [key, process.env[key]]));
  try {
    delete process.env.GITHUB_ACTIONS;
    delete process.env.GITHUB_REF;
    delete process.env.GITHUB_REF_NAME;
    const localRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'sonar-scope-'));
    try {
      execFileSync('git', ['init', '-b', 'candidate'], { cwd: localRepo });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: localRepo });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: localRepo });
      execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: localRepo });
      assert.deepEqual(resolveIssueScope(localRepo), { branch: 'candidate' });
    } finally {
      fs.rmSync(localRepo, { recursive: true, force: true });
    }

    process.env.GITHUB_ACTIONS = 'true';
    process.env.GITHUB_REF = 'refs/pull/123/merge';
    assert.deepEqual(resolveIssueScope(repoRoot), { pullRequest: '123' });

    process.env.GITHUB_REF = 'refs/heads/main';
    process.env.GITHUB_REF_NAME = 'candidate';
    assert.deepEqual(resolveIssueScope(repoRoot), { branch: 'candidate' });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('task-2525.03: scanner uses an environment SONAR_TOKEN for trusted CI runs', async () => {
  const { runSonar } = await import('../scripts/sonar-local.js');
  const previous = process.env.SONAR_TOKEN;
  let captured: { command: string, args: string[], token?: string } = { command: '', args: [] };

  process.env.SONAR_TOKEN = 'ci-environment-token';
  try {
    runSonar({
      spawn: ((command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
        captured = { command: String(command), args, token: options.env.SONAR_TOKEN };
        return { status: 0 } as ReturnType<typeof import('node:child_process').spawnSync>;
      }) as typeof import('node:child_process').spawnSync,
    });
  } finally {
    if (previous === undefined) delete process.env.SONAR_TOKEN;
    else process.env.SONAR_TOKEN = previous;
  }

  assert.equal(path.basename(captured.command), 'sonar-scanner-npm');
  assert.deepEqual(captured.args.slice(0, 3), [
    '-Dsonar.host.url=https://sonarcloud.io',
    '-Dsonar.organization=oxtan-maker',
    '-Dsonar.projectKey=parallix',
  ]);
  assert.equal(captured.token, 'ci-environment-token', 'trusted CI runs must pass the environment token to the scanner');
});
