// task-2465: each shipped stage prompt is split into a mandatory core half and
// an overridable default-opinion half; no-override assembly is byte-preserving,
// and configured overrides swap only the intended opinion half.
import test from 'node:test';
import { renderPromptContextPolicy } from '../../../../../src/application/prompt-context-policy.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FilesystemAssetStore } from '../../../../../src/adapters/assets/asset-store.js';
import { assembleStagePrompt } from '../../../../../src/adapters/assets/runtime-assets.js';
import { resolvePromptConfiguration, resolvePromptOverride, validateWorkflowConfig } from '../../../../../src/adapters/config/product-config.js';
import { buildDraftPrompt } from '../../../../../src/adapters/cli/commands/draft-prompts.js';
import { buildExecutePrompt } from '../../../../../src/adapters/cli/commands/active.js';
import { buildCompactReviewPrompt, buildCompactActOnReviewPrompt } from '../../../../../src/adapters/review/review-prompts.js';
import { mkdtemp as registeredMkdtemp } from '../../../../helpers/temp-dir.js';

const STAGES = ['draft', 'execute', 'review', 'act-on-review', 'portfolio'] as const;
const GRAPHIFY_GUIDANCE = 'Parallix updates existing Graphify graphs after successful squash integration on the receiving base worktree; review, edits and checkpoints do not trigger updates.';
const REVIEW_COVERAGE_GUIDANCE =
  'Do not run large batched test coverage commands that Parallix has already run or intentionally schedules for a later verification phase. Run a focused test only when it validates a specific review finding.';

function realRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(dir, 'package.json'))) {dir = path.dirname(dir);}
  return dir;
}

// Shipped prompt content, snapshotted at TASK-2465 into a committed fixture so
// the preservation check is hermetic (no git boundary) and runs in the default
// unit suite. The fixture locks the assembled baseline: a stage whose prompt is
// deliberately rewritten (TASK-2521.03 rewrote draft/execute/review/
// act-on-review) regenerates its entry from `assembleStagePrompt`, so the check
// keeps proving that core+opinion assembly reconstructs exactly what ships.
const PARENT_FIXTURE = JSON.parse(
  fs.readFileSync(path.join(realRepoRoot(), 'test', 'fixtures', 'prompt-split-parent.json'), 'utf8'),
) as Record<string, string>;

function parentPrompt(stage: string): string {
  const parent = PARENT_FIXTURE[stage];
  assert.ok(parent, `parent-commit fixture missing for stage ${stage}`);
  const sourceAwareDraft = stage === 'draft'
    ? parent
      .replace('Backlog task: {{taskPath}}', '{{intentSourceLine}}')
      .replace("The harness has already created the mission branch, worktree, mission record, and backlog task. Your job is to turn the user's intent from `{{taskPath}}` into a complete mission record. There is no mission document to write; every fact below is recorded with a command.", '{{intakeInstructions}}')
      .replace('- preserve `{{taskPath}}`: update content as needed but do not delete, rename, or move the file\n- do not edit the backlog `assignee` field; the workflow records ownership itself', '{{providerInstructions}}')
      .replace('- this section applies only when the backlog task at `{{taskPath}}` carries a `bug` label (in addition to its `ai_sdlc` or `user_value` classification). If there is no `bug` label, ignore this section entirely.', '{{bugApplicability}}')
      .replace('- the harness will transition the task to `ready` after a clean draft; do not transition it yourself', '{{completionTransitionInstruction}}')
    : parent;
  const normalized = stage === 'review'
    ? `${parent.replace(
      'Do not run any large test gates, thats run automatically by parallix at suitable steps and is not your job. Specific test to validate a code finding is ok.',
      REVIEW_COVERAGE_GUIDANCE,
    ).replace(
      "- When `{{attempt}}` is 2 or later, before beginning this review round compact the prior-round working context. Reload the locked mission goal and scope; committed checkpoint or gate evidence when present; current round and disposition; unresolved findings and implementer resolutions; and the exact post-rebase revision and review baseline shown by `git diff {{reviewBaseline}}..HEAD`. This compaction is independent of the mission's declared gates.",
      "- When `{{attempt}}` is 2 or later, before beginning this review round reload the locked mission goal and scope; committed checkpoint or gate evidence when present; current round and disposition; unresolved findings and implementer resolutions; and the exact post-rebase revision and review baseline shown by `git diff {{reviewBaseline}}..HEAD`. This reload is independent of the mission's declared gates.",
    )}\n`
    : sourceAwareDraft;
  return normalized
    .replace('Do not refresh Graphify after drafting; freshness is maintained at the autonomous-review boundary on the final verified tree.', GRAPHIFY_GUIDANCE)
    .replace('Graph freshness is handled at the autonomous-review boundary, after its final verification and immediately before reviewer launch; do not refresh after ordinary edits.', GRAPHIFY_GUIDANCE)
    .replace('Do not refresh Graphify after ordinary edits: the next autonomous-review boundary refreshes the final verified tree immediately before reviewer launch.', GRAPHIFY_GUIDANCE);
}

