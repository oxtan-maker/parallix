// task-2465: each shipped stage prompt is split into a mandatory core half and
// an overridable default-opinion half; no-override assembly is byte-preserving,
// and the single `adapters.prompts.override` key swaps only the opinion half.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleStagePrompt } from '../src/adapters/assets/runtime-assets.js';
import { resolvePromptOverride, validateWorkflowConfig } from '../src/adapters/config/product-config.js';
import { buildDraftPrompt } from '../src/adapters/cli/commands/draft-prompts.js';
import { buildExecutePrompt } from '../src/adapters/cli/commands/active.js';
import { buildCompactReviewPrompt, buildCompactActOnReviewPrompt } from '../src/adapters/review/review-prompts.js';

const STAGES = ['draft', 'execute', 'review', 'act-on-review', 'portfolio'] as const;

function realRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(dir, 'package.json'))) {dir = path.dirname(dir);}
  return dir;
}

// Parent-commit (pre-split) prompt content, snapshotted at TASK-2465 into a
// committed fixture so the preservation check is hermetic (no git boundary) and
// runs in the default unit suite. The fixture locks the parent baseline.
const PARENT_FIXTURE = JSON.parse(
  fs.readFileSync(path.join(realRepoRoot(), 'test', 'fixtures', 'prompt-split-parent.json'), 'utf8'),
) as Record<string, string>;

function parentPrompt(stage: string): string {
  const parent = PARENT_FIXTURE[stage];
  assert.ok(parent, `parent-commit fixture missing for stage ${stage}`);
  return parent;
}
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

// --- preservation: core + default (minus the one added heading) equals the
// parent-commit prompt as a non-blank-line multiset, for every stage. ---

for (const [i, stage] of STAGES.entries()) {
  test(`task-2465-${i}: ${stage} core+default preserves the parent-commit prompt as a non-blank multiset`, () => {
    const core = fs.readFileSync(path.join(realRepoRoot(), 'prompts', `${stage}-core.md`), 'utf8');
    const def = fs.readFileSync(path.join(realRepoRoot(), 'prompts', `${stage}.md`), 'utf8');
    const heading = core.split('\n')[0];
    assert.ok(heading && heading.startsWith('#'), `${stage} core file must begin with a file-naming heading`);
    const got = counts([...nonBlank(core).filter(l => l !== heading), ...nonBlank(def)]);
    const want = counts(nonBlank(parentPrompt(stage)));
    assert.ok(multisetEqual(got, want), `${stage}: core+default non-blank multiset must equal parent-commit multiset`);
    // The added heading is the only line in core that is not in the parent.
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
  const parent = parentPrompt(stage);
  assert.doesNotMatch(launch, /\{\{/, `${stage}: unsubstituted placeholder leaked at launch`);
  // The split appends a `# <filename>` heading to each core; it must not leak
  // into the assembled launch output (a regression the split introduced).
  assert.doesNotMatch(launch, /^#/, `${stage}: added core heading leaked at launch`);
  assert.ok(isOrderedSubsequence(nonPlaceholderSeq(parent), nonPlaceholderSeq(launch)),
    `${stage}: launch reordered or dropped pre-split lines (parent order not preserved)`);
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

test('task-2465-review launch point preserves every pre-split line (no override)', () => {
  assertLaunchKeepsEveryLine('review', buildCompactReviewPrompt({ reviewer: 'codex', branch: 'mission/task-2465', implementer: 'claude', attempt: 1 }));
});

test('task-2465-act-on-review launch point preserves every pre-split line (no override)', () => {
  assertLaunchKeepsEveryLine('act-on-review', buildCompactActOnReviewPrompt({ implementer: 'claude', branch: 'mission/task-2465', attempt: 1 }));
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
  test(`task-2465-assembly-${i}: ${stage} no-override assembly rebuilds the parent-commit prompt`, () => {
    const assembled = assembleStagePrompt(stage, {});
    assert.equal(assembled, parentPrompt(stage),
      `${stage}: no-override assembly must be byte-identical to the parent-commit prompt`);
    // Every stage assembles core+opinion in parent order; interior blank-line
    // runs collapse to one so a removed blank still fails (it merges two
    // blocks) and an added blank is tolerated. An ordered comparison catches a
    // list split (a bullet under the wrong heading) and a dropped/added line.
    assert.equal(normalizeBlankRuns(assembled), normalizeBlankRuns(parentPrompt(stage)),
      `${stage}: no-override assembly must rebuild the parent-commit prompt`);
  });
}

// --- missing override (F4): a configured override path that points at a
// missing file is a configuration error, not a silently-ignored no-op. ---

test('task-2465: a configured override whose file is missing surfaces a config error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2465-missing-override-'));
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

// --- override retention: the single key swaps only the opinion half; core is
// always assembled in and cannot be dropped by an override. ---

test('task-2465: configured override replaces opinion content but retains a named core instruction', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2465-override-'));
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

test('task-2465: override cannot drop core even when the repo opinion omits it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2465-core-drop-'));
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { prompts: { override: 'minimal.md' } },
    }));
    // A deliberately thin override that contains no core instruction at all.
    fs.writeFileSync(path.join(root, 'minimal.md'), 'just my taste\n');
    const assembled = assembleStagePrompt('act-on-review', { overridePath: resolvePromptOverride(root) });
    assert.ok(assembled.includes('just my taste'));
    assert.ok(assembled.includes('CHANGES_MADE|PUSHBACK_ALL|PARKED|BLOCKED'), 'parser-visible disposition token (core) must survive');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- config boundary: exactly one new key; unknown keys beneath it fail through
// the existing configuration-error path. ---

test('task-2465: adapters.prompts.override is accepted; unknown keys beneath it are rejected', () => {
  assert.deepEqual(validateWorkflowConfig({ adapters: { prompts: { override: 'prompts/override.md' } } }), []);
  assert.deepEqual(validateWorkflowConfig({ adapters: {} }), []);
  assert.notDeepEqual(validateWorkflowConfig({ adapters: { prompts: { unknownKey: true } } }), []);
  assert.notDeepEqual(validateWorkflowConfig({ adapters: { prompts: { override: 5 } } }), []);
  // No per-stage keys: only the single adapters.prompts surface exists.
  assert.notDeepEqual(validateWorkflowConfig({ adapters: { prompts: { draftOverride: 'x' } } }), []);
});
