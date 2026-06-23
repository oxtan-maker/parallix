const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PROMPT_ENTRYPOINTS,
  reviewEntrypoint,
  actOnReviewEntrypoint,
  buildReviewPrompt,
  buildActOnReviewPrompt,
  buildCompactReviewPrompt,
  buildCompactActOnReviewPrompt
} = require('../lib/review/review-prompts');
const { resolveArtifactDir } = require('../lib/review/review-artifacts');

test('PROMPT_ENTRYPOINTS covers all supported agent families', () => {
  for (const agent of ['codex', 'claude', 'mistral', 'qwen', 'autonomous']) {
    assert.ok(PROMPT_ENTRYPOINTS[agent], `missing entry for ${agent}`);
    assert.ok(PROMPT_ENTRYPOINTS[agent].review, `missing review entrypoint for ${agent}`);
    assert.ok(PROMPT_ENTRYPOINTS[agent].actOnReview, `missing actOnReview entrypoint for ${agent}`);
  }
});

test('reviewEntrypoint returns correct slash/dollar commands', () => {
  assert.equal(reviewEntrypoint('codex'), '$review all');
  assert.equal(reviewEntrypoint('claude'), '/review all');
});

test('actOnReviewEntrypoint returns correct commands', () => {
  assert.equal(actOnReviewEntrypoint('codex'), '$act-on-review');
  assert.equal(actOnReviewEntrypoint('claude'), '/act-on-review');
});

test('reviewEntrypoint throws for unknown agent', () => {
  assert.throws(() => reviewEntrypoint('unknown'), /unknown agent family/i);
});

test('actOnReviewEntrypoint throws for unknown agent', () => {
  assert.throws(() => actOnReviewEntrypoint('unknown'), /unknown agent family/i);
});

test('buildReviewPrompt includes branch, focus, and attempt with entrypoint', () => {
  const prompt = buildReviewPrompt({
    reviewer: 'codex',
    branch: 'mission/task-089',
    implementer: 'claude',
    focus: 'security',
    attempt: 2
  });

  assert.doesNotMatch(prompt, /reviewer agent family/);
  assert.doesNotMatch(prompt, /implementer agent family/);
  assert.match(prompt, /review attempt: `2`/);
  assert.match(prompt, /Requested review focus: `security`/);
  assert.match(prompt, /mission\/task-089/);
  assert.match(prompt, /\$review all/); // codex entrypoint
  // Artifact paths resolve to the same dir the consumer reads (task-1264).
  const artifactDir = resolveArtifactDir(process.cwd());
  assert.ok(prompt.includes(`${artifactDir}/task-089-review-findings.md`));
  assert.ok(prompt.includes(`${artifactDir}/task-089-review-outcome.md`));
  assert.ok(prompt.includes(`${artifactDir}/task-089-review-verdict.txt`));
});

test('buildReviewPrompt includes claude entrypoint for claude reviewer', () => {
  const prompt = buildReviewPrompt({
    reviewer: 'claude',
    branch: 'mission/task-001',
    implementer: 'codex',
    focus: 'all',
    attempt: 1
  });
  assert.match(prompt, /\/review all/);
});

test('buildActOnReviewPrompt includes implementer, branch, and attempt', () => {
  const prompt = buildActOnReviewPrompt({
    implementer: 'claude',
    branch: 'mission/task-089',
    attempt: 3
  });

  assert.match(prompt, /implementer agent family: `claude`/);
  assert.match(prompt, /review attempt response round: `3`/);
  assert.match(prompt, /mission\/task-089/);
  assert.match(prompt, /act-on-review/);
  assert.doesNotMatch(prompt, /docs\/agent-prompts/);
});

test('buildActOnReviewPrompt inlines disposition instructions without docs/agent-prompts indirection', () => {
  const prompt = buildActOnReviewPrompt({
    implementer: 'claude',
    branch: 'mission/task-001',
    attempt: 1
  });
  assert.doesNotMatch(prompt, /docs\/agent-prompts/);
  assert.doesNotMatch(prompt, /Canonical authority/);
  assert.match(prompt, /CHANGES_MADE\|PUSHBACK_ALL\|PARKED\|BLOCKED/);
});

test('buildReviewPrompt default focus is all', () => {
  const prompt = buildReviewPrompt({
    reviewer: 'codex',
    branch: 'mission/task-001',
    implementer: 'claude',
    attempt: 1
  });
  assert.match(prompt, /Requested review focus: `all`/);
});

