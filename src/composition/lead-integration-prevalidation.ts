import { loadPhaseGates } from '../adapters/config/repository-gates.js';
import { resolveWorktree } from '../adapters/git/worktree.js';
import { observeMachineCpuUtilization } from '../adapters/process/machine-cpu-utilization.js';
import { readIntegrationGateRun } from '../adapters/verification/integration-verification-proof.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { SupervisorPort } from '../application/recovery-supervisor.js';
import * as fmt from '../application/presentation/cli-format.js';
import type { run as runPublicCli } from './create-cli.js';

/** Compose integration pre-validation observations and public dry-run dispatch. */
export function createLeadIntegrationPrevalidation(
  configuration: ParallixConfiguration,
  run: typeof runPublicCli,
): Pick<SupervisorPort, 'observeIntegrationPrevalidation' | 'runIntegrationDryRun'> {
  return {
    observeIntegrationPrevalidation: async mission => {
      const missionWorktree = resolveWorktree(mission, {});
      if (!missionWorktree) { throw new Error(`No worktree resolved for ${mission}`); }
      const evidence = readIntegrationGateRun(missionWorktree, configuration);
      const configured = loadPhaseGates(missionWorktree, 'preIntegration');
      // A complete green run stays current across completed rebases; each configured gate then carries by key.
      const currentSuccessfulRun = evidence !== null && evidence.status === 'passed' && configured.length > 0
        && (evidence.current ? evidence.gates.length === configured.length && configured.every(gate => evidence.outcomes.some(outcome =>
          outcome.key === gate.key && outcome.command === gate.command && outcome.exitCode === 0))
          : evidence.carried !== null && configured.every(gate => evidence.outcomes.some(outcome => outcome.key === gate.key && outcome.exitCode === 0)));
      return { currentSuccessfulRun,
        cpuUtilization: currentSuccessfulRun ? null : await observeMachineCpuUtilization() };
    },
    runIntegrationDryRun: async (mission, signal) => {
      if (signal?.aborted) { return; }
      const missionWorktree = resolveWorktree(mission, {});
      if (!missionWorktree) { throw new Error(`No worktree resolved for ${mission}`); }
      const status = await run(['integrate', mission, '--dry-run'],
        { baseCwd: missionWorktree, log: fmt.log.plain, error: fmt.log.plainError, operatorInvocation: false });
      if (status !== 0) { throw new Error(`px integrate ${mission} --dry-run exited with status ${status}`); }
    },
  };
}
