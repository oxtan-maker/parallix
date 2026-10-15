import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const workflow = fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'ci-required.yml'), 'utf8');

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
  function enabled(job: string, event: string, ref: string, proofResult: string, verified: string, ciResult: string, eligible = 'true'): boolean {
    const body = jobBody(job);
    const condition = body.match(/    if: >-\n([\s\S]*?)(?=\n    \w)/)?.[1];
    assert.ok(condition, 'folded job condition is present');
    const expression = condition.replace(/needs\.([\w-]+)/g, 'needs["$1"]');
    const evaluate = new Function('github', 'needs', 'always', 'cancelled', `return (${expression});`);
    return evaluate(
      { event_name: event, ref, event: { deleted: false } },
      { 'publication-proof': { result: proofResult, outputs: { verified, eligible } }, 'ci-required': { result: ciResult } },
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
  assert.equal(enabled('release', 'push', 'refs/heads/main', 'success', 'false', 'success', 'false'), false);
  assert.equal(enabled('release', 'push', 'refs/heads/main', 'success', 'true', 'skipped', 'false'), false);
  assert.equal(enabled('release', 'push', 'refs/heads/main', 'success', 'false', 'success', ''), false);
  for (const eligible of ['false', '']) {
    assert.equal(enabled('ci-required', 'push', 'refs/heads/main', 'success', 'false', 'skipped', eligible), true, 'provenance failure cannot suppress verification');
    assert.equal(enabled('release', 'push', 'refs/heads/main', 'success', 'true', 'skipped', eligible), false, 'even reusable proof cannot override missing provenance');
  }
  for (const result of ['failure', 'cancelled', 'skipped']) {
    assert.equal(enabled('release', 'push', 'refs/heads/main', 'success', 'false', result), false);
  }
  assert.equal(enabled('release', 'push', 'refs/heads/main', 'failure', 'true', 'skipped'), false);
  assert.equal(enabled('release', 'pull_request', 'refs/pull/1/merge', 'skipped', '', 'success'), false);
});


test('Dependabot main merges skip release by PR author even when a human merges (TASK-2676)', async () => {
  const { isGithubReleaseEligible } = await import('../../../scripts/github-release-policy.js');
  const pr = { merged_at: '2026-09-26T11:16:24Z', merge_commit_sha: 'merged-sha',
    user: { login: 'dependabot[bot]' }, base: { ref: 'main', repo: { full_name: 'owner/repo' } } };
  const check = (data: unknown) => isGithubReleaseEligible({ repository: 'owner/repo', sha: 'merged-sha', request: async () => data });
  assert.equal(await check([pr]), false);
  assert.equal(await check([{ ...pr, user: { login: 'human' } }]), true);
  assert.equal(await check([{ ...pr, merged_at: null }]), true);
  assert.equal(await check([{ ...pr, merge_commit_sha: 'earlier-sha' }]), true);
  assert.equal(await check([]), true, 'ordinary publication tips remain eligible');
  await assert.rejects(check({}), /invalid pull-request data/);
  await assert.rejects(check([{}]), /incomplete pull-request provenance/);
  await assert.rejects(isGithubReleaseEligible({ repository: 'owner/repo', sha: 'merged-sha', request: async () => { throw new Error('API unavailable'); } }), /API unavailable/);
  const calls: string[] = [];
  assert.equal(await isGithubReleaseEligible({ repository: 'owner/repo', sha: 'merged-sha', request: async (url) => {
    calls.push(url);
    return calls.length === 1 ? Array.from({ length: 100 }, () => ({ ...pr, merged_at: null })) : [pr];
  } }), false);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /page=2$/);
  const policy = jobBody('publication-proof');
  assert.match(policy, /pull-requests: read/);
  assert.match(policy, /node scripts\/github-release-policy\.ts/);
  assert.doesNotMatch(policy, /id-token: write|contents: write/);
  assert.doesNotMatch(workflow, /^  release-policy:/m);
  assert.doesNotMatch(jobBody('ci-required'), /github-release-policy|outputs\.eligible/);
  assert.match(policy, /id: policy[\s\S]*?continue-on-error: true[\s\S]*?run: node scripts\/github-release-policy\.ts/);
  assert.match(policy, /eligible: \$\{\{ steps\.policy\.outcome == 'success' && steps\.policy\.outputs\.eligible \|\| 'false' \}\}/);
  assert.doesNotMatch(policy.slice(0, policy.indexOf('id: policy')), /continue-on-error/);
  const output = policy.match(/eligible: \$\{\{ (.+) \}\}/)?.[1];
  assert.ok(output, 'release eligibility output is present');
  const eligibility = new Function('steps', `return (${output});`);
  assert.equal(eligibility({ policy: { outcome: 'success', outputs: { eligible: 'true' } } }), 'true');
  for (const outcome of ['failure', 'cancelled', 'skipped']) {
    assert.equal(eligibility({ policy: { outcome, outputs: { eligible: 'true' } } }), 'false', 'a failed lookup cannot authorize publication');
  }
  assert.equal(eligibility({ policy: { outcome: 'success', outputs: {} } }), 'false');
  assert.equal(eligibility({ policy: { outcome: 'success', outputs: { eligible: 'false' } } }), 'false');

});