// The parent fixture still owns the mandatory split baseline. This repository's
// draft, execute and review opinions are now deliberately newer than that
// baseline: draft and execute carry their existing-owner policies, while review
// carries the local counterexample policy and retains the prior coverage guidance. This
// source-owner suite must expect those checked-in opinions without weakening
// the byte-for-byte reconstruction check for the mandatory core.
function expectedSourcePrompt(stage: string): string {
  const parent = parentPrompt(stage);
  if (stage === 'draft' || stage === 'execute') {
    const repositoryOpinion = fs.readFileSync(path.join(realRepoRoot(), 'prompts', `${stage}.md`), 'utf8');
    const retainedPolicy = stage === 'draft'
      ? /Before defining the Mission's implementation scope, investigate whether the requested behavior already exists/
      : /<existing_owner_first>/;
    assert.match(repositoryOpinion, retainedPolicy, `repository ${stage} opinion must retain the existing-owner policy`);
    return `${parent.replace(/\n+$/, '')}\n\n${repositoryOpinion.replace(/^\n+/, '')}`;
  }
  if (stage !== 'review') {return parent;}
  const repositoryOpinion = fs.readFileSync(path.join(realRepoRoot(), 'prompts', 'review.md'), 'utf8');
  assert.ok(repositoryOpinion.includes(REVIEW_COVERAGE_GUIDANCE), 'repository review opinion must retain the prior coverage guidance');
  return parent.replace(REVIEW_COVERAGE_GUIDANCE, repositoryOpinion.trimEnd());
}

test('Graphify guidance limits automatic updates to landed merges (TASK-2725)', () => {
  const files = [
    'templates/AGENTS.md.template',
    'prompts/execute-core.md',
    'prompts/act-on-review.md',
    'prompts/draft-core.md',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(realRepoRoot(), file), 'utf8');
    assert.doesNotMatch(source, /After (?:code edits|modifying code|drafting), run `graphify update \.`/, `${file} must not prescribe edit-triggered Graphify refreshes`);
    assert.match(source, /after successful squash integration on the receiving base worktree/, `${file} must describe post-merge updates`);
    assert.doesNotMatch(source, /autonomous.review.*refresh|freshness.*boundary/i);
  }
});
function nonBlank(s: string): string[] { return s.split('\n').filter(l => l.trim().length > 0); }
function counts(lines: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) {m.set(l, (m.get(l) || 0) + 1);}
  return m;
}
function multisetEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) {return false;}
  for (const [k, v] of a) {if ((b.get(k) || 0) !== v) {return false;}}
  return true;
}

// --- preservation: core + source opinion (minus the one added heading) equals
// the authorized source prompt as a non-blank-line multiset, for every stage. ---

for (const [i, stage] of STAGES.entries()) {
  test(`task-2465-${i}: ${stage} core+opinion preserves the authorized source prompt as a non-blank multiset`, () => {
    const core = renderPromptContextPolicy(fs.readFileSync(path.join(realRepoRoot(), 'prompts', `${stage}-core.md`), 'utf8'));
    const def = fs.readFileSync(path.join(realRepoRoot(), 'prompts', `${stage}.md`), 'utf8');
    const heading = core.split('\n')[0];
    assert.ok(heading && heading.startsWith('#'), `${stage} core file must begin with a file-naming heading`);
    const got = counts([...nonBlank(core).filter(l => l !== heading), ...nonBlank(def)]);
    const want = counts(nonBlank(expectedSourcePrompt(stage)));
    assert.ok(multisetEqual(got, want), `${stage}: core+opinion non-blank multiset must equal the authorized source prompt`);
    // Repository-local additions belong in the opinion; the added heading is
    // still the only core line that is not in the parent baseline.
    const extra = nonBlank(core).filter(l => !nonBlank(parentPrompt(stage)).includes(l));
    assert.deepEqual(extra, [heading], `${stage}: only the added heading may be new`);
  });
}

// --- launch equivalence: each wired launch point assembles BOTH halves and
// substitutes every placeholder, so the assembled prompt keeps every original
// non-placeholder line of the pre-split prompt (task-2465 success criterion 3). ---

