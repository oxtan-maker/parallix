// task-2483: the review prompt carries a machine-derived "already-executed
// controls" block so a reviewer does not re-run gates the workflow already ran.
// Every assertion here pins a mission success criterion (SC2-SC7).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCompletedControlsBlock,
  buildCompactReviewPrompt,
  COMPLETED_CONTROLS_MAX_CHARS,
  COMPLETED_CONTROLS_MAX_LINES,
} from '../src/adapters/review/review-prompts.js';

type Fixture = { repoRoot: string; missionPath: string };

function makeFixture(options: {
  gateResult?: unknown;
  gates?: unknown;
  missionBody?: string;
} = {}): Fixture {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2483-'));
  const missionDir = path.join(repoRoot, 'missions', 'task-2483');
  fs.mkdirSync(missionDir, { recursive: true });
  const missionPath = path.join(missionDir, 'MISSION.md');
  fs.writeFileSync(missionPath, options.missionBody ?? '# Mission\n');
  if (options.gateResult !== undefined) {
    fs.mkdirSync(path.join(missionDir, '.workflow'), { recursive: true });
    fs.writeFileSync(path.join(missionDir, '.workflow', 'gate-result.json'), JSON.stringify(options.gateResult));
  }
  if (options.gates !== undefined) {
    fs.writeFileSync(path.join(repoRoot, 'workflow.config.json'), JSON.stringify({ adapters: { gates: options.gates } }));
  }
  return { repoRoot, missionPath };
}

function nonBlankLines(block: string): string[] {
  return block.split('\n').filter(l => l.trim().length > 0);
}

function assertWithinBudget(block: string): void {
  assert.ok(nonBlankLines(block).length <= COMPLETED_CONTROLS_MAX_LINES,
    `block exceeded ${COMPLETED_CONTROLS_MAX_LINES} non-blank lines: ${nonBlankLines(block).length}`);
  assert.ok(block.length <= COMPLETED_CONTROLS_MAX_CHARS,
    `block exceeded ${COMPLETED_CONTROLS_MAX_CHARS} characters: ${block.length}`);
}

const PASSING_RECORD = {
  area: 'all',
  command: './scripts/verify-local.sh all',
  exitCode: 0,
  status: 'passed',
  recordedAt: '2026-09-11T08:15:00.000Z',
};

const MISSION_WITH_GATES = [
  '# Mission: example',
  '',
  '## Gates',
  '- [ ] ./scripts/verify-local.sh all',
  '- [x] `npm run typecheck`',
  '',
  '## Stop Rules',
  '- none',
  '',
].join('\n');

