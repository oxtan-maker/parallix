import { VerificationReadSnapshot } from './verification-read-snapshot.js';
import type { WorkflowOperation } from '../../domain/workflow-operation.js';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import type {
  DeclaredGateEvidence,
  GateCheckout,
  GateEvidenceReader,
  GateEvidenceScope,
  GateResultEvidence,
  IntegrationGateEvidence,
  IntegrationGateOutcome,
  MissionGateEvidence,
} from '../../application/ports/gate-evidence.js';
import { listRecoveryEvidence } from '../../application/recovery-evidence.js';
import type { RecoveryFileSystem } from '../../application/recovery-evidence-types.js';
import type { MissionId } from '../../domain/mission.js';
import { loadPhaseGates } from '../config/repository-gates.js';
import { recoveryEvidenceFileSystem } from '../filesystem/recovery-evidence-fs.js';
import { git } from '../git/git.js';
import { inspectActiveVerificationProof } from './active-verification-proof.js';
import { readIntegrationGateRun, type IntegrationGateRun } from './integration-verification-proof.js';

/**
 * The newest sha-keyed integration validation record for a mission. `hooks` is
 * the whitelist this record validated; it never covers the plan by itself.
 */
export type IntegrationValidationRead = (_missionId: MissionId) => Promise<{
  readonly sha: string; readonly failed?: boolean; readonly hooks: readonly string[]; readonly createdAt: string;
} | null>;

export interface VerificationGateEvidenceOptions {
  readonly gitRunner?: typeof git;
  readonly configuration?: ParallixConfiguration;
  /** Resolves the mission checkout, normally from the board's per-build worktree snapshot. */
  readonly resolveWorktree: (_missionId: MissionId) => string | null;
  /** Integration validation history; null when no operator database is open. */
  readonly integrationValidation: IntegrationValidationRead | null;
  readonly recoveryFileSystem?: RecoveryFileSystem;
}

function readCheckout(worktree: string, gitRunner = git): Extract<GateCheckout, { kind: 'present' }> {
  const head = gitRunner(['-C', worktree, 'rev-parse', 'HEAD']);
  const status = gitRunner(['-C', worktree, 'status', '--porcelain']);
  if (head.status !== 0 || status.status !== 0) { throw new Error(`Mission checkout ${worktree} is unreadable`); }
  return { kind: 'present', revision: head.stdout.trim(), clean: status.stdout.trim() === '' };
}

/** A recorded gate outcome covers the checkout only on its revision and command. */
function coversCheckout(run: { revision: string; gates: readonly { key: string; command: string }[] },
  gate: { key: string; command: string }, checkout: Extract<GateCheckout, { kind: 'present' }>): boolean {
  return checkout.clean && run.revision === checkout.revision
    && run.gates.find(candidate => candidate.key === gate.key)?.command === gate.command;
}

function newerResult<T extends GateResultEvidence>(prior: T | null, candidate: T): T {
  if (!prior) { return candidate; }
  if (prior.state !== candidate.state) { return candidate.state === 'current' ? candidate : prior; }
  return Date.parse(candidate.observedAt) >= Date.parse(prior.observedAt) ? candidate : prior;
}

/** Project one configured hook without expanding marker coverage. */
function integrationOutcome(gate: { key: string; command: string }, checkout: Extract<GateCheckout, { kind: 'present' }>,
  run: IntegrationGateRun | null, marker: Awaited<ReturnType<IntegrationValidationRead>>): IntegrationGateOutcome {
  const outcome = outcomeOfRun(gate, checkout, run);
  if (!marker || !marker.hooks.includes(gate.key)) { return outcome; }
  const marked = { state: checkout.clean && marker.sha === checkout.revision ? 'current' as const : 'stale' as const,
    revision: marker.sha, observedAt: marker.createdAt };
  if (marker.failed) {
    return { ...outcome, failure: newerResult(outcome.failure, { ...marked, exitCode: null }) };
  }
  return { ...outcome, proof: newerResult(outcome.proof.state === 'absent' ? null : outcome.proof, marked) };
}

function outcomeOfRun(gate: { key: string; command: string }, checkout: Extract<GateCheckout, { kind: 'present' }>,
  run: IntegrationGateRun | null): IntegrationGateOutcome {
  const observed = run?.outcomes.find(record => record.key === gate.key);
  if (!run || !observed) { return { key: gate.key, proof: { state: 'absent' }, failure: null }; }
  const result = { state: run.current && coversCheckout(run, gate, checkout) ? 'current' as const : 'stale' as const,
    revision: run.revision, observedAt: run.finishedAt ?? run.startedAt };
  return { key: gate.key,
    proof: observed.exitCode === 0 && run.status !== 'cancelled' ? result : { state: 'absent' },
    failure: observed.exitCode !== 0 ? { ...result, exitCode: observed.exitCode } : null };
}

