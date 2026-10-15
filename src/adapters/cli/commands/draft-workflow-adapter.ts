

import { type DraftAdapterDependencies, type DraftLog } from './draft-adapter-types.js';

import type { DraftWorkflowPort, DraftWorkflowContext } from '../../../application/ports/cli-workflows.js';
import * as fmt from '../../../application/presentation/cli-format.js';

import { draftPreflight, draftSetup, draftScaffold } from './draft-preparation.js';
import { draftIntake, draftTransition, draftLaunchAgent, draftPostProcess, draftCommitSafety, draftFinalTransition } from './draft-execution.js';
export interface DraftWorkflowEnvironment {
  deps: DraftAdapterDependencies;
  exitFn: DraftWorkflowContext['exitFn'];
  logFn: DraftLog; errorFn: DraftLog; debugFn: DraftLog; plumbingLogFn: DraftLog;
  startedAtMs: number;
  exitedContext(_partial: Partial<DraftWorkflowContext>): DraftWorkflowContext;
  safeExit(_code: number): boolean;
}

export function createDraftWorkflowAdapter(deps: DraftAdapterDependencies = {}): DraftWorkflowPort {

  const exitFn = deps.exitFn || process.exit;
  const logFn = deps.logFn || fmt.log.plain;
  const errorFn = deps.errorFn || fmt.log.plainError;

  // Internal plumbing (branch/worktree/graphify/.gitignore/SQLite/label/stats
  // bookkeeping) is not the mission result a first-time operator came for, so
  // it is demoted behind the existing DEBUG env gate that `fmt.log.debug` uses.
  // The message text and call order are unchanged; only the transport is gated,
  // so `DEBUG=1` reproduces the pre-change default output verbatim.
  const debugFn = (msg: string): void => { if (deps.configuration?.runtime.debug) { logFn(msg); } };
  // Wall-clock for the whole draft, reported in the closing summary: a draft is
  // a minutes-long agent run, and how long it took is the first thing an
  // operator asks once it lands.
  const startedAtMs = Date.now();

  // Setup helpers in `draft-setup.ts` emit both success plumbing and genuine
  // WARN/FAIL conditions through the single `logFn` they are handed. Routing
  // them through this splitter demotes only the success lines and keeps every
  // exceptional line on the default path.
  // ponytail: marker-based split on the rendered status tag; the alternative is
  // threading a second log channel through every draft-setup helper signature.
  const plumbingLogFn = (msg: string): void => {
    if (/\[(WARN|FAIL)\]/.test(fmt.stripAnsi(String(msg)))) { logFn(msg); return; }
    debugFn(msg);
  };

  // Helper to create an "exited" context when a step needs to abort
  function exitedContext(partial: Partial<DraftWorkflowContext>): DraftWorkflowContext {
    return {
      exited: true,
      slug: partial.slug || '',
      mainRepo: partial.mainRepo || '',
      targetWorktree: partial.targetWorktree || '',
      missionFile: partial.missionFile || '',
      recordedBase: partial.recordedBase || null,
      syntheticTask: partial.syntheticTask || null,
      agent: partial.agent || '',
      actualAgent: partial.actualAgent || null,
      agentResult: null,
      exitFn,
      logFn,
      errorFn,
      missionServicesFn: partial.missionServicesFn || (() => { throw new Error('draft command requires injected mission services'); }),
      options: partial.options || {},
    };
  }

  // Helper: safe exit — call exitFn but return (for testability)
  function safeExit(code: number): boolean {
    try { exitFn(code); } catch { /* exit may throw in tests */ }
    return true;
  }

  const environment: DraftWorkflowEnvironment = { deps, exitFn, logFn, errorFn, debugFn, plumbingLogFn, startedAtMs, exitedContext, safeExit };
  return {
    preflight: (...args) => draftPreflight(environment, ...args),
    setup: (...args) => draftSetup(environment, ...args),
    scaffold: (...args) => draftScaffold(environment, ...args),
    intake: (...args) => draftIntake(environment, ...args),
    transition: (...args) => draftTransition(environment, ...args),
    launchAgent: (...args) => draftLaunchAgent(environment, ...args),
    postProcess: (...args) => draftPostProcess(environment, ...args),
    commitSafety: (...args) => draftCommitSafety(environment, ...args),
    finalTransition: (...args) => draftFinalTransition(environment, ...args)
  };
}
