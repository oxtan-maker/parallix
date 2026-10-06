// @ts-nocheck -- TASK-2643: bounded real-agent evaluation of agent-run history retrieval.

// Agent-E2E (ADR 0057): a configured real agent must retrieve an earlier run's
// omitted command failure from the correct run and turn it into a useful
// repair decision. Real model traffic stays in this tier, never in unit tests.
//
// Scenario:
//   1. A throwaway repository on branch mission/task-9998 holds a small billing
//      module. Three earlier runs are captured through the production run
//      session and spawn seam: an older attempt of this Mission with an
//      unrelated lint failure, the latest attempt whose single failing test sits
//      between a large passing prefix and a passing-looking summary (far outside
//      the 64 KiB in-memory tail), and a decoy run of another Mission.
//   2. Baseline (headless/native history): a fresh agent receives the latest
//      run's retained tail, which is all a pipe launch keeps in memory today.
//   3. Treatment: a fresh agent receives only the one-line `px history` pointer
//      and the production `px` CLI on PATH.
//
// Reported separately per condition: retrieval accuracy (exact failing case and,
// for the treatment, the correct run reference), outcome (the repair names the
// rounding mode in src/billing.py) and context cost (prompt bytes, model input
// and output tokens, cost).
//
// Bounded: PARALLIX_RUN_HISTORY_EVAL_TRIALS (default 2) trials per condition,
// each capped at PARALLIX_RUN_HISTORY_EVAL_TIMEOUT_MS and a small turn budget.
// Requires the configured `codex` CLI with working credentials and a built
// `build/px.mjs`. Codex is chosen because it is the available configured
// real-agent runner on this workstation; the scenario does not exercise a
// provider-specific transcript format.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openRunSession } from '../../../src/adapters/agents/run-session.js';
import { spawnAndTee } from '../../../src/adapters/process/spawn-tee.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const CLI_ENTRY = path.join(REPO_ROOT, 'build', 'px.mjs');
const MODEL = process.env.PARALLIX_RUN_HISTORY_EVAL_MODEL;
const TRIALS = Number(process.env.PARALLIX_RUN_HISTORY_EVAL_TRIALS || 2);
const TIMEOUT_MS = Number(process.env.PARALLIX_RUN_HISTORY_EVAL_TIMEOUT_MS || 240000);
const KEEP_TMP = process.env.PARALLIX_E2E_KEEP_TMP === '1';
const FAILING_CASE = 'test_rounding[case-7193]';
const sink = { write: () => true };

function git(cwd, args) {
  const result = childProcess.spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) { throw new Error(`git ${args.join(' ')}: ${result.stderr}`); }
}

function makeRepo(root, slug) {
  const repo = path.join(root, `billing-${slug}`);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'billing.py'), [
    'from decimal import Decimal, ROUND_HALF_DOWN',
    '',
    'ROUNDING = ROUND_HALF_DOWN',
    '',
    'def round_amount(value: Decimal) -> Decimal:',
    "    return value.quantize(Decimal('0.01'), rounding=ROUNDING)",
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(repo, 'src', 'report.py'), 'def render(rows):\n    return "\\n".join(str(r) for r in rows)\n');
  fs.writeFileSync(path.join(repo, 'tests', 'test_billing.py'), 'import pytest\n# 7,500 generated rounding cases; see fixtures.\n');
  git(repo, ['init', '-q', '-b', `mission/${slug}`]);
  git(repo, ['config', 'user.email', 'e2e@parallix.test']);
  git(repo, ['config', 'user.name', 'E2E']);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  return repo;
}

/** Capture one earlier run through the production run session and spawn seam. */
async function seedRun(repo, slug, family, attempt, script) {
  const run = openRunSession(
    { worktree: repo, slug, role: 'execute', family, attempt, log: () => {} },
    { config: () => ({ host: 'pipe', whenUnavailable: 'fallback' }), repositoryKey: () => 'evalrepo' },
  );
  const result = await spawnAndTee('sh', ['-c', script], { cwd: repo, stdoutSink: sink, stderrSink: sink, ...run.teeOptions });
  run.finish(result);
  return { runId: run.runId, result };
}

const LATEST_RUN_SCRIPT = [
  'i=0; while [ $i -lt 1500 ]; do echo "PASSED tests/test_billing.py::test_rounding[case-$i]"; i=$((i+1)); done',
  `echo "FAILED tests/test_billing.py::${FAILING_CASE} - AssertionError: expected Decimal('10.05') got Decimal('10.04') (ROUND_HALF_DOWN in src/billing.py; invoices require ROUND_HALF_EVEN)"`,
  'i=1500; while [ $i -lt 4200 ]; do echo "PASSED tests/test_billing.py::test_rounding[case-$i]"; i=$((i+1)); done',
  'echo "==== 4199 passed, 1 xfailed in 41.20s ===="',
  'exit 1',
].join('\n');