test('task-2483: a recorded passing gate renders its command, status, exit code and timestamp (SC2)', () => {
  const { repoRoot, missionPath } = makeFixture({ gateResult: PASSING_RECORD });
  try {
    const block = buildCompletedControlsBlock(missionPath, repoRoot);
    assert.match(block, /\.\/scripts\/verify-local\.sh all/);
    assert.match(block, /status passed/);
    assert.match(block, /exitCode 0/);
    assert.match(block, /recordedAt 2026-09-11T08:15:00\.000Z/);
    assertWithinBudget(block);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('task-2483: a recorded failing gate is never reported as passed (ADR 0048)', () => {
  // The record deliberately lies: status says "passed" while exitCode is 2. The
  // block must trust the exit code, because only an exit code proves a run.
  const { repoRoot, missionPath } = makeFixture({
    gateResult: { ...PASSING_RECORD, exitCode: 2, status: 'passed' },
  });
  try {
    const block = buildCompletedControlsBlock(missionPath, repoRoot);
    assert.match(block, /status failed/);
    assert.match(block, /exitCode 2/);
    assert.doesNotMatch(block, /status passed/);
    assertWithinBudget(block);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('task-2483: no gate record, no configured gates and no mission gates degrade to one line (SC5)', () => {
  const { repoRoot, missionPath } = makeFixture();
  try {
    const block = buildCompletedControlsBlock(missionPath, repoRoot);
    assert.equal(nonBlankLines(block).length, 1);
    assert.match(block, /No verification gate result is recorded/);
    assert.match(block, /permitted/);
    assertWithinBudget(block);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('task-2483: an unreadable gate-result artifact degrades instead of throwing', () => {
  const { repoRoot, missionPath } = makeFixture({ gateResult: '{ not json', missionBody: MISSION_WITH_GATES });
  try {
    fs.writeFileSync(path.join(path.dirname(missionPath), '.workflow', 'gate-result.json'), '{ not json');
    const block = buildCompletedControlsBlock(missionPath, repoRoot);
    assert.match(block, /No verification gate result is recorded/);
    assert.match(block, /npm run typecheck/);
    assertWithinBudget(block);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('task-2483: configured preHandoff and preReview gates render with their phase key (SC3)', () => {
  const { repoRoot, missionPath } = makeFixture({
    gateResult: PASSING_RECORD,
    gates: {
      preHandoff: [{ key: 'unit', command: 'npm test', order: 1 }],
      preReview: [{ key: 'lint', command: 'npm run lint', order: 1 }],
      preIntegration: [{ key: 'e2e', command: 'npm run e2e', order: 1 }],
    },
  });
  try {
    const block = buildCompletedControlsBlock(missionPath, repoRoot);
    assert.match(block, /preHandoff gates executed by handoff: unit `npm test`/);
    assert.match(block, /preReview gates NOT yet run[^\n]*lint `npm run lint`/);
    // preIntegration has not run at review time; claiming it would be a lie.
    assert.doesNotMatch(block, /npm run e2e/);
    assertWithinBudget(block);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('task-2483: every mission `## Gates` command line appears in the block (SC4)', () => {
  const { repoRoot, missionPath } = makeFixture({ missionBody: MISSION_WITH_GATES });
  try {
    const block = buildCompletedControlsBlock(missionPath, repoRoot);
    assert.match(block, /\.\/scripts\/verify-local\.sh all/);
    assert.match(block, /npm run typecheck/);
    // Lines from a later section must not be scraped in as gates.
    assert.doesNotMatch(block, /none/);
    assertWithinBudget(block);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('task-2483: the reproduction-gate line appears only when MISSION.md declares Reproduction-Test (SC7)', () => {
  const withRepro = makeFixture({
    missionBody: `${MISSION_WITH_GATES}\nReproduction-Test: test/task-2483-repro.test.ts\n`,
  });
  const withoutRepro = makeFixture({ missionBody: MISSION_WITH_GATES });
  try {
    const present = buildCompletedControlsBlock(withRepro.missionPath, withRepro.repoRoot);
    const absent = buildCompletedControlsBlock(withoutRepro.missionPath, withoutRepro.repoRoot);
    assert.match(present, /red-to-green reproduction gate/);
    assert.doesNotMatch(absent, /red-to-green reproduction gate/);
    assertWithinBudget(present);
    assertWithinBudget(absent);
  } finally {
    fs.rmSync(withRepro.repoRoot, { recursive: true, force: true });
    fs.rmSync(withoutRepro.repoRoot, { recursive: true, force: true });
  }
});

test('task-2483: a configured preReview gate is never reported as executed (round 1 F1)', () => {
  // submitReview runs the 'review' phase gates only for an approve outcome
  // (src/adapters/review/review-commands.ts), which is strictly after this
  // prompt is issued. Configuration is not an execution record, so the block
  // must present a preReview gate as pending, never as an already-run control
  // the reviewer may skip.
  const { repoRoot, missionPath } = makeFixture({
    gateResult: PASSING_RECORD,
    gates: {
      preHandoff: [{ key: 'unit', command: 'npm test', order: 1 }],
      preReview: [{ key: 'lint', command: 'npm run lint', order: 1 }],
    },
  });
  try {
    const block = buildCompletedControlsBlock(missionPath, repoRoot);
    const preReviewLine = block.split('\n').find(l => /preReview/.test(l));
    assert.ok(preReviewLine, 'the configured preReview gate must still be listed with its phase key (SC3)');
    assert.match(preReviewLine, /npm run lint/);
    assert.match(preReviewLine, /NOT yet run/);
    assert.doesNotMatch(preReviewLine, /\bexecuted\b/);
    // Only the handoff-phase line may claim execution.
    for (const line of block.split('\n')) {
      if (!/\bexecuted\b/.test(line)) { continue; }
      assert.doesNotMatch(line, /preReview|preIntegration/,
        `a post-review lifecycle phase was reported as executed: ${line}`);
    }
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('task-2483: the fully-populated block stays within 12 non-blank lines and 900 characters (SC6)', () => {
  const { repoRoot, missionPath } = makeFixture({
    gateResult: PASSING_RECORD,
    gates: {
      preHandoff: [
        { key: 'unit', command: 'npm test', order: 1 },
        { key: 'typecheck', command: 'npm run typecheck', order: 2 },
      ],
      preReview: [{ key: 'lint', command: 'npm run lint -- --max-warnings 0', order: 1 }],
      preIntegration: [{ key: 'e2e', command: 'npm run e2e', order: 1 }],
    },
    missionBody: `${MISSION_WITH_GATES}\nReproduction-Test: test/task-2483-repro.test.ts\n`,
  });
  try {
    const block = buildCompletedControlsBlock(missionPath, repoRoot);
    assertWithinBudget(block);
    // Fully populated means every control family is actually present.
    for (const marker of [/Verification gate/, /Mission `## Gates`/, /preHandoff gates executed by handoff/, /preReview gates NOT yet run/, /Goal Check/, /reproduction gate/]) {
      assert.match(block, marker);
    }
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('task-2483: a long gate command is truncated rather than blowing the character budget', () => {
  const { repoRoot, missionPath } = makeFixture({
    gateResult: { ...PASSING_RECORD, command: `./scripts/verify-local.sh ${'x'.repeat(400)}` },
  });
  try {
    const block = buildCompletedControlsBlock(missionPath, repoRoot);
    assertWithinBudget(block);
    assert.match(block, /…/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('task-2483: buildCompactReviewPrompt substitutes {{completedControls}} and leaks no placeholder (SC2)', () => {
  const { repoRoot, missionPath } = makeFixture({ gateResult: PASSING_RECORD, missionBody: MISSION_WITH_GATES });
  try {
    const prompt = buildCompactReviewPrompt({
      reviewer: 'codex',
      branch: 'mission/task-2483',
      implementer: 'claude',
      attempt: 1,
      repoRoot,
      missionPath,
    });
    assert.doesNotMatch(prompt, /\{\{completedControls\}\}/);
    assert.doesNotMatch(prompt, /\{\{/);
    assert.match(prompt, /status passed/);
    assert.match(prompt, /exitCode 0/);
    assert.match(prompt, /recordedAt 2026-09-11T08:15:00\.000Z/);
    assert.match(prompt, /\.\/scripts\/verify-local\.sh all/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
