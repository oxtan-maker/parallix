//
// Regression for the 2026-09-18 06:13 CEST incident: a single ambiguous Codex
// launch (`exit 1`, generic stderr) was widened into a three-hour family-wide
// `agent_blocklist` row while the Codex family was demonstrably live, so a later
// selection rerouted away from a usable family. This test drives that conflict
// end to end through the startAgent retry path with every external boundary
// injected (no real `px`, CLI, or SQLite launch):
//
//   - launchAgentFn           -> scripted ambiguous Codex exit, then a clean Claude run
//   - detectLimitHitFn        -> site-1 (genuine-quota) branch seam; the narrowed
//                                ambiguous branch (task-2536) does NOT consult the
//                                injected function — it relies on the module-level
//                                detectLimitHit, which returns null for a generic
//                                crash. The seam is passed for site-1 parity only.
//   - updateAgentBlockFn      -> records the families that get blocked
//   - isAgentBlockedFn        -> reads the block record back as "family selectable"
//   - selectAgentFn           -> codex first, then claude as the fallback
//
// The mission Goal's "check whether the family still has live work before writing
// any block" clause is not modelled here by design: the ambiguous case is
// resolved by NOT persisting a block at all (so there is no block whose
// live-work state could suppress), and the genuine-quota case (site 1) is
// intentionally exempt — a provider-wide availability/quota outage is, by
// definition, a condition under which the family cannot complete live work.
// See /tmp/task-2536-round-resolution.md (F3).
//
// At the parent commit this fails: `blockCalls` contains `codex` (a global block
// was written) and the codex family is no longer selectable. After the fix it
// passes: no block is written and the codex family stays eligible.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from '../../../lib/module-mock.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';

const agentsModule = mockModule<typeof import('../../../../src/adapters/agents/agents.js')>(
  '../../../../src/adapters/agents/agents.js',
  import.meta.url
);
await installModuleMocks();
const { startAgent } = agentsModule;

test('task-2536: ambiguous launch does not write a global block and leaves the family selectable', async () => {
  const tmpRoot = registeredMkdtemp('task-2536-ambiguous-');
  try {
    const blockCalls: string[] = [];
    let attempt = 0;
    // [0] codex: ambiguous non-zero exit, generic stderr, no quota signal.
    // [1] claude: clean success so the retry cycle terminates.
    const scripted = [
      { status: 1, stdout: '', stderr: 'generic crash\n' },
      { status: 0, stdout: 'ok', stderr: '' }
    ];
    const launchAgentFn = () => {
      const result = scripted[Math.min(attempt, scripted.length - 1)];
      attempt += 1;
      return {
        invocation: { command: 'fake', args: [], options: { cwd: tmpRoot, env: {} } },
        resultPromise: Promise.resolve(result)
      };
    };

    const selectAgentFn: NonNullable<NonNullable<Parameters<typeof startAgent>[1]>["selectAgentFn"]> = (_step, opts = {}) => {
      const exclude = opts.exclude instanceof Set ? opts.exclude : new Set();
      // First pick codex (empty exclude); the retry excludes codex and returns claude.
      return exclude.has('codex') ? 'claude' : 'codex';
    };

    let launches = 0;
    const result = await startAgent('review', {
      prompt: 'repro',
      worktree: tmpRoot,
      isAgentBlockedFn: (agent: string) => blockCalls.includes(agent),
      // Site-1 (genuine-quota) seam only: the narrowed ambiguous branch (task-2536)
      // does not consult the injected function — it relies on the module-level
      // detectLimitHit, which returns null for a generic crash.
      detectLimitHitFn: () => null,
      updateAgentBlockFn: (agent: string) => { blockCalls.push(agent); return { reason: 'block' as const }; },
      selectAgentFn,
      launchAgentFn: () => { launches += 1; return launchAgentFn(); },
      assertAgentSupportedFn: () => {},
      log: () => {}
    });

    // The retry still completes: claude runs after the ambiguous codex failure.
    assert.equal(result.agent, 'claude', 'fallback must run after an ambiguous failure');
    // Both families were attempted: the ambiguous codex launch retried onto claude.
    assert.equal(launches, 2, 'ambiguous failure retries onto the next eligible family');
    // No family is globally blocked for an ambiguous per-invocation exit.
    assert.deepEqual(blockCalls, [], 'no agent_blocklist row for an ambiguous launch');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// TASK-2729: an unexpected SIGTERM (startup or execution) is a per-invocation
// failure, not provider unavailability. The session falls back to the next
// eligible agent, the terminated agent is excluded only for this session, and no
// block is written, so a later run can select it again.
for (const phase of ['startup', 'execution']) {
  test(`SIGTERM during ${phase} falls back in-session without a block and stays eligible next run (TASK-2729)`, async () => {
    const tmpRoot = registeredMkdtemp('task-2729-sigterm-');
    try {
      const blockCalls: string[] = [];
      const launched: string[] = [];
      const prompts: string[] = [];
      const sigterm = phase === 'startup'
        ? { status: null, signal: 'SIGTERM', stdout: '', stderr: '' }
        : { status: null, signal: 'SIGTERM', stdout: 'partial work\n', stderr: 'working...\n' };
      const selectAgentFn: NonNullable<NonNullable<Parameters<typeof startAgent>[1]>["selectAgentFn"]> = (_step, opts = {}) => {
        const exclude = opts.exclude instanceof Set ? opts.exclude : new Set(opts.exclude ?? []);
        // Next-run eligibility: only a block (or this session's exclusion) hides custom.
        if (!exclude.has('custom') && !blockCalls.includes('custom')) { return 'custom'; }
        return 'claude';
      };
      const run = (script: Array<Record<string, unknown>>) => {
        let attempt = 0;
        return startAgent('review', {
          prompt: (agent: string) => { launched.push(agent); return 'repro'; },
          worktree: tmpRoot,
          isAgentBlockedFn: (agent: string) => blockCalls.includes(agent),
          updateAgentBlockFn: (agent: string) => { blockCalls.push(agent); return { reason: 'block' as const }; },
          selectAgentFn,
          launchAgentFn: (params: { prompt?: string }) => {
            prompts.push(params.prompt ?? '');
            const result = script[Math.min(attempt, script.length - 1)];
            attempt += 1;
            return {
              invocation: { command: 'fake', args: [], options: { cwd: tmpRoot, env: {} } },
              resultPromise: Promise.resolve(result)
            };
          },
          assertAgentSupportedFn: () => {},
          log: () => {}
        });
      };

      const first = await run([sigterm, { status: 0, stdout: 'ok', stderr: '' }]);
      assert.equal(first.agent, 'claude', 'SIGTERM falls back to the next eligible agent');
      assert.deepEqual(launched, ['custom', 'claude'], 'terminated agent is not relaunched within the session');
      assert.equal(prompts[0], prompts[1], 'fallback continues with the same prompt/context');
      assert.deepEqual(blockCalls, [], 'SIGTERM alone writes no persistent block');

      launched.length = 0;
      const second = await run([{ status: 0, stdout: 'ok', stderr: '' }]);
      assert.equal(second.agent, 'custom', 'next run may select the previously terminated agent');
      assert.deepEqual(blockCalls, []);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
}
