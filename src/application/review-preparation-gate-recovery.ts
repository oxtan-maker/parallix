import { missionId } from '../domain/mission.js';
import { AGENT_COMMAND_COMPLETION_CONTRACT } from './agent-completion-contract.js';
import { classifyError } from '../domain/failure-classification.js';
import { recordImplementerLaunch } from './rebase-identity.js';
import type { ReviewPreparationMissionServices } from './ports/review-preparation-workflow.js';
import { gateFailureReasonFromProcess } from '../domain/failure-classification.js';
/**
 * ReviewPreparation gate outcomes with rebound recovery: the final repository
 * verification and the Mission's declared gates, each of which may hand a
 * failure to the implementer and re-run the whole review preparation once it is repaired.
 */

import * as fmt from './presentation/cli-format.js';
import type { ReviewPreparationLog, ReviewPreparationMissionServicesPort, ReviewPreparationResult, ReviewPreparationWorkflowPorts, PerformReviewPreparationOptions, ProofResult } from "./ports/review-preparation-workflow.js";
import type { RecordedContract } from "./review-preparation-contract.js";
import type { DeclaredGateRunner } from "./review-preparation-declared-gates.js";
import { rebound, type ReboundReason } from './rebound-kernel.js';
import { transitionReviewRepair } from './review-repair-lifecycle.js';
import { pendingRetainedRepair } from './review-loop/retained-repair.js';

/** Facts both gate stages share with the surrounding review preparation run. */
interface GateStageContext {
  transitionToImplementer: () => Promise<void>;
  rootDir: string;
  forgejoUser: string;
  log: ReviewPreparationLog;
  error: ReviewPreparationLog;
  startAgentFn: NonNullable<PerformReviewPreparationOptions['startAgentFn']>;
  recoverGateFailure: boolean;
  options: PerformReviewPreparationOptions;
  retryReviewPreparation: (_slug: string, _options: PerformReviewPreparationOptions) => Promise<ReviewPreparationResult>;
}

export class ReviewPreparationGateRecovery {
  private readonly ports: ReviewPreparationWorkflowPorts;
  private readonly gates: DeclaredGateRunner;

  constructor(ports: ReviewPreparationWorkflowPorts, gates: DeclaredGateRunner) {
    this.ports = ports;
    this.gates = gates;
  }

  /** Evidence preparation reuses the bounded kernel and its truthful planned checkpoint. */
  async repairPreparationFailure(slug: string, failure: ReviewPreparationResult, context: {
    root: string; services: ReviewPreparationMissionServices; startAgent: NonNullable<PerformReviewPreparationOptions['startAgentFn']>;
    verify: () => Promise<ReviewPreparationResult>; log: ReviewPreparationLog; error: ReviewPreparationLog; attempts: number;
  }): Promise<ReviewPreparationResult> {
    if (failure.ok || failure.recoveryAttempted || failure.gatekeeperPushedBack || !failure.error
      || classifyError(failure.error).dispatchAction !== 'AutoSendBack') { return failure; }
    const loaded = await context.services.store.load(missionId(slug));
    if (loaded.kind !== 'found' || !loaded.mission.assignee) { return failure; }
    // Existing gate debt must resume through its retained evidence/incident owner.
    // A first-review --submit cannot open a second generic repair and new budget.
    if (pendingRetainedRepair(loaded.mission, context.root)) { return failure; }
    let result = failure;
    const outcome = await rebound({ kind: 'review-preparation-verification', error: failure.error }, {
      slug, worktree: context.root, implementer: loaded.mission.assignee, maxAttempts: context.attempts,
      startAgent: context.startAgent,
      applyAgentFallback: async ({ launchResult, original }) => {
        const actual = launchResult?.agent ?? original;
        await recordImplementerLaunch(slug, actual, context.services.store, context.services.lifecycle);
        return actual;
      },
      verify: async () => { result = await context.verify(); return { ok: result.ok, diagnostic: result.error ?? '' }; },
      log: context.log, error: context.error,
    });
    return outcome.outcome === 'fixed' ? result : { ...result, recoveryAttempted: true, error: outcome.dossier || outcome.diagnostic || failure.error };
  }

