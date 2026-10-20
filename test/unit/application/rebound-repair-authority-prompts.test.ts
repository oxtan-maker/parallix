import { captureRecoveryEvidence, lookupRecoveryEvidence, listRecoveryEvidence } from '../../../src/application/recovery-evidence.js';
/**
 * TASK-2575 — rebound prompts are repair-capable across repositories.
 *
 * In task-2573 the agent-smoke rebound told the implementer to repair "the
 * specific failing test or code path" and to commit; the implementer traced the
 * failure to runner configuration, decided that was outside mission scope, and
 * stopped without a usable report. These tests lock the replacement contract on
 * representative repairable gate and hook failures and an external
 * model-healthcheck failure: the prompt supplies the exact failed check, its
 * logs, and the mission outcome, requires preserving the repository, presumes
 * no cause, repair location, or commit, and says to report an unrepairable
 * external blocker and stop.
 *
 * Mock-only: `startAgent` and `verify` are injected; no agents, Git, or Forgejo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp } from '../../helpers/temp-dir.js';

import { rebound, type ReboundReason } from '../../../src/application/rebound-kernel.js';

const SLUG = 'task-2575-fixture';

/** Run one rebound attempt and return the fix prompt the implementer received. */
async function promptFor(reason: ReboundReason): Promise<string> {
  const prompts: string[] = [];
  await rebound(reason, {
    slug: SLUG,
    worktree: '/tmp/task-2575-fixture',
    implementer: 'codex',
    maxAttempts: 1,
    startAgent: async (_step, options) => {
      prompts.push((typeof options.prompt === 'function' ? options.prompt('codex') : options.prompt));
      return { agent: 'codex', result: { status: 0 } };
    },
    verify: () => ({ ok: true as const }),
    log: () => {},
    error: () => {},
  });
  assert.equal(prompts.length, 1, 'exactly one implementer launch');
  return prompts[0];
}

const repairableGate: ReboundReason = {
  kind: 'gate-failure',
  area: 'static-analysis',
  command: './scripts/verify-local.sh static-analysis',
  exitCode: 1,
  stdout: 'src/widget.ts:12:3 error no-unused-vars: total is assigned but never used',
  stderr: '',
};

const repairableHook: ReboundReason = {
  kind: 'hook-failure',
  hook: 'pre-commit',
  operation: 'pre-review safety commit',
  output: 'pre-commit: prettier --check failed for docs/guide.md',
};

const externalHealthcheck: ReboundReason = {
  kind: 'gate-failure',
  area: 'integration gate agent-smoke',
  command: './scripts/verify-local.sh agent-smoke',
  exitCode: 1,
  stdout: 'pi healthcheck timed out after 60s: empty assistant turn from vLLM at http://127.0.0.1:8000/v1',
  stderr: '',
};

/** The shared contract every repairable gate or hook rebound prompt honours. */
function assertRepairCapable(prompt: string, failedCheck: RegExp, log: RegExp) {
  assert.match(prompt, failedCheck, 'names the exact failed check');
  assert.match(prompt, log, 'carries the captured failure log');
  assert.match(prompt, new RegExp(`Mission outcome: .*${SLUG}`), 'states the mission outcome');
  assert.match(prompt, /without breaking the repository/i, 'requires preserving the repository');
  assert.match(prompt, /never weaken, skip, or delete a check/i, 'keeps verification as a safeguard');
  // No presumed cause or repair location.
  assert.doesNotMatch(prompt, /specific failing test or code path/i);
  assert.match(prompt, /do not assume it is a test or code path inside the original mission scope/i);
  assert.match(prompt, /repository code, tests, configuration, the local environment, or runner configuration/i);
  // No presumed commit remedy.
  assert.doesNotMatch(prompt, /Commit the repair before/i);
  assert.match(prompt, /If the repair changes tracked files, commit it/i);
  assert.match(prompt, /A repair outside the repository needs no commit/);
}

test('task-2575: a repairable gate failure prompt supplies check, logs, and outcome without presuming a cause, location, or commit', async () => {
  const prompt = await promptFor(repairableGate);
  assertRepairCapable(prompt, /Gate command: \.\/scripts\/verify-local\.sh static-analysis/, /no-unused-vars: total is assigned/);
});

test('task-2575: a repairable hook failure prompt supplies check, logs, and outcome without presuming a cause, location, or commit', async () => {
  const prompt = await promptFor(repairableHook);
  assertRepairCapable(prompt, /Failed check: pre-commit hook on pre-review safety commit/, /prettier --check failed for docs\/guide\.md/);
});

