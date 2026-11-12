import type { AgentLaunchResult } from './ports/agent-launch-result.js';
import type { ReboundStartAgent } from './ports/repair-agent-launch.js';
import type { RepairCheckpointPort } from './ports/repair-checkpoint.js';
import type { RecoveryEvidenceRef } from './recovery-evidence.js';
import type { GateFailureReason, ReboundReason } from '../domain/rebound-policy.js';
import type { WorkflowReturnStage } from '../domain/board-event.js';

export type RepairStrategy = 'targeted' | 'fresh-diagnostic';

/** Result of re-running the failing check after a fix attempt. */
export interface VerifyResult {
  ok: boolean;
  /** Supplied only by an adapter that just executed this exact command successfully. */
  exactExecution?: { readonly command: string; readonly worktree: string; readonly exitCode: 0 };
  /** Receipts from one authoritative aggregate rerun, one per repaired gate. */
  exactExecutions?: readonly { readonly command: string; readonly worktree: string; readonly exitCode: 0 }[];
  workflowBlock?: import('./review-verdict-readiness.js').VerdictBlock;
  /** Exact check identity supplied by the verification adapter. */
  command?: string;
  /** Fresh diagnostic from the re-run; empty when the check passed. */
  diagnostic?: string;
  /**
   * The check's actual failure, when its adapter has process evidence. A
   * caller must not turn this into a wrapper string before handing it back to
   * the recovery policy.
   */
  reason?: ReboundReason;
}

/** Collaborators and observed facts supplied to one rebound occurrence. */
interface ReboundContextBase {
  /** Exact Git-completion instruction, certified by the stage verifier without a code-repair checkpoint. */
  repairPrompt?: () => Promise<string>;
  /** Inspect artifacts even when a completed repair process exits unsuccessfully. */
  inspectFailedRepair?: boolean;
  repairCheckpoints?: RepairCheckpointPort;
  /** Resume the harness-created incident with its original retained evidence. */
  retainedFailure?: RecoveryEvidenceRef;
  repairIncidentId?: string;
  /** Actual failed gates from one aggregate execution; each owns a checkpoint before launch. */
  repairObligations?: readonly { readonly gateKey: string; readonly reason: GateFailureReason }[];
  slug: string;
  worktree: string;
  implementer: string;
  /** Re-runs the failing check and returns pass/fail with a fresh diagnostic. */
  verify: (_attempt: number) => Promise<VerifyResult> | VerifyResult;
  /** Launch port (the agents adapter's `startAgent`, injected). */
  startAgent: ReboundStartAgent;
  /** Per-occurrence attempt budget; defaults to `DEFAULT_REBOUND_ATTEMPTS`. */
  maxAttempts?: number;
  /** Bounded no-agent retries for a declared environmental verifier outcome. */
  maxTransientRetries?: number;
  /** Launch/session retries are deliberately a different currency. */
  maxLaunchRetries?: number;
  /** Revision already known by the stage adapter, for an actionable prompt. */
  head?: string;
  /** Reads the mission revision around each repair; absent callers retain `head`. */
  readHead?: () => Promise<string | null> | string | null;
  /** Best-effort observer for stable recovery-strategy telemetry. */
  onRepairTelemetry?: (_event: { strategy: RepairStrategy;
    outcome: 'pass' | 'advance' | 'rescue' | 'escalate' }) => void;
  /** Stage adapter chooses the existing launcher step; policy stays in the kernel. */
  step?: string;
  role?: string;
  /** Agent identities that fallback selection must not use for this role. */
  exclude?: string[];
  /** Resolves the agent actually launched (fallback selection). */
  applyAgentFallback?: (_options: { launchResult: AgentLaunchResult | null | undefined;
    original: string }) => Promise<string> | string;
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
}

type ReboundTransition = {
  /** Lane the rejected work leaves; the kernel passes this same fact to telemetry and the transition. */
  returnStage: WorkflowReturnStage;
  transitionToImplementer: (_slug: string, _returnStage: WorkflowReturnStage) => Promise<unknown> | unknown;
} | {
  /** Repairs that complete work in place may mirror a backlog transition without recording a workflow return. */
  returnStage?: never;
  transitionToImplementer?: (_slug: string) => Promise<unknown> | unknown;
};

export type ReboundContext = ReboundContextBase & ReboundTransition;
