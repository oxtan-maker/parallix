// TASK-2525.03 — focused configuration coverage for the shared
// coverage-plus-SonarQube command wired into the GitHub required workflow and
// the repository-owned pre-integration gate plan. Hermetic: reads repo config
// from disk and injects the scanner spawn; no Docker, no real SonarQube server,
// no committed token.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED_COMMAND = 'npm run test:coverage -- --threshold 0 --lcov && npm run sonar';

function escaped(source: string): RegExp {
  return new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

test('task-2525.03: GitHub workflow and pre-integration gate reference the same shared command', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci-required.yml'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'workflow.config.json'), 'utf8'));
  const preIntegration = config.adapters.gates.preIntegration as Array<{ key: string, command: string }>;

  // Both declarative call sites invoke the identical shared command.
  assert.match(workflow, escaped(SHARED_COMMAND), 'ci-required.yml must invoke the shared command');
  assert.ok(
    preIntegration.some((gate) => gate.command === SHARED_COMMAND),
    'workflow.config.json preIntegration must invoke the shared command',
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

  // One Cloud project for every branch (ADR 0060), and the gate rejects
  // new-code regressions.
  assert.match(props, /sonar\.projectKey=parallix/);
  assert.match(props, /sonar\.host\.url=https:\/\/sonarcloud\.io/);
  assert.match(props, /sonar\.organization=oxtan-maker/);
  assert.match(props, /sonar\.qualitygate\.wait=true/);

  // The shared command emits full LCOV without imposing the legacy aggregate
  // threshold. SonarQube owns the required 90% coverage condition for new
  // code, so the existing ~57% legacy baseline cannot mask a new regression.
  assert.equal(SHARED_COMMAND.includes('--threshold 0 --lcov'), true);

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