// Every non-placeholder line of the parent must survive the launch IN ORDER.
// An ordered-subsequence check (not an unordered set-membership check) catches a
// half that was reordered or a list split mid-way: a bullet moved to another
// section lands out of order relative to its sibling lines. No literal
// placeholder may leak, and the added core heading must not leak either.
function assertLaunchKeepsEveryLine(stage: string, launch: string) {
  const expected = expectedSourcePrompt(stage);
  assert.doesNotMatch(launch, /\{\{/, `${stage}: unsubstituted placeholder leaked at launch`);
  // The split appends a `# <filename>` heading to each core; it must not leak
  // into the assembled launch output (a regression the split introduced).
  assert.doesNotMatch(launch, /^#/, `${stage}: added core heading leaked at launch`);
  assert.ok(isOrderedSubsequence(nonPlaceholderSeq(expected), nonPlaceholderSeq(launch)),
    `${stage}: launch reordered or dropped source-prompt lines (order not preserved)`);
}

// Non-placeholder lines in order (placeholder lines carry `{{...}}` and are
// substituted at launch, so they are excluded from the order comparison).
function nonPlaceholderSeq(s: string): string[] {
  return s.split('\n').filter(l => !/\{\{/.test(l) && l.trim().length > 0);
}
function isOrderedSubsequence(sub: string[], full: string[]): boolean {
  let i = 0;
  for (const x of full) {if (i < sub.length && sub[i] === x) {i++;}}
  return i === sub.length;
}

test('task-2465-draft launch point preserves every pre-split line (no override)', () => {
  assertLaunchKeepsEveryLine('draft', buildDraftPrompt('task-2465'));
});

test('task-2465-execute launch point preserves every pre-split line (no override)', () => {
  assertLaunchKeepsEveryLine('execute', buildExecutePrompt('task-2465', 'checkpoint context', { rootDir: realRepoRoot() }));
});

test('task-2465-review launch point preserves every authorized source line with repository policy', () => {
  assertLaunchKeepsEveryLine('review', buildCompactReviewPrompt({ reviewer: 'codex', branch: 'mission/task-2465', implementer: 'claude', attempt: 1, repoRoot: realRepoRoot() }));
});

test('task-2465-act-on-review launch point preserves every source line under real repository configuration', () => {
  assertLaunchKeepsEveryLine('act-on-review', buildCompactActOnReviewPrompt({ implementer: 'claude', branch: 'mission/task-2465', attempt: 1, repoRoot: realRepoRoot() }));
});

test('repository review policy is confined to review while every other opinion remains intact (PX-0046.02 F2)', () => {
  const root = realRepoRoot();
  const counterexamplePolicy = 'Before a general audit of mission paperwork, perform a short counterexample pass over the changed behavior.';
  const configuration = resolvePromptConfiguration(root);
  assert.equal(configuration.overridePath, null, 'the repository must not select the legacy all-stage override');
  assert.equal(configuration.reviewOverridePath, path.join(root, 'prompts', 'review.md'));

  const prompts = new Map<string, string>([
    ['draft', buildDraftPrompt('task-2465', { rootDir: root })],
    ['execute', buildExecutePrompt('task-2465', 'checkpoint context', { rootDir: root })],
    ['review', buildCompactReviewPrompt({ reviewer: 'codex', branch: 'mission/task-2465', implementer: 'claude', attempt: 1, repoRoot: root })],
    ['act-on-review', buildCompactActOnReviewPrompt({ implementer: 'claude', branch: 'mission/task-2465', attempt: 1, repoRoot: root })],
    ['portfolio', assembleStagePrompt('portfolio', configuration)],
  ]);

  for (const [stage, prompt] of prompts) {
    const count = prompt.split(counterexamplePolicy).length - 1;
    assert.equal(count, stage === 'review' ? 1 : 0, `${stage} must receive the repository review policy ${stage === 'review' ? 'once' : 'never'}`);
  }
  assert.match(prompts.get('execute') || '', /<existing_owner_first>/, 'execute must retain the repository existing-owner policy');
  assert.match(prompts.get('draft') || '', /Before defining the Mission's implementation scope, investigate whether the requested behavior already exists/, 'draft must retain the repository existing-owner policy');
  assert.match(prompts.get('act-on-review') || '', new RegExp(GRAPHIFY_GUIDANCE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompts.get('portfolio') || '', /Graphify-first/);
});

test('review-only opinion takes precedence for review and is ignored by other stages (PX-0046.02 F2)', () => {
  const root = registeredMkdtemp('px-0046-review-override-precedence-');
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { prompts: { override: 'all.md', reviewOverride: 'review.md' } },
    }));
    fs.writeFileSync(path.join(root, 'all.md'), 'GLOBAL-OPINION-PX-0046\n');
    fs.writeFileSync(path.join(root, 'review.md'), 'REVIEW-ONLY-OPINION-PX-0046\n');
    const configuration = resolvePromptConfiguration(root);
    const review = assembleStagePrompt('review', configuration);
    const actOnReview = assembleStagePrompt('act-on-review', configuration);

    assert.match(review, /REVIEW-ONLY-OPINION-PX-0046/);
    assert.doesNotMatch(review, /GLOBAL-OPINION-PX-0046/);
    assert.match(actOnReview, /GLOBAL-OPINION-PX-0046/);
    assert.doesNotMatch(actOnReview, /REVIEW-ONLY-OPINION-PX-0046/);

    fs.rmSync(path.join(root, 'review.md'));
    assert.doesNotThrow(() => assembleStagePrompt('act-on-review', configuration), 'a missing review-only file is irrelevant outside review');
    assert.throws(() => assembleStagePrompt('review', configuration), /configured but the file is missing/, 'review must fail closed when its selected opinion disappears');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- assembly reconstruction: no-override assembly must rebuild the
// pre-split prompt. Every stage assembles core+opinion in parent order; interior
// blank-line runs collapse to one so a removed blank still fails (it merges two
// blocks) and an added blank is tolerated. This is the concatenation-path check
// that catches a list split (a bullet under the wrong heading), a removed
// interior blank line (two blocks merge), and swapped core/opinion halves. ---

function normalizeBlankRuns(s: string): string {
  return s.replace(/\n{2,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

for (const [i, stage] of STAGES.entries()) {
  test(`task-2465-assembly-${i}: ${stage} no-override assembly rebuilds the authorized source prompt`, () => {
    const assembled = assembleStagePrompt(stage, {});
    assert.equal(assembled, expectedSourcePrompt(stage),
      `${stage}: no-override assembly must be byte-identical to the authorized source prompt`);
    // Every stage assembles core+opinion in parent order; interior blank-line
    // runs collapse to one so a removed blank still fails (it merges two
    // blocks) and an added blank is tolerated. An ordered comparison catches a
    // list split (a bullet under the wrong heading) and a dropped/added line.
    assert.equal(normalizeBlankRuns(assembled), normalizeBlankRuns(expectedSourcePrompt(stage)),
      `${stage}: no-override assembly must rebuild the authorized source prompt`);
  });
}

// --- missing override (F4): a configured override path that points at a
// missing file is a configuration error, not a silently-ignored no-op. ---

test('task-2465: a configured override whose file is missing surfaces a config error', () => {
  const root = registeredMkdtemp('task-2465-missing-override-');
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { prompts: { override: 'does-not-exist.md' } },
    }));
    const overridePath = resolvePromptOverride(root);
    assert.ok(overridePath, 'override path should still resolve from config');
    assert.throws(
      () => assembleStagePrompt('review', { overridePath }),
      /configured but the file is missing/,
      'a missing configured override must throw, not be silently ignored',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- override retention: the single key supplies opinion content; core is
// always assembled in and cannot be dropped by an override. The review stage
// additionally retains its shipped verification guidance before the override.

test('task-2465: configured override supplies opinion content and retains a named core instruction', () => {
  const root = registeredMkdtemp('task-2465-override-');
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { prompts: { override: 'repo-opinion.md' } },
    }));
    fs.writeFileSync(path.join(root, 'repo-opinion.md'), 'REPO-LOCAL-OPINION-PLACEHOLDER-4242\n');
    const assembled = assembleStagePrompt('review', { overridePath: resolvePromptOverride(root) });
    assert.ok(assembled.includes('REPO-LOCAL-OPINION-PLACEHOLDER-4242'), 'override opinion content must be present');
    assert.ok(assembled.includes('Separation of duties — you are the reviewer, not the implementer'), 'a named core instruction must survive the override');
    assert.ok(assembled.includes('Mode: review.'), 'the mandatory core header must survive the override');
    assert.equal(resolvePromptOverride(root), path.join(root, 'repo-opinion.md'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task-2602: runtime review prompt retains non-core coverage guidance with the shipped asset and configured override', () => {
  const root = registeredMkdtemp('task-2602-review-prompt-');
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { prompts: { override: 'repo-opinion.md' } },
    }));
    fs.writeFileSync(path.join(root, 'repo-opinion.md'), 'REPO-LOCAL-OPINION-PLACEHOLDER-2602\n');

    const defaultPrompt = buildCompactReviewPrompt({
      reviewer: 'codex', branch: 'mission/task-2602', implementer: 'claude', attempt: 1,
    });
    const overriddenPrompt = buildCompactReviewPrompt({
      reviewer: 'codex', branch: 'mission/task-2602', implementer: 'claude', attempt: 1, repoRoot: root,
    });

    assert.ok(defaultPrompt.includes(REVIEW_COVERAGE_GUIDANCE));
    assert.ok(overriddenPrompt.includes(REVIEW_COVERAGE_GUIDANCE));
    assert.match(overriddenPrompt, /REPO-LOCAL-OPINION-PLACEHOLDER-2602/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task-2465: override cannot drop core resolution instructions when the repo opinion omits them', () => {
  const root = registeredMkdtemp('task-2465-core-drop-');
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { prompts: { override: 'minimal.md' } },
    }));
    // A deliberately thin override that contains no core instruction at all.
    fs.writeFileSync(path.join(root, 'minimal.md'), 'just my taste\n');
    const assembled = assembleStagePrompt('act-on-review', { overridePath: resolvePromptOverride(root) });
    assert.ok(assembled.includes('just my taste'));
    assert.ok(assembled.includes('px resolve --slug {{slug}}'), 'the core resolution command must survive');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- config boundary: the closed opinion keys are typed; unknown keys beneath
// adapters.prompts fail through the existing configuration-error path. ---

test('task-2465: prompt opinion overrides are accepted; unknown keys beneath them are rejected', () => {
  assert.deepEqual(validateWorkflowConfig({ adapters: { prompts: { override: 'prompts/override.md' } } }), []);
  assert.deepEqual(validateWorkflowConfig({ adapters: { prompts: { reviewOverride: 'prompts/review.md' } } }), []);
  assert.deepEqual(validateWorkflowConfig({ adapters: {} }), []);
  assert.notDeepEqual(validateWorkflowConfig({ adapters: { prompts: { unknownKey: true } } }), []);
  assert.notDeepEqual(validateWorkflowConfig({ adapters: { prompts: { override: 5 } } }), []);
  assert.notDeepEqual(validateWorkflowConfig({ adapters: { prompts: { reviewOverride: 5 } } }), []);
  // No arbitrary per-stage keys: reviewOverride is the one review-only boundary.
  assert.notDeepEqual(validateWorkflowConfig({ adapters: { prompts: { draftOverride: 'x' } } }), []);
});


test('draft-core changes require a matching preservation fixture (TASK-2712)', () => {
  const root = registeredMkdtemp('prompt-fixture-consistency-');
  try {
    fs.mkdirSync(path.join(root, 'prompts'));
    const core = fs.readFileSync(path.join(realRepoRoot(), 'prompts/draft-core.md'), 'utf8');
    const opinion = fs.readFileSync(path.join(realRepoRoot(), 'prompts/draft.md'), 'utf8');
    fs.writeFileSync(path.join(root, 'prompts/draft-core.md'), core.replace('Mode: draft.', 'Mode: draft.\nKeep the introducing mission accountable.'));
    fs.writeFileSync(path.join(root, 'prompts/draft.md'), opinion);
    const assembled = assembleStagePrompt('draft', { assets: new FilesystemAssetStore(root) });
    assert.notEqual(assembled, expectedSourcePrompt('draft'), 'the unchanged fixture rejects new core guidance');
    assert.equal(multisetEqual(counts(nonBlank(assembled)), counts(nonBlank(expectedSourcePrompt('draft')))), false);
    const matching = expectedSourcePrompt('draft').replace('Mode: draft.', 'Mode: draft.\nKeep the introducing mission accountable.');
    assert.equal(assembled, matching, 'a matching fixture preserves byte-identical assembly');
    assert.ok(multisetEqual(counts(nonBlank(assembled)), counts(nonBlank(matching))));
    assert.ok(isOrderedSubsequence(nonPlaceholderSeq(matching), nonPlaceholderSeq(assembled)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('execute core requires readiness and an operator stop for recorded contract blockers (TASK-2713)', () => {
  const core = fs.readFileSync(path.join(realRepoRoot(), 'prompts/execute-core.md'), 'utf8');
  assert.match(core, /Before declaring completion, run `px checkpoint check --slug {{slug}} --json`/);
  assert.match(core, /primary stop reason even when evidence is incomplete/);
  assert.match(core, /without fabricated evidence or repeated evidence-only repair/);
  assert.match(core, /only an explicit operator decision can clear the recorded blocker/);
});
