import * as fmt from './presentation/cli-format.js';
import type { IntegrateOptions } from './integrate-workflow.js';
import type { IntegrateWorkflowPorts } from './ports/integrate-workflow.js';
import type { IntegrateRunState } from './integrate/squash.js';
import { IntegrationStopsForHuman, type IntegrateSeams } from './integrate/gates.js';
import { parseIntegrateArgs, type IntegrateRequest } from './integrate/support.js';
import { isNestedWorkPublisher, publishedAgentLaunch } from './recording/current-work-recorder.js';

interface IntegrateEntrySteps {
  runIntegration(slug: string, request: IntegrateRequest, options: IntegrateOptions, seams: IntegrateSeams, state: IntegrateRunState): Promise<0 | 1>;
  restoreTemporaryStash(slug: string, stash: IntegrateRunState['temporaryStash']): 0 | 1;
}

function integrationSeams(options: IntegrateOptions, ports: IntegrateWorkflowPorts): IntegrateSeams {
  return {
    // SC2: kernel-context injection seams. Both bounces build their rebound
    // context from these so tests keep a mock launch/transition/fallback
    // port instead of a real agent, git, or Forgejo.
    startAgentFn: isNestedWorkPublisher(options.nestedWork)
      ? publishedAgentLaunch(options.startAgentFn ?? ports.agents.startAgent, options.nestedWork, 'execute', (agent) => `integration repair: implementer ${agent}`)
      : options.startAgentFn ?? ports.agents.startAgent,
    transitionTaskFn: options.transitionTaskFn ?? ports.backlog.transitionTask,
    applyAgentFallbackFn: options.applyAgentFallbackFn ?? ports.agents.applyAgentFallback,
    selectAgentFn: options.selectAgentFn ?? ports.agents.selectAgent,
    workflowLauncherStatusFn: options.workflowLauncherStatusFn ?? ports.agents.workflowLauncherStatus,
    routeIntegrationGateFailureFn: options.routeIntegrationGateFailureFn ?? ports.gates.routeIntegrationGateFailure,
    // TASK-2620: the single live re-review route. Absent, a changed
    // revision stops integration for the operator to re-review; nothing
    // auto-restarts integration or merges.
    ...(options.reReviewFn ? { reReviewFn: options.reReviewFn } : {}),
  };
}

function integrationFailure(error: unknown, ports: IntegrateWorkflowPorts, state: IntegrateRunState): 0 | 1 {
  let exitCode: 0 | 1;
  // TASK-2620: a repaired-and-re-approved revision stops cleanly in the
  // integration lane for the human; this is not a failure.
  if (error instanceof IntegrationStopsForHuman) {
    state.nextActionMessage = error.message;
    exitCode = 0;
  } else {
    // Report and fail. Rethrowing here is swallowed by the terminal exit
    // port call below, which would end the run with a success code and no
    // output at all.
    if (!ports.landing.isAbort(error)) {
      fmt.log.fail(`Integration failed: ${(error as Error)?.message || String(error)}`);
      if ((error as Error)?.stack) {
        fmt.log.fail(String((error as Error).stack));
      }
    }
    exitCode = 1;
  }
  return exitCode;
}

export async function runIntegrateEntry(args: string[], options: IntegrateOptions, ports: IntegrateWorkflowPorts, steps: IntegrateEntrySteps) {
    const exitFn = options.exitFn ?? ports.process.terminate;
    let request: IntegrateRequest;
    let exitCode = 0;
    try {
      request = parseIntegrateArgs(args, options.configuration);
    } catch (error) {
      fmt.log.fail((error as Error).message);
      exitFn(1);
      return;
    }
    const slug = ports.missionPaths.inferSlug(request.explicitSlug);

    if (options.configuration?.forgejo.user === 'gemini' || options.configuration?.agents.override === 'gemini') {
      fmt.log.fail('Gemini is not authorized to run integrate. Post a handoff comment on the PR and stop.');
      exitFn(1);
      return;
    }
    if (!slug) {
      fmt.log.fail('Usage: px integrate [<slug>] [--dry-run] [--no-integration-gates]');
      exitFn(1);
      return;
    }
    if (request.noGate) {
      fmt.log.warn('integrate ignores --no-gate. The landed squash commit relies on the local git hooks for validation.');
    }

    const releaseIntegration = await ports.process.claimIntegration(slug);
    if (!releaseIntegration) {
      fmt.log.fail(`Integration of ${slug} is already running in another process. Wait for it to finish before retrying.`);
      exitFn(1);
      return { exitCode: 1 };
    }

    try {
      const seams = integrationSeams(options, ports);
      const state: IntegrateRunState = { temporaryStash: null, nextActionMessage: null };
      try {
        // TASK-2620: a repair re-review no longer restarts integration. The
        // run executes once; on a repaired-and-re-approved revision it stops in
        // the integration lane for the human.
        exitCode = await steps.runIntegration(slug, request, options, seams, state);
      } catch (error) {
        exitCode = integrationFailure(error, ports, state);
      }
      exitCode = Math.max(exitCode, steps.restoreTemporaryStash(slug, state.temporaryStash));
      if (state.nextActionMessage) {
        fmt.log.info(state.nextActionMessage);
      }
    } finally {
      await releaseIntegration();
    }
    exitFn(exitCode);
    return { exitCode };
  }
