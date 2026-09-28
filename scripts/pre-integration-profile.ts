// pre-integration-profile.ts — measure the repository's pre-integration gate
// topology without landing anything (TASK-2590).
//
// Runs the configured `adapters.gates.preIntegration` plan through the
// production runPhaseGates scheduler (same ordering, `after` dependencies and
// parallelism as `px integrate`) with PARALLIX_TEST_PROFILE=1, so the unit,
// integration-ci and integration-local runners each write a per-file timing
// profile under tmp/test-profile/. Prints one JSON document with each gate's
// wall duration and the phase wall time.
//
// Usage: npx tsx scripts/pre-integration-profile.ts [--skip <gate-key> ...] [--parallel <n>]
//
// `--skip quality-gate` avoids publishing a SonarQube Cloud analysis for a
// measurement-only run; the skipped gate's dependants still run.
import path from 'node:path';
import { loadPhaseGates, runPhaseGates, type RepositoryGate } from '../src/adapters/config/repository-gates.js';

const args = process.argv.slice(2);
const skip = new Set<string>();
let maxParallel: number | undefined;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--skip') { skip.add(args[++index]); }
  else if (args[index] === '--parallel') { maxParallel = Number(args[++index]); }
  else { throw new Error(`unknown argument: ${args[index]}`); }
}

const checkoutPath = path.resolve(process.env.PARALLIX_EXECUTION_ROOT || process.cwd());
const gates: RepositoryGate[] = loadPhaseGates(checkoutPath, 'preIntegration')
  .filter(gate => !skip.has(gate.key))
  .map(gate => ({ ...gate, after: (gate.after || []).filter(dependency => !skip.has(dependency)) }));

process.env.PARALLIX_TEST_PROFILE ||= '1';
const started = Date.now();
const result = await runPhaseGates('integration', {
  slug: 'pre-integration-profile',
  checkoutPath,
  gates,
  maxParallel,
  log: () => undefined,
  error: (line: string) => console.error(line),
});
const wallMs = Date.now() - started;
console.log(JSON.stringify({
  ok: result.ok,
  wallMs,
  skipped: [...skip],
  gates: (result.outcomes || []).map(outcome => ({ key: outcome.key, exitCode: outcome.exitCode, durationMs: outcome.durationMs })),
  failed: result.failedGate ? { key: result.failedGate.key, stderrTail: result.failedGate.stderr.slice(-2000), stdoutTail: result.failedGate.stdout.slice(-2000) } : null,
}, null, 2));
process.exit(result.ok ? 0 : 1);