function runningAttempt(run: IntegrationGateRun | null, operation: Pick<WorkflowOperation, 'id' | 'generation' | 'phase'> | null,
  checkout: Extract<GateCheckout, { kind: 'present' }>) {
  const attemptKey = operation?.phase === 'checking' ? `${operation.id}:${operation.generation}` : null;
  return run && run.current && run.status === 'running' && attemptKey !== null && run.attempt === attemptKey
    && checkout.clean && run.revision === checkout.revision
    ? { attempt: run.attempt as string, startedAt: run.startedAt } : null;
}

/**
 * Reads gate evidence where the gate executor leaves it: active verification
 * proofs for passing declared gates, recovery evidence captured for failing
 * ones, the integration run record written by the gate phase itself, and the
 * sha-keyed validation markers for the configured plan.
 */
export class VerificationGateEvidenceReader implements GateEvidenceReader {
  private _snapshot?: VerificationReadSnapshot;

  constructor(private readonly _options: VerificationGateEvidenceOptions) {}

  /** Called once by board composition before each build or focused read. */
  beginRead(): void { this._snapshot = new VerificationReadSnapshot(this._options.gitRunner); }

  private checkout(worktree: string) {
    return this._snapshot
      ? this._snapshot.memo(JSON.stringify(['checkout', worktree]), () => readCheckout(worktree, this._snapshot!.git))
      : readCheckout(worktree, this._options.gitRunner);
  }

  async readDeclaredGates(scope: GateEvidenceScope, commands: readonly string[]): Promise<MissionGateEvidence> {
    const worktree = this._options.resolveWorktree(scope.missionId);
    if (!worktree) { return { checkout: { kind: 'absent' }, gates: [] }; }
    const checkout = this.checkout(worktree);
    const failures = this.failures(worktree, scope.missionId);
    const gates = commands.map((command): DeclaredGateEvidence => {
      // Newest first, so the first match is the latest failure of this command.
      const failure = failures.find(record => record.command === command && record.exitCode !== 0);
      return {
        command,
        proof: inspectActiveVerificationProof(command, worktree, { configuration: this._options.configuration }, this._snapshot),
        failure: failure ? {
          state: checkout.clean && failure.capturedRevision === checkout.revision ? 'current' : 'stale',
          revision: failure.capturedRevision,
          observedAt: failure.capturedAt,
          exitCode: failure.exitCode,
        } : null,
      };
    });
    return { checkout, gates };
  }

  /**
   * Handoff captures under the mission slug; publication verification captures
   * under the worktree name. Both stores live in the mission's own worktree.
   */
  private failures(worktree: string, missionId: MissionId) {
    const fs = this._options.recoveryFileSystem ?? recoveryEvidenceFileSystem;
    const stores = [missionId, undefined].flatMap(store => listRecoveryEvidence({ cwd: worktree, missionId: store, fs }));
    const unique = new Map(stores.map(record => [record.stdoutPath, record]));
    return [...unique.values()].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
  }

  /**
   * The configured pre-integration plan observed per gate. Two authorities cover
   * hooks: the executor's run record for this checkout, and sha-keyed validation
   * markers, which whitelist only the hooks they name.
   */
  async readIntegrationGates(scope: GateEvidenceScope, operation: Pick<WorkflowOperation, 'id' | 'generation' | 'phase'> | null): Promise<IntegrationGateEvidence> {
    const worktree = this._options.resolveWorktree(scope.missionId);
    if (!worktree) { return { checkout: { kind: 'absent' }, configured: [], gates: [], running: null }; }
    const checkout = this.checkout(worktree);
    const configured = loadPhaseGates(worktree, 'preIntegration');
    if (configured.length === 0) { return { checkout, configured: [], gates: [], running: null }; }
    if (!this._options.integrationValidation) { throw new Error('Integration validation history is unavailable'); }
    const run = readIntegrationGateRun(worktree, this._options.configuration, this._snapshot);
    const recordedMarker = await this._options.integrationValidation(scope.missionId);
    // A retry supersedes earlier marker coverage, including cancelled and
    // partially executed runs on the same inputs.
    const marker = run?.current && recordedMarker && Date.parse(run.startedAt) >= Date.parse(recordedMarker.createdAt)
      ? null : recordedMarker;
    const gates = configured.map(gate => integrationOutcome(gate, checkout, run, marker));
    const running = runningAttempt(run, operation, checkout);
    return { checkout, configured: configured.map(gate => gate.key), gates, running };
  }
}