  /** Run the final repository verification; null means review preparation may continue. */
  async verifyRepository(slug: string, context: GateStageContext & {
    skipGate: boolean;
    area: string;
    runVerificationGateFn: NonNullable<PerformReviewPreparationOptions['runVerificationGateFn']>;
  }): Promise<ReviewPreparationResult | null> {
    const ports = this.ports;
    const { rootDir, forgejoUser, log, error, startAgentFn, recoverGateFailure, options, retryReviewPreparation, skipGate, area, runVerificationGateFn } = context;
    if (skipGate) {
      log(fmt.status('WARN', 'Repository verification skipped (--no-gate).'));
    } else {
      const verificationCommand = ports.verification.formatVerificationCommand(area, rootDir);
      const reusableProof = ports.verification.readReusableVerificationProof(verificationCommand, rootDir);
      if (reusableProof.ok) {
        log(fmt.status('PASS', proofReuseMessage(reusableProof)));
      } else {
        // Bind a reusable proof to the inputs that existed before execution. A
        // successful process exit alone must not certify a tree changed mid-gate.
        const beforeGateProof = ports.verification.createVerificationProofIdentity(verificationCommand, rootDir);
        log(`Verifying the repository: ${verificationCommand}`);
        const verifyResult = await runVerificationGateFn(area, {
          rootDir,
          stdio: 'pipe',
          runFn: ports.git.run
        });
        if (verifyResult.status !== 0) {
          const stdout = (verifyResult.stdout || '').trim();
          const stderr = (verifyResult.stderr || '').trim();
          const msg = 'Final verification gate failed. Fix errors before submitting or use --no-gate if appropriate.';
          error(msg);
          const failure: ReviewPreparationResult = {
            ok: false,
            error: msg,
            gateOutput: { stdout, stderr },
            gateFailure: {
              area, command: verificationCommand, cwd: rootDir,
              exitCode: verifyResult.status, stdout, stderr, signal: verifyResult.signal,
              failureReason: gateFailureReasonFromProcess(verifyResult),
              ...(ports.verification.isTransientVerificationFailure({ stdout, stderr }) ? { transient: true } : {}),
            },
          };
          // `px review` used to print this result and exit, unlike the active
          // command which routed it through rebound.  Keep one kernel policy for
          // both entry points and re-run the complete review preparation only after a real
          // agent repair succeeds.  The recursive run disables this boundary so
          // it returns fresh process evidence to the kernel instead of nesting
          // another recovery budget.
          if (!recoverGateFailure) { return failure; }
          let retried: ReviewPreparationResult | null = null;
          const outcome = await rebound(failure.gateFailure ? {
            kind: 'gate-failure',
            ...failure.gateFailure,
          } : {
            kind: "review-preparation-verification", error: msg, gateOutput: `${stdout}\n${stderr}`.trim(),
          }, {
            slug,
            worktree: rootDir,
            implementer: forgejoUser,
            startAgent: startAgentFn,
            readHead: () => {
              const result = ports.git.git(['-C', rootDir, 'rev-parse', 'HEAD']);
              return result.status === 0 ? (result.stdout ?? '').trim() : null;
            },
            transitionToImplementer: context.transitionToImplementer,
            verify: async () => {
              if (ports.verification.formatVerificationCommand(area, rootDir) !== verificationCommand) {
                return { ok: false, diagnostic: 'Authorized required check changed during repair; operator decision required', reason: { kind: 'declared-gate-validation', command: verificationCommand, diagnostic: 'Locked repository verification command changed' } };
              }
              retried = await retryReviewPreparation(slug, {
                ...options, worktree: rootDir, force: true, recoverGateFailure: false,
              });
              return {
                ok: Boolean(retried.ok),
                command: verificationCommand,
                diagnostic: retried.error || '',
                reason: retriedReason(retried),
              };
            },
            log,
            error,
          });
          return gateRepairResult(outcome, retried, failure);
        }
        const proofResult = beforeGateProof.ok
          ? ports.verification.writeReusableVerificationProof(verificationCommand, rootDir, { expectedIdentity: beforeGateProof.identity })
          : beforeGateProof;
        if (proofResult.ok) {
          log(fmt.status('PASS', 'Repository verification passed.'));
        } else {
          log(fmt.status('WARN', `Repository verification passed, but its reusable proof is unavailable (${proofResult.error}).`));
        }
      }
    }
    return null;
  }

