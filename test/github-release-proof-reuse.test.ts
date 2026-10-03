import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const workflow = fs.readFileSync(path.join(import.meta.dirname, '..', '.github/workflows/ci-required.yml'), 'utf8');

function jobBody(name: string): string {
  const marker = `  ${name}:`;
  const start = workflow.indexOf(marker);
  assert.ok(start >= 0, `${name} job is present`);
  const remainder = workflow.slice(start + marker.length);
  const next = remainder.search(/\n  [A-Za-z][\w-]*:/);
  return workflow.slice(start, next < 0 ? undefined : start + marker.length + next);
}

test('task-2585: ci-required verifies PRs and main without reusable exact proof', () => {
  assert.match(workflow, /push:\n\s+branches:\n\s+- main\n\s+- 'github-publish\/\*\*'/);
  const required = jobBody('ci-required');
  assert.match(required, /github\.ref != 'refs\/heads\/main'/);
  assert.match(required, /needs\.publication-proof\.outputs\.verified == 'false'/);
  assert.match(required, /needs\.publication-proof\.result == 'success'/);
  assert.match(required, /always\(\) && !cancelled\(\)/);
  assert.match(required, /actions\/dependency-review-action/);
  assert.match(required, /npm run test:ci/);
  assert.match(required, /npm run coverage:merge/);
  assert.match(required, /npm run sonar/);
});

test('task-2585: main release depends on a least-privilege durable proof, not a second ci-required run', () => {
  const proof = jobBody('publication-proof');
  assert.match(proof, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(proof, /actions: read\n\s+contents: read/);
  assert.match(proof, /node scripts\/verify-github-publication-proof\.ts/);
  assert.match(proof, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(proof, /dependency-review-action|npm (ci|run test:ci|run coverage:merge|run sonar)|id-token: write|contents: write/);
  const release = jobBody('release');
  assert.match(release, /needs: \[publication-proof, ci-required\]/);
  assert.match(release, /outputs\.verified == 'true' && needs\.ci-required\.result == 'skipped'/);
  assert.match(release, /outputs\.verified == 'false' && needs\.ci-required\.result == 'success'/);
  assert.match(release, /needs\.publication-proof\.result == 'success'/);
  assert.match(release, /always\(\) && !cancelled\(\)/);
});

test('task-2585: workflow conditions preserve both release paths and block failed verification', () => {
  function enabled(job: string, event: string, ref: string, proofResult: string, verified: string, ciResult: string): boolean {
    const body = jobBody(job);
    const condition = body.match(/    if: >-\n([\s\S]*?)(?=\n    \w)/)?.[1];
    assert.ok(condition, 'folded job condition is present');
    const expression = condition.replace(/needs\.([\w-]+)/g, 'needs["$1"]');
    const evaluate = new Function('github', 'needs', 'always', 'cancelled', `return (${expression});`);
    return evaluate(
      { event_name: event, ref, event: { deleted: false } },
      { 'publication-proof': { result: proofResult, outputs: { verified } }, 'ci-required': { result: ciResult } },
      () => true, () => false,
    ) as boolean;
  }
  assert.equal(enabled('ci-required', 'pull_request', 'refs/pull/1/merge', 'skipped', '', 'skipped'), true);
  assert.equal(enabled('ci-required', 'push', 'refs/heads/github-publish/sha', 'skipped', '', 'skipped'), true);
  assert.equal(enabled('ci-required', 'push', 'refs/heads/main', 'success', 'true', 'skipped'), false);
  assert.equal(enabled('ci-required', 'push', 'refs/heads/main', 'success', 'false', 'skipped'), true);
  assert.equal(enabled('ci-required', 'push', 'refs/heads/main', 'failure', '', 'skipped'), false);
  assert.equal(enabled('release', 'push', 'refs/heads/main', 'success', 'true', 'skipped'), true);
  assert.equal(enabled('release', 'push', 'refs/heads/main', 'success', 'false', 'success'), true);
  for (const result of ['failure', 'cancelled', 'skipped']) {
    assert.equal(enabled('release', 'push', 'refs/heads/main', 'success', 'false', result), false);
  }
  assert.equal(enabled('release', 'push', 'refs/heads/main', 'failure', 'true', 'skipped'), false);
  assert.equal(enabled('release', 'pull_request', 'refs/pull/1/merge', 'skipped', '', 'success'), false);
});