test('task-2575: an external model-healthcheck failure prompt says to report the blocker accurately and stop', async () => {
  const prompt = await promptFor(externalHealthcheck);
  assertRepairCapable(prompt, /Gate command: \.\/scripts\/verify-local\.sh agent-smoke/, /empty assistant turn from vLLM/);
  assert.match(prompt, /If the cause is external and you cannot repair it/i);
  assert.match(prompt, /report the exact blocker with its evidence and stop/i);
  assert.match(prompt, /another repair attempt cannot fix it/i);
});

test('task-2575: a hook failure without a named operation still states the failed check and repair authority', async () => {
  const prompt = await promptFor({ kind: 'hook-failure', hook: 'pre-push', output: 'pre-push: npm run lint exited 1' });
  assertRepairCapable(prompt, /Failed check: pre-push hook on a workflow Git operation/, /npm run lint exited 1/);
});

test('task-2575: a declared environment healthcheck failure is reported to the human without repeated implementer bounces', async () => {
  let launches = 0;
  let reruns = 0;
  const failures: string[] = [];
  const outcome = await rebound({ ...externalHealthcheck, transient: true, environment: true }, {
    slug: SLUG,
    worktree: '/tmp/task-2575-fixture',
    implementer: 'codex',
    startAgent: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
    verify: () => { reruns++; return { ok: false as const, reason: { ...externalHealthcheck, transient: true, environment: true } }; },
    log: () => {},
    error: (message) => { failures.push(message); },
  });
  assert.equal(outcome.outcome, 'human-only');
  assert.equal(reruns, 1, 'one unchanged-tree retry only');
  assert.equal(launches, 0, 'no implementer repair is spent on an external blocker');
  assert.match(outcome.dossier ?? '', /empty assistant turn from vLLM/, 'the blocker is reported with its exact evidence');
  assert.match(failures.join('\n'), /empty assistant turn from vLLM/);
});


test('fresh repair reloads authority without inherited role instructions (TASK-2700)', async () => {
  const prompt = await promptFor(repairableGate);
  assert.match(prompt, /px status .* --json/);
  assert.match(prompt, /AGENTS.md repository rules/);
  assert.match(prompt, /current branch revision and working-tree edits/);
  assert.match(prompt, /authorized repair\/checkpoint obligations/);
  assert.match(prompt, /missing, incomplete or stale/);
  assert.match(prompt, /do not inherit prior execute\/review conversation instructions/);
  assert.match(prompt, /preserve valid commits and working-tree edits/);
  assert.doesNotMatch(prompt, /compact the aborted working context/);
});


test('independent repair two receives durable original and latest evidence (TASK-2700)', async () => {
  const worktree = mkdtemp('fresh-repair-evidence-');
  const prompts: string[] = [];
  let head = 'original-revision';
  try {
    const outcome = await rebound(repairableGate, {
      slug: SLUG, worktree, implementer: 'codex', readHead: () => head,
      startAgent: async (_step, options) => {
        assert.equal(options.sessionPolicy, 'fresh-ephemeral');
        const prompt = (typeof options.prompt === 'function' ? options.prompt('codex') : options.prompt);
        prompts.push(prompt);
        if (prompts.length === 2) {
          assert.equal(head, 'valid-first-repair');
          assert.match(prompt, /LATEST_EXACT_FAILURE/);
          assert.match(prompt, /no-unused-vars: total is assigned/);
          assert.match(prompt, /captured revision original-revision|captured revision: original-revision/);
          assert.match(prompt, /captured revision valid-first-repair/);
          const stdoutPaths = [...prompt.matchAll(/stdout: ([^;\n]+)/g)].map(match => match[1]);
          assert.ok(stdoutPaths.some(file => fs.readFileSync(file, 'utf8').includes('LATEST_EXACT_FAILURE')));
          assert.ok(stdoutPaths.some(file => fs.readFileSync(file, 'utf8').includes('no-unused-vars')));
          assert.equal(fs.readFileSync(path.join(worktree, 'pending.txt'), 'utf8'), 'preserve pending work');
        } else {
          fs.writeFileSync(path.join(worktree, 'pending.txt'), 'preserve pending work');
          head = 'valid-first-repair';
        }
        return { agent: 'codex', result: { status: 0 } };
      },
      verify: attempt => attempt === 1
        ? { ok: false, reason: { ...repairableGate, stdout: 'LATEST_EXACT_FAILURE', stderr: '' } }
        : { ok: true },
      log: () => {}, error: () => {},
    });
    assert.equal(outcome.outcome, 'fixed');
    assert.equal(outcome.attempts, 2);
  } finally { fs.rmSync(worktree, { recursive: true, force: true }); }
});