  /** Run the Mission's declared gates; null means every gate passed or none applied. */
  async runDeclaredGates(slug: string, context: GateStageContext & {
    contract: RecordedContract;
    missionDir: string;
    missionDirPath: string;
    internalLog: ReviewPreparationLog;
    missionServicesFn: ReviewPreparationMissionServicesPort;
  }): Promise<ReviewPreparationResult | null> {
    const ports = this.ports;
    const gates = this.gates;
    const { rootDir, forgejoUser, log, error, startAgentFn, recoverGateFailure, options, retryReviewPreparation, contract, missionDir, missionDirPath, internalLog, missionServicesFn } = context;
    // Step 2.6: Generic ## Gates runner — execute any gates declared in MISSION.md
    const recordedGates = contract.gates;
    if (contract.draftedInDb && recordedGates.length === 0) {
      // Activation requires a declared gate, so none here means the recorded
      // contract lost it. Running nothing would pass review preparation unverified.
      const msg = `${fmt.slug(slug)} has no recorded verification gate. Declare one with \`px gate add\` before review preparation.`;
      error(msg);
      return { ok: false, error: msg };
    }
    log(fmt.status('INFO', `Running mission-declared gates for ${fmt.slug(slug)}.`));
    const gatesResult = await gates.runDeclaredGates(missionDir, rootDir, { log: internalLog, error, recordedGates });
    if (gatesResult.ok === false) {
      const msg = `Declared gate "${gatesResult.gate}" failed for ${fmt.slug(slug)}: ${gatesResult.error || gatesResult.reason}. Blocking review preparation — task remains in active.`;
      error(msg);
      const failure = declaredGateFailure(gatesResult, msg, rootDir);
      if (!recoverGateFailure) { return failure; }
      const reason = gatesResult.reason === 'validation-failed'
        ? { kind: 'declared-gate-validation' as const, command: gatesResult.gate, diagnostic: gatesResult.error || msg }
        : { kind: 'gate-failure' as const, ...failure.gateFailure! };
      let retried: ReviewPreparationResult | null = null;
      const outcome = await rebound(reason, {
        slug,
        worktree: rootDir,
        implementer: forgejoUser,
        startAgent: startAgentFn,
        readHead: () => {
          const result = ports.git.git(['-C', rootDir, 'rev-parse', 'HEAD']);
          return result.status === 0 ? (result.stdout ?? '').trim() : null;
        },
        transitionToImplementer: async (missionSlug) => {
          const services = await missionServicesFn(rootDir, { missionDir: missionDirPath });
          await transitionReviewRepair(missionSlug, 'active', forgejoUser, services.store, services.lifecycle);
          return ports.backlog.transitionTask(missionSlug, 'active', { rootDir, log });
        },
        verify: async () => {
          retried = await retryReviewPreparation(slug, { ...options, worktree: rootDir, force: true, recoverGateFailure: false });
          return {
            ok: Boolean(retried.ok),
            command: gatesResult.gate,
            diagnostic: retried.error || '',
            reason: retried.reason === 'validation-failed'
              ? { kind: 'declared-gate-validation', command: gatesResult.gate, diagnostic: retried.error || '' }
              : retried.gateFailure ? { kind: 'gate-failure', ...retried.gateFailure } : undefined,
          };
        },
        log,
        error,
      });
      return outcome.outcome === 'fixed' && retried
        ? retried
        : { ...failure, recoveryAttempted: true, error: outcome.dossier || outcome.diagnostic || failure.error };
    }
    return null;
  }
}

/** Preserve producer attribution while supporting older proof-port adapters. */
function gateRepairResult(outcome: Awaited<ReturnType<typeof rebound>>, retried: ReviewPreparationResult | null, failure: ReviewPreparationResult): ReviewPreparationResult {
  if (outcome.outcome === 'fixed' && retried) { return retried; }
  return { ...(retried ?? failure), recoveryAttempted: true, error: outcome.dossier || outcome.diagnostic || failure.error };
}

