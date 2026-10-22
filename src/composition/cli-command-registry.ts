import { attachWorkflowOperations } from './workflow-operations.js';
import { ownWorkflowCli } from './workflow-cli.js';
import { createCliServiceScope, type CliCommandContext } from './cli-service-scope.js';
import { createAuthoringCommands } from './cli-authoring-commands.js';
import { createLegacyCommands } from './cli-legacy-commands.js';
import { createReadCommands } from './cli-read-commands.js';
import { createLifecycleCommands } from './cli-lifecycle-commands.js';

import type { ParallixConfiguration } from '../application/ports/configuration.js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fmt from '../application/presentation/cli-format.js';

import { packageRoot } from '../adapters/filesystem/package-root.js';
import packageJson from '../../package.json' with { type: 'json' };
import { ensureStandaloneGitRepo } from '../adapters/config/product-config.js';
import { loadStateMap } from '../adapters/config/state-map.js';
import activeWorkflow from '../adapters/cli/commands/active.js';
import { createActiveCommand } from '../interfaces/cli/active.js';


import configWorkflow from '../adapters/cli/commands/config.js';
import { createConfigCommand } from '../interfaces/cli/config.js';
import diffWorkflow from '../adapters/cli/commands/diff.js';
import { createDiffCommand } from '../interfaces/cli/diff.js';


import { currentWorkPublication } from '../application/recording/current-work-recorder.js';

import type { SupervisorPort } from '../application/recovery-supervisor.js';

import { missionId } from '../domain/mission.js';

import * as agents from '../adapters/agents/agents.js';
import { recordStageStatsSafe, stageLaunchSinceMs } from '../adapters/review/review-agent-fallback.js';
import { resolveAgentModel } from '../adapters/config/product-config.js';

import startupPreflight from '../adapters/cli/startup-preflight.js';

import resolveConflictWorkflow from '../adapters/cli/commands/resolve-conflict.js';
import { createResolveConflictCommand } from '../interfaces/cli/resolve-conflict.js';

import { createSetupCommand } from '../interfaces/cli/setup.js';

import verifyWorkflow from '../adapters/verification/verification.js';
import { createVerifyCommand } from '../interfaces/cli/verify.js';

import { deriveAliases, type Command, type MainOptions } from '../interfaces/cli/runtime.js';


import { run } from './create-cli.js';

const loadLeadComposition = () => Promise.all([
  import('./lead-supervisor.js'), import('../interfaces/cli/lead.js'), import('../application/recovery-supervisor.js'),
]);
let leadComposition: ReturnType<typeof loadLeadComposition> | undefined;

const packageDir = packageRoot(path.dirname(fileURLToPath(import.meta.url)));

