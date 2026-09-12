


import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const resolveArtifactDirModule = mockModule<typeof import('../src/adapters/review/review-artifacts.js')>('../src/adapters/review/review-artifacts.js', import.meta.url);
const __mm1 = mockModule<typeof import('../src/adapters/review/review-prompts.js')>('../src/adapters/review/review-prompts.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { resolveArtifactDir } = resolveArtifactDirModule;
const { WORKFLOW_AGENT_NAMES } = await import('../src/adapters/agents/agents.js');
const {
  PROMPT_ENTRYPOINTS,
  reviewEntrypoint,
  actOnReviewEntrypoint,
  buildReviewPrompt,
  buildActOnReviewPrompt,
  buildCompactReviewPrompt,
  buildCompactActOnReviewPrompt
} = __mm1;

test('PROMPT_ENTRYPOINTS covers all supported agent families', () => {
  // Sourced from the launcher registry so a newly added agent family cannot
  // ship without a review / act-on-review entrypoint (task-2362: qwen was
  // launchable but had no entrypoint, so every review launch failed).
  for (const agent of [...WORKFLOW_AGENT_NAMES, 'autonomous']) {
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

test('buildReviewPrompt renders the runtime review prompt for dry-run output', () => {
  const prompt = buildReviewPrompt({
    reviewer: 'codex',
    branch: 'mission/task-089',
    implementer: 'claude',
    focus: 'security',
    attempt: 2
  });

  assert.match(prompt, /Attempt: 2\. Focus: security\./);
  assert.match(prompt, /missions\/task-089\/MISSION\.md/);
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

test('buildActOnReviewPrompt renders the runtime act-on-review prompt for dry-run output', () => {
  const prompt = buildActOnReviewPrompt({
    implementer: 'claude',
    branch: 'mission/task-089',
    attempt: 3
  });

  assert.match(prompt, /You are the implementer agent family: `claude`\./);
  assert.match(prompt, /Attempt: 3\./);
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
  assert.match(prompt, /Focus: all\./);
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
  // task-2483 replaced the vague verification sentence with the machine-derived
  // already-executed controls block and its explicit do-not-re-run rule.
  assert.match(prompt, /which controls the workflow has already executed for this mission and which it has not/i);
  assert.match(prompt, /Do not re-run a listed command whose recorded status is `passed`/);
  assert.match(prompt, /Do not invoke `px` yourself/);
  const artifactDir = resolveArtifactDir(process.cwd());
  assert.ok(prompt.includes(`${artifactDir}/task-089-review-findings.md`));
  assert.ok(prompt.includes(`${artifactDir}/task-089-review-outcome.md`));
  assert.match(prompt, /Do not post to Forgejo directly/);
  assert.match(prompt, /final chat response does \*\*not\*\* submit a review/);
  assert.match(prompt, /create all three files/);
  assert.match(prompt, /No findings\.` when approving/);
  assert.match(prompt, /## F1: summary/);
  assert.match(prompt, /round-prefixed headings.*invalid/i);
  assert.match(prompt, /run `ls -l/);
  assert.doesNotMatch(prompt, /FORGEJO_USER=/);
  assert.doesNotMatch(prompt, /docs\/agent-prompts/);
});

test('buildCompactReviewPrompt enumerates separation-of-duties constraints keeping reviewer out of implementer mode (task-1325)', () => {
  const prompt = buildCompactReviewPrompt({
    reviewer: 'codex',
    branch: 'mission/task-089',
    implementer: 'claude',
    focus: 'all',
    attempt: 1
  });
  assert.match(prompt, /Separation of duties/i);
  assert.match(prompt, /reviewer, not the implementer/i);
  // The required "MUST NOT" categories: code edits, branch ops, PR/merge ops, workflow state.
  assert.match(prompt, /Edit, create, or delete any repo source/i);
  assert.match(prompt, /no rebase, squash, amend/i);
  assert.match(prompt, /no merge, push/i);
  assert.match(prompt, /Mutate workflow state/i);
  // The only permitted writes: artifact dir and /tmp.
  const artifactDir = resolveArtifactDir(process.cwd());
  assert.ok(prompt.includes(`Write to the artifact directory \`${artifactDir}\``));
  assert.match(prompt, /temporary diagnostic files under `\/tmp`/);
});

test('dry-run review builder preserves runtime separation-of-duties constraints', () => {
  const prompt = buildReviewPrompt({
    reviewer: 'codex',
    branch: 'mission/task-089',
    implementer: 'claude',
    focus: 'all',
    attempt: 1
  });
  assert.match(prompt, /Separation of duties/i);
  assert.match(prompt, /reviewer, not the implementer/i);
  assert.match(prompt, /Edit, create, or delete any repo source/i);
  assert.match(prompt, /no rebase, squash, amend/i);
  assert.match(prompt, /no merge, push/i);
  assert.match(prompt, /mutate workflow state/i);
  const artifactDir = resolveArtifactDir(process.cwd());
  assert.ok(prompt.includes(`Write to the artifact directory \`${artifactDir}\``));
  assert.match(prompt, /temporary diagnostic files under `\/tmp`/);
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

// task-1407: prompts diff against the snapshotted primary-branch SHA
// (reviewBaseline), not the live {{primaryBranch}} ref, so a concurrent
// mission merge mid-review doesn't surface as spurious diff noise.
test('buildCompactReviewPrompt substitutes {{reviewBaseline}} with the provided SHA and leaks no placeholder', () => {
  const prompt = buildCompactReviewPrompt({
    reviewer: 'codex',
    branch: 'mission/task-089',
    implementer: 'claude',
    focus: 'all',
    attempt: 1,
    repoRoot: '/tmp/project-task-089',
    reviewBaseline: 'abc1234deadbeef'
  });
  assert.match(prompt, /git diff abc1234deadbeef\.\.HEAD/);
  assert.doesNotMatch(prompt, /\{\{reviewBaseline\}\}/);
});

test('buildReviewPrompt substitutes {{reviewBaseline}} with the provided SHA and leaks no placeholder', () => {
  const prompt = buildReviewPrompt({
    reviewer: 'codex',
    branch: 'mission/task-089',
    implementer: 'claude',
    focus: 'all',
    attempt: 1,
    reviewBaseline: 'abc1234deadbeef'
  });
  assert.match(prompt, /git diff abc1234deadbeef\.\.HEAD/);
  assert.doesNotMatch(prompt, /\{\{reviewBaseline\}\}/);
});

test('dry-run builders produce the same prompts that real agent launches receive', () => {
  const reviewArgs = { reviewer: 'custom', branch: 'mission/task-9001', implementer: 'custom', attempt: 1, actualReviewer: 'custom', repoRoot: '/tmp/task-9001', reviewBaseline: 'baseline123' };
  assert.equal(buildReviewPrompt(reviewArgs), buildCompactReviewPrompt(reviewArgs));

  const actArgs = { implementer: 'custom', branch: 'mission/task-9001', attempt: 1, reviewOutcome: 'REQUEST_CHANGES', actualImplementer: 'custom', repoRoot: '/tmp/task-9001', reviewBaseline: 'baseline123' };
  assert.equal(buildActOnReviewPrompt(actArgs), buildCompactActOnReviewPrompt(actArgs));
});

test('review prompts instruct reviewers to ignore rebasing artifacts that are not mission changes (task-1430)', () => {
  const compactPrompt = buildCompactReviewPrompt({
    reviewer: 'codex',
    branch: 'mission/task-1430',
    implementer: 'claude',
    focus: 'all',
    attempt: 1
  });
  const verbosePrompt = buildReviewPrompt({
    reviewer: 'codex',
    branch: 'mission/task-1430',
    implementer: 'claude',
    focus: 'all',
    attempt: 1
  });

  for (const prompt of [compactPrompt, verbosePrompt]) {
    assert.match(prompt, /Rebasing Artifacts:/);
    assert.match(prompt, /will be resolved by parallix rebase/i);
    assert.match(prompt, /rebasing artifacts, not mission changes|not a mission change/i);
    assert.match(prompt, /branch stale-ness/i);
  }
});

test('review prompts distinguish committed checkpoint records from live diff output', () => {
  const compactPrompt = buildCompactReviewPrompt({
    reviewer: 'custom',
    branch: 'mission/task-9001',
    implementer: 'custom',
    attempt: 1
  });
  const verbosePrompt = buildReviewPrompt({
    reviewer: 'custom',
    branch: 'mission/task-9001',
    implementer: 'custom',
    attempt: 1
  });

  for (const prompt of [compactPrompt, verbosePrompt]) {
    assert.match(prompt, /record of the work at the time it was performed/i);
    assert.match(prompt, /git diff HEAD.*expected to be empty after a checkpoint is committed/i);
    assert.match(prompt, /materially false, unverifiable from the committed tree, or conceals a mission change/i);
  }
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

test('act-on-review prompts provide pushback text for rebasing artifacts (task-1430)', () => {
  const compactPrompt = buildCompactActOnReviewPrompt({
    implementer: 'codex',
    branch: 'mission/task-1430',
    attempt: 1
  });
  const verbosePrompt = buildActOnReviewPrompt({
    implementer: 'codex',
    branch: 'mission/task-1430',
    attempt: 1
  });

  for (const prompt of [compactPrompt, verbosePrompt]) {
    assert.match(prompt, /rebasing artifact caused by branch stale-ness/i);
    assert.match(prompt, /Not a mission change - will be resolved by parallix rebase\./);
  }
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

test('task-2337: review prompt exempts read-only px status from its px ban', () => {
  const prompt = buildCompactReviewPrompt({
    reviewer: 'codex',
    branch: 'mission/task-2337',
    implementer: 'custom',
    attempt: 5
  });

  assert.match(prompt, /`px status task-2337` is read-only and is the required way to load review history/);
  assert.match(prompt, /Do not call px directly[^\n]*except for the read-only `px status task-2337`/);
  for (const line of prompt.split('\n')) {
    if (!/\bpx\b/.test(line)) continue;
    if (!/(Do not|MUST NOT|never|Never)/.test(line)) continue;
    assert.match(line, /px status task-2337|px review task-2337|Forgejo/, `px prohibition without a px status carve-out: ${line}`);
  }
});