function retriedReason(retried: ReviewPreparationResult): ReboundReason {
  if (retried.recoveryFailure) { return retried.recoveryFailure; }
  if (retried.gateFailure) { return { kind: 'gate-failure', ...retried.gateFailure }; }
  return { kind: "review-preparation-verification", error: retried.error || "ReviewPreparation failed after gate repair" };
}

function proofReuseMessage(proof: ProofResult): string {
  return proof.diagnostic ?? 'Repository verification passed by reuse of successful active/review proof.';
}

function declaredGateFailure(gatesResult: Extract<Awaited<ReturnType<DeclaredGateRunner['runDeclaredGates']>>, { ok: false }>, msg: string, rootDir: string): ReviewPreparationResult {
  const processFailure = gatesResult.reason === 'gate-failed' ? gatesResult : null;
  return {
    ok: false,
    error: msg,
    reason: gatesResult.reason,
    gateOutput: { stdout: (processFailure?.stdout || ''), stderr: (processFailure?.stderr || '') },
    ...(processFailure ? {
      gateFailure: {
        failureReason: processFailure.failureReason, signal: processFailure.signal ?? null,
        area: 'declared gate', command: processFailure.gate, cwd: rootDir, exitCode: processFailure.exitCode,
        stdout: processFailure.stdout || '', stderr: processFailure.stderr || processFailure.error || '',
      },
    } : {}),
  };

}

export function reviewPreparationRebaseFailure(rebaseResult: Awaited<ReturnType<ReviewPreparationWorkflowPorts['rebase']['rebaseBeforeReviewRound']>>, rootDir: string, ports: ReviewPreparationWorkflowPorts, error: ReviewPreparationLog): ReviewPreparationResult | null {
  if (!rebaseResult.ok) {
    if (rebaseResult.sharedFileConflicts) {
      const msg = `Rebase encountered shared-file conflicts. ${AGENT_COMMAND_COMPLETION_CONTRACT} Resolve the conflicts in the worktree, then re-run review preparation.`;
      error(msg);
      return { ok: false, error: msg, recoveryFailure: { kind: 'rebase-conflict',
        files: rebaseResult.failure?.kind === 'conflict' ? rebaseResult.failure.sharedFiles : [], diagnostic: msg } };
    } else if (rebaseResult.failure?.kind === 'gate') {
      // The rebase succeeded; the push-time verification gate did not. Keep
      // its process evidence so the rebound kernel classifies it as a gate
      // failure and the implementer sees the command and output, instead of
      // being told to fix a rebase that already works.
      const { gate } = rebaseResult.failure;
      const msg = `Pre-review push gate failed for area "${gate.area}": ${gate.command} exited with code ${gate.exitCode}.`;
      error(msg);
      return {
        ok: false,
        error: msg,
        gateOutput: { stdout: gate.stdout, stderr: gate.stderr },
        gateFailure: {
          failureReason: gate.failureReason ?? gateFailureReasonFromProcess({ status: gate.exitCode, signal: gate.signal, stdout: gate.stdout, stderr: gate.stderr }),
          signal: gate.signal, area: gate.area, command: gate.command, cwd: rootDir, exitCode: gate.exitCode,
          stdout: gate.stdout, stderr: gate.stderr,
          ...(ports.verification.isTransientVerificationFailure({ stdout: gate.stdout, stderr: gate.stderr }) ? { transient: true } : {}),
        },
      };
    } else {
      const msg = "Rebase failed before review preparation. Ensure the mission branch can be rebased onto the latest primary branch.";
      error(msg);
      const failure = rebaseResult.failure;
      return { ok: false, error: msg, recoveryFailure: failure?.kind === 'hook'
        ? { kind: 'hook-failure', hook: failure.hook.hook, operation: `git ${failure.operation}`, output: failure.hook.output }
        : { kind: "review-preparation-verification", error: failure?.kind === 'other' ? `${msg}\n${failure.output}` : msg } };
    }
  }

  return null;
}