test('repair guidance checks readiness and stops on recorded human-only blockers (TASK-2713)', async () => {
  const prompt = await promptFor(repairableGate);
  assert.match(prompt, /Run px checkpoint check --slug task-2575-fixture --json before declaring completion/);
  assert.match(prompt, /primary stop reason even when checkpoint evidence is incomplete/);
  assert.match(prompt, /do not fabricate proof, start repeated evidence-only repair/);
  assert.match(prompt, /Only an explicit operator decision can clear the recorded blocker/);
});


test('current capture identity wins over newer unrelated history and retains completeness (TASK-2796)', async t => {
  const worktree = mkdtemp('current-repair-capture-');
  t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
  const input = {
    command: 'npm test -- current', cwd: worktree, missionId: SLUG,
    capturedRevision: 'current-head', exitCode: 1, signal: null,
    stdout: 'secret-2796', stderr: 'current failure', attempt: 3,
    redactor: (text: string) => text.replaceAll('secret-2796', '[REDACTED]'),
  };
  const current = captureRecoveryEvidence(input);
  assert.equal(current.ok, true);
  assert.ok(current.ref);
  const old = captureRecoveryEvidence({
    command: 'npm test -- unrelated', cwd: worktree, missionId: SLUG,
    capturedRevision: 'old-head', exitCode: 1, signal: null,
    stdout: 'unrelated failure', stderr: '',
  });
  assert.equal(old.ok, true);
  const prompts: string[] = [];
  await rebound({ kind: 'handoff-verification', error: 'Rebase failed before handoff. CURRENT_DIAGNOSTIC' }, {
    slug: SLUG, worktree, implementer: 'codex', maxAttempts: 1,
    retainedFailure: { ...current.ref, captureComplete: false, truncatedFrom: 'stdout' },
    startAgent: async (_step, options) => {
      prompts.push(typeof options.prompt === 'function' ? options.prompt('codex') : options.prompt);
      return { agent: 'codex', result: { status: 0 } };
    },
    verify: () => ({ ok: true }), log: () => {}, error: () => {},
  });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /CURRENT_DIAGNOSTIC/);
  assert.match(prompts[0], /command: npm test -- current/);
  assert.match(prompts[0], /attempt 3 of the retained series/);
  assert.ok(prompts[0].includes(current.ref.incidentId));
  assert.match(prompts[0], /capture complete: no; redacted per configured credential redaction/);
  assert.doesNotMatch(prompts[0], /secret-2796/);
  const lookup = lookupRecoveryEvidence({ cwd: worktree, missionId: SLUG, incidentId: current.ref.incidentId, attempt: 3 });
  assert.equal(lookup.ok, true);
  assert.equal(lookup.evidence?.attempt, 3);
  assert.equal(fs.readFileSync(current.ref.stdoutPath, 'utf8'), '[REDACTED]');
  assert.equal(listRecoveryEvidence({ cwd: worktree, missionId: SLUG }).length, 2);
});

for (const history of [false, true]) {
  test(`non-gate repair discloses missing current capture with history=${history} (TASK-2796)`, async t => {
    const worktree = mkdtemp('missing-current-capture-');
    t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
    if (history) {
      captureRecoveryEvidence({ command: 'npm test -- historical-unit', cwd: worktree,
        missionId: SLUG, capturedRevision: 'old-head', exitCode: 1, signal: null,
        stdout: 'unrelated old failure', stderr: '' });
    }
    const prompts: string[] = [];
    await rebound({ kind: 'handoff-verification', error: 'Rebase failed before handoff. CURRENT_ANCESTRY' }, {
      slug: SLUG, worktree, implementer: 'codex', maxAttempts: 1,
      startAgent: async (_step, options) => {
        prompts.push(typeof options.prompt === 'function' ? options.prompt('codex') : options.prompt);
        return { agent: 'codex', result: { status: 0 } };
      },
      verify: () => ({ ok: true }), log: () => {}, error: () => {},
    });
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /CURRENT_ANCESTRY/);
    assert.match(prompts[0], /No retained evidence for this failure/);
    assert.doesNotMatch(prompts[0], /Retained evidence for this failure|act on these|capture complete: yes/);
    if (history) { assert.match(prompts[0], /Historical related context/); }
    else { assert.match(prompts[0], /no retained evidence for this mission/); }
  });
}