function pxWrapper(root) {
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'px'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI_ENTRY)} "$@"\n`, { mode: 0o755 });
  return bin;
}

const QUESTION = [
  'The previous agent run of this Mission ended with a failing check.',
  'Identify the exact failing command or test from the most recent run, and decide the repair (file and change). Do not edit files.',
  'End your answer with one JSON line: {"runRef": "<run: reference or null>", "failure": "<exact failing test id and error>", "repair": "<file and change>"}',
].join('\n');

function runAgent(cwd, prompt, env) {
  const args = ['exec', '--json', '--sandbox', 'read-only'];
  if (MODEL) { args.push('--model', MODEL); }
  args.push(prompt);
  const out = childProcess.spawnSync('codex', args, { cwd, env, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  const events = (out.stdout || '').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const result = events.find(e => e.type === 'turn.completed') || {};
  const text = events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message')
    .map(e => e.item.text).join('\n');
  const toolCommands = events.filter(e => e.type === 'item.completed' && e.item?.type === 'command_execution')
    .map(e => e.item.command);
  return { text, usage: result.usage ?? {}, cost: null, toolCommands, status: out.status };
}

function lastJson(text) {
  const line = text.trim().split('\n').reverse().find(l => l.trim().startsWith('{'));
  try { return line ? JSON.parse(line) : {}; } catch { return {}; }
}

function score(answer, latestRunId) {
  const failure = String(answer.failure ?? '');
  const repair = String(answer.repair ?? '');
  return {
    retrieved: failure.includes('case-7193') && /10\.0[45]/.test(failure),
    correctRun: String(answer.runRef ?? '').includes(latestRunId),
    wrongRun: /F841|unused|token_refresh|401/.test(failure),
    usefulRepair: /billing\.py/.test(repair) && /HALF_EVEN/.test(repair),
  };
}

test('a fresh agent retrieves the omitted failure from the correct run and decides the repair (TASK-2643)', { timeout: TIMEOUT_MS * TRIALS * 2 + 60000 }, async () => {
  assert.ok(fs.existsSync(CLI_ENTRY), 'build/px.mjs is required: run npm run build');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-run-history-eval-'));
  try {
    const slug = 'task-9998';
    const treatmentRepo = makeRepo(path.join(root, 'treatment'), slug);
    await seedRun(treatmentRepo, slug, 'codex', 1, 'echo "src/report.py:12:5: F841 local variable \'tmp\' is assigned but never used"; exit 1');
    const latest = await seedRun(treatmentRepo, slug, 'qwen', 2, LATEST_RUN_SCRIPT);
    const decoyRepo = makeRepo(path.join(root, 'decoy'), 'task-9997');
    await seedRun(decoyRepo, 'task-9997', 'codex', 1, 'echo "FAILED tests/test_auth.py::test_token_refresh - 401"; exit 1');
    const tail = latest.result.stdout;
    assert.equal(tail.includes('case-7193'), false, 'the failure is omitted from the in-memory tail');
    const baselineRepo = makeRepo(path.join(root, 'baseline'), slug);

    const env = { ...process.env, PATH: `${pxWrapper(root)}${path.delimiter}${process.env.PATH}` };
    const pointer = 'Earlier agent runs of this mission are searchable with `px history search <pattern>` and `px history show <ref>` (bounded; cite the run: references).';
    const conditions = {
      baseline: { cwd: baselineRepo, prompt: `${QUESTION}\n\nThe harness retained this output tail of the most recent run:\n${tail}` },
      treatment: { cwd: treatmentRepo, prompt: `${QUESTION}\n\n${pointer}` },
    };
    const report = {};
    for (const [name, condition] of Object.entries(conditions)) {
      const trials = [];
      for (let i = 0; i < TRIALS; i += 1) {
        const run = runAgent(condition.cwd, condition.prompt, env);
        const answer = lastJson(run.text);
        const verdict = score(answer, latest.runId);
        trials.push({
          ...verdict,
          answer,
          tools: run.toolCommands.map(c => String(c).slice(0, 160)),
          historyCalls: run.toolCommands.filter(c => /px history/.test(String(c))).length,
          promptBytes: Buffer.byteLength(condition.prompt),
          inputTokens: (run.usage.input_tokens ?? 0) + (run.usage.cached_input_tokens ?? 0),
          outputTokens: run.usage.output_tokens ?? 0,
          costUsd: run.cost,
        });
      }
      const count = key => trials.filter(t => t[key]).length;
      report[name] = {
        trials: trials.length,
        retrievalAccuracy: `${count('retrieved')}/${trials.length}`,
        correctRunReference: `${count('correctRun')}/${trials.length}`,
        wrongRunAnswers: count('wrongRun'),
        usefulRepair: `${count('usefulRepair')}/${trials.length}`,
        meanPromptBytes: Math.round(trials.reduce((n, t) => n + t.promptBytes, 0) / trials.length),
        meanInputTokens: Math.round(trials.reduce((n, t) => n + t.inputTokens, 0) / trials.length),
        meanOutputTokens: Math.round(trials.reduce((n, t) => n + t.outputTokens, 0) / trials.length),
        totalCostUsd: Number(trials.reduce((n, t) => n + (t.costUsd ?? 0), 0).toFixed(4)),
        historyCalls: trials.map(t => t.historyCalls),
      };
      report[`${name}Trials`] = trials;
    }
    console.log(`[run-history-eval] agent=codex model=${MODEL ?? 'configured-default'} latestRun=${latest.runId}\n${JSON.stringify(report, null, 2)}`);
    const treatment = report.treatmentTrials;
    assert.ok(treatment.filter(t => t.retrieved && t.correctRun).length >= Math.ceil(TRIALS / 2), 'the treatment retrieves the failure from the correct run');
    assert.ok(treatment.every(t => t.historyCalls > 0), 'the treatment retrieves through px history');
    assert.equal(treatment.filter(t => t.wrongRun).length, 0, 'no treatment answer takes another run or Mission failure');
    assert.ok(treatment.filter(t => t.usefulRepair).length >= Math.ceil(TRIALS / 2), 'the treatment reaches a useful repair decision');
  } finally {
    if (!KEEP_TMP) { fs.rmSync(root, { recursive: true, force: true }); }
  }
});
