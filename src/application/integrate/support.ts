/**
 * Small, effect-free rules shared by the integrate workflow modules: the public
 * flag contract, task-path containment, bounce implementer resolution, and the
 * abort helper every step uses to stop a run after printing its diagnostic.
 */
import path from 'node:path';
import * as fmt from '../presentation/cli-format.js';
import type { IntegrateAgentsPort, IntegrateLandingPort } from '../ports/integrate-workflow.js';

export const VARIANT_B_AUTOMATION_SUMMARY = 'Variant B automation: Backlog task closeout, worktree-path rewrite, squash commit with hook-enforced validation, Forgejo sync-merged, and mission worktree cleanup.';

const REAL_AGENT_OPTION = '--real-agent';
const REAL_AGENT_MODEL_OPTION = '--real-agent-model';
const INTEGRATE_VALUE_OPTIONS = new Set([REAL_AGENT_OPTION, REAL_AGENT_MODEL_OPTION]);
const CODEX_REAL_AGENT_MODEL = 'gpt-5.6-luna';

export interface IntegrateRequest {
  readonly explicitSlug?: string;
  readonly dryRun: boolean;
  readonly noIntegrationGates: boolean;
  readonly noGate: boolean;
  readonly recoverLanded: boolean;
  readonly realAgent: string | null;
  readonly realAgentModel: string | null;
}

/** Parse only the public integrate flags before any preflight or gate work. */
export function parseIntegrateArgs(args: string[], environment: Record<string, string | undefined> = process.env): IntegrateRequest {
  const params: string[] = [];
  let dryRun = false;
  let noIntegrationGates = false;
  let noGate = false;
  let recoverLanded = false;
  let realAgent: string | null = null;
  let realAgentModel: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (INTEGRATE_VALUE_OPTIONS.has(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value.`);
      }
      if (arg === REAL_AGENT_OPTION) {
        if (realAgent !== null) {throw new Error('--real-agent may be supplied only once.');}
        realAgent = value;
      } else {
        if (realAgentModel !== null) {throw new Error('--real-agent-model may be supplied only once.');}
        realAgentModel = value;
      }
      index += 1;
      continue;
    }
    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--no-integration-gates') { noIntegrationGates = true; continue; }
    if (arg === '--no-gate') { noGate = true; continue; }
    if (arg === '--recover-landed') { recoverLanded = true; continue; }
    if (arg.startsWith('--')) {throw new Error(`Unknown integrate option: ${arg}`);}
    params.push(arg);
  }

  if ((realAgent === null) !== (realAgentModel === null)) {
    throw new Error('--real-agent and --real-agent-model must be supplied together.');
  }
  if (realAgent !== null && realAgent !== 'codex') {
    throw new Error(`Unsupported real agent "${realAgent}". Supported value: codex.`);
  }
  if (realAgent === 'codex' && realAgentModel !== CODEX_REAL_AGENT_MODEL) {
    throw new Error(`Unsupported Codex real-agent model "${realAgentModel}". Supported value: ${CODEX_REAL_AGENT_MODEL}.`);
  }
  if (noIntegrationGates && environment.PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS !== '1') {
    throw new Error('--no-integration-gates is rejected: final integration gates are mandatory.');
  }
  return { explicitSlug: params[0], dryRun, noIntegrationGates, noGate, recoverLanded, realAgent, realAgentModel };
}

/** Resolve a task file into the integration checkout without escaping either worktree. */
export function resolveIntegrationTaskPath(rawTaskFile: string | undefined, missionWorktree: string | null | undefined, baseWorktree: string | null | undefined): string | null {
  if (!rawTaskFile) { return ''; }
  if (!baseWorktree) { return null; }
  if (missionWorktree) {
    const relative = path.relative(missionWorktree, rawTaskFile);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) { return path.join(baseWorktree, relative); }
  }
  const baseRelative = path.relative(baseWorktree, rawTaskFile);
  return !baseRelative.startsWith('..') && !path.isAbsolute(baseRelative) ? rawTaskFile : null;
}

/** The `task-N` family a suffixed working slug belongs to (`task-12-modern` → `task-12`). */
export function baseTaskSlug(slug: string): string {
  const match = slug.match(/^(task-\d+)/i);
  return match ? match[1].toLowerCase() : slug;
}

/** Agent seams a bounce launches through; injected by tests, defaulted to the agents port. */
export interface BounceSeams {
  startAgentFn: IntegrateAgentsPort['startAgent'];
  transitionTaskFn: (_slug: string, _status: string) => unknown;
  applyAgentFallbackFn: IntegrateAgentsPort['applyAgentFallback'];
  selectAgentFn?: IntegrateAgentsPort['selectAgent'];
  workflowLauncherStatusFn?: IntegrateAgentsPort['workflowLauncherStatus'];
}

/**
 * Name the implementer a bounce should launch.
 *
 * Both `px integrate` bounces — the squash-commit hook failure and the
 * integration-gate failure — resolve the same way, so the chain lives once:
 * the task's own assignee, then the role's configured agent, then a launcher
 * probe. F3: only trust a launcher that reports itself supported; an absent
 * launcher returns `{ agent: '', supported: false }`, so name an agent only
 * when the probe confirms a healthy, supported family. An empty result means
 * strand rather than launch with an empty agent identity.
 */
export function resolveBounceImplementer(
  taskAssignee: string | null,
  rootDir: string,
  fns: Pick<BounceSeams, 'selectAgentFn' | 'workflowLauncherStatusFn'>,
): string {
  const implementer = taskAssignee || (fns.selectAgentFn ? fns.selectAgentFn('act-on-review') : '');
  if (implementer) { return implementer; }
  if (!fns.workflowLauncherStatusFn) { return ''; }
  const status = fns.workflowLauncherStatusFn(taskAssignee ?? '', rootDir);
  return status?.supported ? (status.agent ?? '') : '';
}

/** Print the blocking diagnostic and return the abort signal for the caller to throw. */
export function abortWith(landing: IntegrateLandingPort, ...messages: string[]): Error {
  messages.forEach(message => fmt.log.fail(message));
  return landing.createAbort();
}