function createCommandRegistry(rootDir: string, configuration: ParallixConfiguration, operatorReview = false): Record<string, Command> {
  const scope = createCliServiceScope(rootDir, configuration);
  const { withGraph, openServices } = scope;
  const active = createActiveCommand((request, options) => activeWorkflow([...request.args], options));
  const config = createConfigCommand((request, options) => configWorkflow([...request.args], options));
  const diff = createDiffCommand((request, options) => diffWorkflow([...request.args], options));
  const resolveConflict = createResolveConflictCommand(async (request, options) => { await scope.withMissionFactories(missionServicesFn => resolveConflictWorkflow([...request.args], { ...options, missionServicesFn })); });
  const setup = createSetupCommand(async (request, options) => {
    const { setupWizard } = await import('../adapters/review/setup-review.js');
    return setupWizard([...request.args], options);
  });
  const verify = createVerifyCommand((request, options) => verifyWorkflow([...request.args], options));
  const context: CliCommandContext = { rootDir, configuration, packageDir, scope, active, operatorReview, commands: () => registry };
  const configuredCommands: Record<string, Command> = {
    config,
    diff,
    'verify-env': startupPreflight,
    'resolve-conflict': resolveConflict,
    setup,
    'setup-review': async (args, options) => {
      const { default: setupReview } = await import('../adapters/cli/commands/setup-review.js');
      return setupReview(args, options);
    },
    verify,
    ...createAuthoringCommands(context), ...createLegacyCommands(context), ...createReadCommands(context), ...createLifecycleCommands(context),
  };
  const registry: Record<string, Command> = Object.fromEntries(["active", "recover", "config", "goal", "repro", "classification", "scope", "gate", "criterion", "mission", "depends", "nel", "checkpoint", "assign", "verdict", "resolve", "revoke-review", "revoke", "unassign", "diff", "history", "attach", "draft", "integrate", "cancel", "import-legacy", "migrate-legacy-adhoc-ids", "audit-legacy", "verify-env", "rebase", "resolve-conflict", "review", "setup", "setup-review", "stats", "github-publish-status", "status", "verify", "web", "ui"].map(name => [name, configuredCommands[name]]));
  registry.lead = (args: string[], options: Record<string, unknown> = {}) => withGraph(async services => {
    // Fleet supervision is unused by short CLI commands and autonomous review.
    const [{ createLeadSupervisorPort, leadRecoveryWorkspace }, { createLeadCommand }, { FRESH_SESSION_MARKER_PORT }] = await (leadComposition ??= loadLeadComposition());
    const forwards = new Set<Promise<unknown>>();
    const currentWork = services.currentWork;
    const launchRecovery: SupervisorPort['launchRecovery'] = async (request) => {
      fmt.log.info(`[lead] Starting fresh recovery agent for ${fmt.slug(request.missionId)} with a general diagnostic prompt`);
      let publication: ReturnType<typeof currentWorkPublication> = null;
      try {
        const { worktree, prompt } = leadRecoveryWorkspace(request);
        fmt.log.info(`[lead] Recovery prompt for ${fmt.slug(request.missionId)}:\n---\n${prompt}\n---`);
        const assigned = await services.mission?.store.load(missionId(request.missionId));
        const assignedAgent = assigned?.kind === 'found' ? assigned.mission.assignee ?? undefined : undefined;
        publication = currentWorkPublication({
          slug: request.missionId,
          operationId: `recovery-${Date.now()}`,
          phase: 'recovery',
          summary: `recovery agent working ${request.missionId} after ${request.attemptedOperation}`,
        });
        if (publication) { await currentWork.running(publication); }
        const launched = await agents.startAgent('execute', {
          configuration,
          prompt,
          worktree,
          agent: assignedAgent,
          slug: request.missionId,
          role: 'implementer',
          // Without this the launcher would resume the implementer session
          // that got stuck. Recovery is a new context by definition.
          sessionMarkerPort: FRESH_SESSION_MARKER_PORT,
        });
        const agent = launched?.agent;
        // A recovery agent spends tokens like any other launch. Recording it
        // on the mission's execute stage is what keeps the mission's usage
        // from under-reporting the work the supervisor caused.
        if (agent) {
          await recordStageStatsSafe('active', {
            stage: 'recovery',
            slug: request.missionId,
            rootDir: worktree,
            worktree,
            implementer: agent,
            result: launched?.result,
            sinceMs: stageLaunchSinceMs(launched?.result),
            model: resolveAgentModel(agent, worktree),
          });
        }
        fmt.log.info(`[lead] Recovery agent ${agent ?? 'with no reported family'} finished for ${fmt.slug(request.missionId)}; rechecking the board`);
        return `${agent ?? 'agent with no reported family'} ran in ${worktree}`;
      } catch (error) {
        fmt.log.fail(`[lead] Recovery agent for ${fmt.slug(request.missionId)} failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      } finally {
        if (publication) { await currentWork.ended(publication); }
      }
    };
    let result: number;
    try { result = await createLeadCommand(createLeadSupervisorPort(services, forwards, { rootDir, scope, active, registry, runPublicCli: run, launchRecovery }))(args); }
    finally { await Promise.allSettled(forwards); }
    if (result !== 0) {
      if (typeof options.exitFn === 'function') { options.exitFn(result); }
      else { throw new Error(`Lead exited with status ${result}`); }
    }
    return result;
  });
  ownWorkflowCli(registry, async () => attachWorkflowOperations(rootDir, configuration, await openServices(rootDir)));
  return registry;
}

/**
 * Bind the review verbs to the existing recorders. Composition owns the adapter
 * imports so the interface module stays free of them.
 */

/** Mission write services, or a clear error when the operator DB is unavailable. */

export function createRuntimeOptions(rootDir: string, configuration: ParallixConfiguration, operatorReview = false): Pick<MainOptions, 'commandFns' | 'ensureStandaloneGitRepoFn' | 'loadAliasesFn' | 'product' | 'runtime'> {
  return {
    commandFns: Object.fromEntries(Object.entries(createCommandRegistry(rootDir, configuration, operatorReview)).map(([name, command]) => [name, (args: string[], options: Record<string, unknown> = {}) => command(args, { ...options, configuration })])),
    runtime: configuration.runtime,
    ensureStandaloneGitRepoFn: ensureStandaloneGitRepo,
    loadAliasesFn: options => deriveAliases(loadStateMap(options)),
    product: { name: packageJson.name, version: packageJson.version },
  };
}

