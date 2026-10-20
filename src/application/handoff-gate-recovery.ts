/**
 * Handoff gate outcomes with rebound recovery: the final repository
 * verification and the Mission's declared gates, each of which may hand a
 * failure to the implementer and re-run the whole handoff once it is repaired.
 */

import * as fmt from './presentation/cli-format.js';
import type { HandoffLog, HandoffMissionServicesPort, HandoffResult, HandoffWorkflowPorts, PerformHandoffOptions, ProofResult } from './ports/handoff-workflow.js';
import type { RecordedContract } from './handoff-contract.js';
import type { DeclaredGateRunner } from './handoff-declared-gates.js';
import { rebound, type ReboundReason } from './rebound-kernel.js';
import { transitionReviewRepair } from './review-repair-lifecycle.js';

/** Facts both gate stages share with the surrounding handoff run. */
interface GateStageContext {
  rootDir: string;
  forgejoUser: string;
  log: HandoffLog;
  error: HandoffLog;
  startAgentFn: NonNullable<PerformHandoffOptions['startAgentFn']>;
  recoverGateFailure: boolean;
  options: PerformHandoffOptions;
  retryHandoff: (_slug: string, _options: PerformHandoffOptions) => Promise<HandoffResult>;
}

export class HandoffGateRecovery {
  private readonly ports: HandoffWorkflowPorts;
  private readonly gates: DeclaredGateRunner;

  constructor(ports: HandoffWorkflowPorts, gates: DeclaredGateRunner) {
    this.ports = ports;
    this.gates = gates;
  }

  /** Run the final repository verification; null means handoff may continue. */
  async verifyRepository(slug: string, context: GateStageContext & {
    skipGate: boolean;
    area: string;
    runVerificationGateFn: NonNullable<PerformHandoffOptions['runVerificationGateFn']>;
  }): Promise<HandoffResult | null> {
    const ports = this.ports;
    const { rootDir, forgejoUser, log, error, startAgentFn, recoverGateFailure, options, retryHandoff, skipGate, area, runVerificationGateFn } = context;
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
        const verifyResult = runVerificationGateFn(area, {
          rootDir,
          stdio: 'pipe',
          runFn: ports.git.run
        });
        if (verifyResult.status !== 0) {
          const stdout = (verifyResult.stdout || '').trim();
          const stderr = (verifyResult.stderr || '').trim();
          const msg = 'Final verification gate failed. Fix errors before submitting or use --no-gate if appropriate.';
          error(msg);
          const failure: HandoffResult = {
            ok: false,
            error: msg,
            gateOutput: { stdout, stderr },
            gateFailure: {
              area, command: verificationCommand, cwd: rootDir,
              exitCode: verifyResult.status, stdout, stderr,
              ...(ports.verification.isTransientVerificationFailure({ stdout, stderr }) ? { transient: true } : {}),
            },
          };
          // `px handoff` used to print this result and exit, unlike the active
          // command which routed it through rebound.  Keep one kernel policy for
          // both entry points and re-run the complete handoff only after a real
          // agent repair succeeds.  The recursive run disables this boundary so
          // it returns fresh process evidence to the kernel instead of nesting
          // another recovery budget.
          if (!recoverGateFailure) { return failure; }
          let retried: HandoffResult | null = null;
          const outcome = await rebound(failure.gateFailure ? {
            kind: 'gate-failure',
            ...failure.gateFailure,
          } : {
            kind: 'handoff-verification', error: msg, gateOutput: `${stdout}\n${stderr}`.trim(),
          }, {
            slug,
            worktree: rootDir,
            implementer: forgejoUser,
            startAgent: startAgentFn,
            readHead: () => {
              const result = ports.git.git(['-C', rootDir, 'rev-parse', 'HEAD']);
              return result.status === 0 ? (result.stdout ?? '').trim() : null;
            },
            verify: async () => {
              if (ports.verification.formatVerificationCommand(area, rootDir) !== verificationCommand) {
                return { ok: false, diagnostic: 'Authorized required check changed during repair; operator decision required', reason: { kind: 'declared-gate-validation', command: verificationCommand, diagnostic: 'Locked repository verification command changed' } };
              }
              retried = await retryHandoff(slug, {
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
    internalLog: HandoffLog;
    missionServicesFn: HandoffMissionServicesPort;
  }): Promise<HandoffResult | null> {
    const ports = this.ports;
    const gates = this.gates;
    const { rootDir, forgejoUser, log, error, startAgentFn, recoverGateFailure, options, retryHandoff, contract, missionDir, missionDirPath, internalLog, missionServicesFn } = context;
    // Step 2.6: Generic ## Gates runner — execute any gates declared in MISSION.md
    const recordedGates = contract.gates;
    if (contract.draftedInDb && recordedGates.length === 0) {
      // Activation requires a declared gate, so none here means the recorded
      // contract lost it. Running nothing would pass handoff unverified.
      const msg = `${fmt.slug(slug)} has no recorded verification gate. Declare one with \`px gate add\` before handoff.`;
      error(msg);
      return { ok: false, error: msg };
    }
    log(fmt.status('INFO', `Running mission-declared gates for ${fmt.slug(slug)}.`));
    const gatesResult = gates.runDeclaredGates(missionDir, rootDir, { log: internalLog, error, recordedGates });
    if (gatesResult.ok === false) {
      const msg = `Declared gate "${gatesResult.gate}" failed for ${fmt.slug(slug)}: ${gatesResult.error || gatesResult.reason}. Blocking handoff — task remains in active.`;
      error(msg);
      const failure = declaredGateFailure(gatesResult, msg, rootDir);
      if (!recoverGateFailure) { return failure; }
      const reason = gatesResult.reason === 'validation-failed'
        ? { kind: 'declared-gate-validation' as const, command: gatesResult.gate, diagnostic: gatesResult.error || msg }
        : { kind: 'gate-failure' as const, ...failure.gateFailure! };
      let retried: HandoffResult | null = null;
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
          retried = await retryHandoff(slug, { ...options, worktree: rootDir, force: true, recoverGateFailure: false });
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
function gateRepairResult(outcome: Awaited<ReturnType<typeof rebound>>, retried: HandoffResult | null, failure: HandoffResult): HandoffResult {
  if (outcome.outcome === 'fixed' && retried) { return retried; }
  return { ...(retried ?? failure), error: outcome.dossier || outcome.diagnostic || failure.error };
}

function retriedReason(retried: HandoffResult): ReboundReason {
  if (retried.recoveryFailure) { return retried.recoveryFailure; }
  if (retried.gateFailure) { return { kind: 'gate-failure', ...retried.gateFailure }; }
  return { kind: 'handoff-verification', error: retried.error || 'Handoff failed after gate repair' };
}

function proofReuseMessage(proof: ProofResult): string {
  return proof.diagnostic ?? 'Repository verification passed by reuse of successful active/review proof.';
}

function declaredGateFailure(gatesResult: Extract<ReturnType<DeclaredGateRunner['runDeclaredGates']>, { ok: false }>, msg: string, rootDir: string): HandoffResult {
  const processFailure = gatesResult.reason === 'gate-failed' ? gatesResult : null;
  return {
    ok: false,
    error: msg,
    reason: gatesResult.reason,
    gateOutput: { stdout: (processFailure?.stdout || ''), stderr: (processFailure?.stderr || '') },
    ...(processFailure ? {
      gateFailure: {
        area: 'declared gate', command: processFailure.gate, cwd: rootDir, exitCode: processFailure.exitCode,
        stdout: processFailure.stdout || '', stderr: processFailure.stderr || processFailure.error || '',
      },
    } : {}),
  };

}
