// ---------------------------------------------------------------------------
// TASK-2377.05 (SC7, AC #3) — kernel-only failure bounces.
//
// The invariant: no code path launches an agent to fix a failure except through
// the rebound kernel (`src/application/rebound-kernel.ts`). Everything else that
// launches an agent must be one of the enumerated non-failure or explicitly
// documented exceptions below.
//
// Every launch below is either a phase start, a conflict workflow, or the
// kernel's own port. No failure-repair launch exists outside the kernel.
//
// This test enumerates by file path and enclosing symbol, never by line number,
// so unrelated edits above a call site cannot break it. A new `startAgent` /
// `startAgentFn` call anywhere in `src/` fails until it is either routed through
// the kernel or added here with a written reason.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Permitted agent launches, keyed by `<file>::<enclosing symbol>`.
 * The value is the reason the site is not a kernel bounce.
 */
const ALLOWED: Record<string, string> = {
  // The launcher itself and its draft wrapper — the port every other site calls.
  'src/adapters/agents/agents.ts::startAgent':
    'the agent launcher itself; it launches nothing on its own initiative',
  'src/adapters/agents/agents.ts::startDraftAgent':
    'draft-phase launch wrapper over the launcher',

  // Initial phase launches: starting a mission phase, not repairing a failure.
  'src/adapters/cli/commands/active.ts::selectLaunchAndRecord':
    'px active initial execute launch (phase start)',
  'src/adapters/cli/commands/active.ts::applyExecuteFallback':
    'px active execute launch retried with a fallback agent family (agent eligibility, not failure repair)',
  'src/adapters/review/review-loop.ts::startReviewLoop':
    'review-round reviewer and implementer launches, plus the timeout re-poll relaunches that '
    + 'TASK-2377.04 deliberately left outside the kernel and docs/agents.md documents as the exception',

  // Conflict resolution: a conflict workflow, not a failure bounce.
  'src/adapters/cli/commands/resolve-conflict.ts::resolveConflict':
    'rebase conflict-resolution agent (conflict workflow)',
  'src/application/rebase-workflow.ts::runRebaseWorkflow':
    'rebase conflict-resolution agent (conflict workflow)',

  // The kernel's own launch port, and the two adapters that supply it.
  'src/application/rebound-kernel.ts::launchFixAttempt':
    'the rebound kernel launch port — the one permitted failure-repair launch',
  'src/adapters/cli/commands/active.ts::runHandoffAndReview':
    'the `reboundLaunchPort` adapter the kernel drives for the handoff bounces; it decides nothing, '
    + 'and the test below pins the launch inside that adapter',
  'src/adapters/cli/commands/handoff.ts::createHandoffPorts':
    'port wiring that hands `startAgent` to the use case for the kernel to drive',
};

/** Every `.ts` file under `src/`, excluding port interface declarations. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(file, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(file);
    }
  }
  return out;
}

/** `<file>::<symbol>` for every agent-launch call in `src/`. */
function launchSites(): Array<{ key: string; snippet: string }> {
  // A file-level declaration names the enclosing symbol. `function` is allowed a
  // stray leading space (the repo has one); `const` must start at column 0, so
  // inner helper bindings never shadow the function that contains the launch.
  const declaration = /^ ?(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?(?:async\s+)?const\s+(\w+)\s*=/;
  const call = /\b(?:startAgent|startAgentFn)\s*\(/;
  const sites: Array<{ key: string; snippet: string }> = [];

  for (const file of sourceFiles('src').sort()) {
    // Port files declare the launch signature as an interface member, not a call.
    if (file.includes(`${path.sep}ports${path.sep}`)) {
      continue;
    }
    let symbol = '<module>';
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const declared = declaration.exec(line);
      if (declared) {
        symbol = declared[1] || declared[2];
      }
      const trimmed = line.trim();
      // Comments describe launches; a default binding (`startAgentFn = …`) is not one.
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || /startAgentFn\s*=[^=]/.test(trimmed)) {
        continue;
      }
      if (call.test(line)) {
        sites.push({ key: `${file}::${symbol}`, snippet: trimmed.slice(0, 80) });
      }
    }
  }
  return sites;
}

test('SC7: no agent launch outside the rebound kernel except the enumerated allow-list', () => {
  const unexpected = launchSites().filter(site => !(site.key in ALLOWED));
  assert.deepEqual(
    unexpected,
    [],
    'A new agent launch appeared in src/. If it repairs a failure, route it through '
    + 'rebound() in src/application/rebound-kernel.ts. If it is not a failure repair, '
    + 'add it to ALLOWED in this test with the reason.',
  );
});

test('SC7: the kernel launch port is present and is the only failure-repair launch', () => {
  const kernel = fs.readFileSync('src/application/rebound-kernel.ts', 'utf8');
  assert.match(kernel, /async function launchFixAttempt/, 'the kernel still owns its launch port');

  const failureRepairSites = launchSites().filter(site =>
    site.key === 'src/application/rebound-kernel.ts::launchFixAttempt');
  assert.equal(failureRepairSites.length, 1, 'the kernel port is the single failure-repair launch');
});

test('SC7: the handoff launch lives inside the kernel launch-port adapter, not in the bounce logic', () => {
  // `runHandoffAndReview` is allow-listed because it declares the kernel's
  // launch port. Pin the launch to that adapter so a future direct launch in the
  // surrounding bounce logic cannot ride in on the same allow-list entry.
  const source = fs.readFileSync('src/adapters/cli/commands/active.ts', 'utf8');
  const portStart = source.indexOf('const reboundLaunchPort');
  const portEnd = source.indexOf("as ReboundContext['startAgent'];", portStart);
  assert.ok(portStart > 0 && portEnd > portStart, 'the kernel launch-port adapter is present');

  const adapter = source.slice(portStart, portEnd);
  const call = /\bstartAgentFn\s*\(/g;
  const insideAdapter = (adapter.match(call) || []).length;
  const inWholeFunction = (source.slice(source.indexOf('async function runHandoffAndReview')).match(call) || []).length;
  assert.equal(insideAdapter, 1, 'the adapter launches exactly once');
  assert.equal(inWholeFunction, insideAdapter, 'runHandoffAndReview launches only through the adapter');
});

test('SC5/SC6: the deleted standalone bounce policy leaves no trace in src/', () => {
  const banned = /handleHookFailureAutoBounce|MAX_HOOK_RETRY|HookRebouncePort|hookFailureRetryCount/;
  const hits = sourceFiles('src')
    .filter(file => banned.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(hits, [], 'the standalone hook-bounce policy and its persisted counter are gone');
});

test('SC6: hook-failure-workflow exports only the hook detector', async () => {
  const shared: Record<string, unknown> = await import('../src/application/hook-failure-workflow.js');
  assert.deepEqual(Object.keys(shared).sort(), ['classifyHookFailure']);
});

test('SC8: the git-only handoff repair path launches no agent', () => {
  const repair = fs.readFileSync('src/adapters/cli/commands/repair-handoff.ts', 'utf8');
  assert.ok(!/\b(?:startAgent|startAgentFn)\s*\(/.test(repair), 'repair-handoff.ts stays agent-less');
});