// --- compact prompt tests ---

test('buildCompactReviewPrompt reads from template and substitutes all variables', () => {
  const prompt = buildCompactReviewPrompt({
    reviewer: 'codex',
    branch: 'mission/task-089',
    implementer: 'claude',
    focus: 'security',
    attempt: 2,
    repoRoot: '/tmp/project-task-089'
  });
  assert.ok(prompt.includes(`${resolveArtifactDir('/tmp/project-task-089')}/task-089-review-findings.md`));
  assert.match(prompt, /2/);            // attempt substituted
  assert.match(prompt, /security/);     // focus substituted
  assert.match(prompt, /\$review all/); // codex entrypoint substituted
  assert.match(prompt, /task-089/);     // slug substituted
  assert.match(prompt, /missions\/task-089/); // missionPath substituted
  assert.doesNotMatch(prompt, /\{\{/);  // no unresolved placeholders
  assert.doesNotMatch(prompt, /YYYY/);
  assert.doesNotMatch(prompt, /docs\/agent-prompts/);
  assert.doesNotMatch(prompt, /Reviewer:/);
  assert.doesNotMatch(prompt, /Implementer:/);
});

test('buildCompactReviewPrompt inlines the contract instead of redirecting to docs/agent-prompts', () => {
  const prompt = buildCompactReviewPrompt({
    reviewer: 'codex',
    branch: 'mission/task-089',
    implementer: 'claude',
    focus: 'all',
    attempt: 1
  });
  assert.match(prompt, /Entrypoint: \$review all/);
  assert.match(prompt, /px review task-089 --verify/);
  const artifactDir = resolveArtifactDir(process.cwd());
  assert.ok(prompt.includes(`${artifactDir}/task-089-review-findings.md`));
  assert.ok(prompt.includes(`${artifactDir}/task-089-review-outcome.md`));
  assert.match(prompt, /Do not post to Forgejo directly/);
  assert.doesNotMatch(prompt, /FORGEJO_USER=/);
  assert.doesNotMatch(prompt, /docs\/agent-prompts/);
});

test('buildCompactReviewPrompt substitutes missionPath and primaryBranch (no <primary-branch>)', () => {
  const prompt = buildCompactReviewPrompt({
    reviewer: 'codex',
    branch: 'mission/task-089',
    implementer: 'claude',
    focus: 'all',
    attempt: 1,
    repoRoot: '/tmp/project-task-089'
  });
  assert.match(prompt, /Mission: \/tmp\/project-task-089\/missions\/task-089\/MISSION\.md/);
  assert.doesNotMatch(prompt, /<primary-branch>/);
  assert.match(prompt, /git diff \w+\.\.HEAD/);
});


test('buildCompactActOnReviewPrompt reads from template and substitutes all variables', () => {
  const prompt = buildCompactActOnReviewPrompt({
    implementer: 'claude',
    branch: 'mission/task-089',
    attempt: 2,
    reviewOutcome: 'REQUEST_CHANGES',
    repoRoot: '/tmp/project-task-089'
  });
  assert.match(prompt, /mission\/task-089/);
  assert.match(prompt, /claude/);        // implementer substituted
  assert.match(prompt, /2/);             // attempt substituted
  assert.match(prompt, /Latest reviewer outcome was: REQUEST_CHANGES/);
  assert.match(prompt, /task-089/);      // slug substituted
  assert.match(prompt, /\/act-on-review/); // claude entrypoint substituted
  assert.match(prompt, /Read the review outcome and findings from `missions\/task-089\/review-events\//);
  assert.doesNotMatch(prompt, /px review [^\n]*--comments/); // standalone: no Forgejo CLI
  assert.ok(prompt.includes(`${resolveArtifactDir('/tmp/project-task-089')}/task-089-round-resolution.md`));
  assert.match(prompt, /CHANGES_MADE\|PUSHBACK_ALL\|PARKED\|BLOCKED/);
  assert.doesNotMatch(prompt, /\{\{/);   // no unresolved placeholders
  assert.doesNotMatch(prompt, /YYYY/);
  assert.doesNotMatch(prompt, /docs\/agent-prompts/);
});

test('buildCompactActOnReviewPrompt warns against no-op pushback when review is not approved and comments are empty', () => {
  const prompt = buildCompactActOnReviewPrompt({
    implementer: 'codex',
    branch: 'mission/task-121',
    attempt: 1,
    reviewOutcome: 'REQUEST_CHANGES'
  });
  assert.match(prompt, /REQUEST_CHANGES/);
  assert.match(prompt, /DO NOT post PUSHBACK_ALL/);
  assert.match(prompt, /cannot read the review outcome/);
  assert.match(prompt, /BLOCKED/);
});

test('buildCompactActOnReviewPrompt does not inline FORGEJO_USER and does not redirect to docs/agent-prompts', () => {
  const prompt = buildCompactActOnReviewPrompt({
    implementer: 'claude',
    branch: 'mission/task-089',
    attempt: 1
  });
  assert.doesNotMatch(prompt, /FORGEJO_USER=/);
  assert.doesNotMatch(prompt, /docs\/agent-prompts/);
});

test('buildCompactActOnReviewPrompt delegates artifact paths and consumes artifacts standalone', () => {
  const prompt = buildCompactActOnReviewPrompt({
    implementer: 'claude',
    branch: 'mission/task-089',
    attempt: 1
  });
  assert.match(prompt, /Entrypoint: \/act-on-review/);
  // Standalone mode: no Forgejo-specific CLI invocations (Success Criterion 5).
  assert.doesNotMatch(prompt, /px review [^\n]*--push/);
  assert.doesNotMatch(prompt, /px review [^\n]*--status/);
  assert.match(prompt, /standalone mode/);
  assert.match(prompt, /Do not post to Forgejo directly/);
});

test('buildCompactActOnReviewPrompt keeps the blocked safety warning inline', () => {
  const prompt = buildCompactActOnReviewPrompt({
    implementer: 'claude',
    branch: 'mission/task-089',
    attempt: 1
  });
  assert.match(prompt, /DO NOT post PUSHBACK_ALL/);
  assert.match(prompt, /Post BLOCKED instead/);
});



// task-1264: all four builders must substitute the resolved {{artifactDir}} so
// neither the loop nor the dry-run/manual path leaks a literal placeholder.
test('all four builders substitute {{artifactDir}} (no literal placeholder leaks)', () => {
  const reviewerArgs = { reviewer: 'claude', branch: 'mission/task-089', implementer: 'codex', attempt: 1, repoRoot: '/tmp/project-task-089' };
  const implArgs = { implementer: 'codex', branch: 'mission/task-089', attempt: 1, repoRoot: '/tmp/project-task-089' };
  for (const prompt of [
    buildReviewPrompt(reviewerArgs),
    buildCompactReviewPrompt(reviewerArgs),
    buildActOnReviewPrompt(implArgs),
    buildCompactActOnReviewPrompt(implArgs)
  ]) {
    assert.doesNotMatch(prompt, /\{\{artifactDir\}\}/);
    assert.doesNotMatch(prompt, /\{\{/); // no unresolved placeholder of any kind
  }
});

// task-1264 SC2: when adapters.review.tmpDir is configured, the prompt instructs
// the agent to write to that exact dir — the same dir the consumer reads from.
test('builders honor adapters.review.tmpDir so prompt path == consumer read path', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1264-cfg-'));
  const customDir = path.join(repoRoot, 'review-artifacts');
  fs.writeFileSync(
    path.join(repoRoot, 'workflow.config.json'),
    JSON.stringify({ adapters: { review: { tmpDir: customDir } } })
  );
  try {
    // The consumer resolves its read dir from the same function.
    assert.equal(resolveArtifactDir(repoRoot), customDir);

    const reviewPrompt = buildCompactReviewPrompt({ reviewer: 'claude', branch: 'mission/task-089', implementer: 'codex', attempt: 1, repoRoot });
    assert.ok(reviewPrompt.includes(`${customDir}/task-089-review-findings.md`), 'review prompt should point findings at the configured dir');
    assert.ok(reviewPrompt.includes(`${customDir}/task-089-review-verdict.txt`));

    const actPrompt = buildCompactActOnReviewPrompt({ implementer: 'codex', branch: 'mission/task-089', attempt: 1, repoRoot });
    assert.ok(actPrompt.includes(`${customDir}/task-089-round-resolution.md`), 'act-on-review prompt should point resolution at the configured dir');
    assert.ok(actPrompt.includes(`${customDir}/task-089-review-disposition.txt`));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
