// Repository gate plan reading.
//
// The gate plan is what a repository declares in `workflow.config.json` under
// `adapters.gates`. `repository-gates.ts` remains the public adapter facade;
// this internal read-side module keeps that execution owner below the source
// file cap while giving execution and observation one fail-closed plan read.
import { normalizeGates, type RepositoryGate, type RepositoryGates } from './repository-gate-schema.js';
import { loadWorkflowConfig, validateWorkflowConfig } from './product-config.js';

/** Configuration phase that names one declared gate list. */
export type GatePlanPhase = 'preHandoff' | 'preReview' | 'preIntegration';

interface GateConfiguration {
  preHandoff?: unknown; preReview?: unknown; preIntegration?: unknown;
  requirePreIntegration?: unknown; parallel?: Partial<Record<GatePlanPhase, number | 'unlimited'>>;
}

const EMPTY_GATES: RepositoryGates = {
  preHandoff: [],
  preReview: [],
  preIntegration: [],
};

/** One fail-closed read shared by gate execution and observation. */
function loadGateConfiguration(rootDir: string): GateConfiguration | null {
  const declared = loadWorkflowConfig(rootDir || process.cwd());
  if (!declared.found) { return null; }
  const issues = declared.parseError ? [] : validateWorkflowConfig(declared.config);
  if (declared.parseError || issues.length > 0) {
    const detail = issues.length > 0 ? `: ${issues.join('; ')}` : '';
    throw new Error(`Workflow configuration ${declared.configPath} is unreadable${detail}`);
  }
  return (declared.config as { adapters?: { gates?: GateConfiguration } }).adapters?.gates ?? null;
}

/** The declared list for one phase of an already read configuration object. */
function declaredPhaseGateList(gates: GateConfiguration | null, phase: GatePlanPhase): RepositoryGate[] {
  return gates && typeof gates === 'object' && Array.isArray(gates[phase]) ? normalizeGates(gates[phase]) : [];
}

/**
 * Read the declared gates for a single phase from the effective workflow
 * configuration. Omitted configuration yields an empty list, so an
 * unconfigured repository runs no gate for that phase.
 */
export function loadPhaseGates(rootDir: string, phase: GatePlanPhase): RepositoryGate[] {
  return declaredPhaseGateList(loadGateConfiguration(rootDir), phase);
}

/**
 * Whether the repository opts into the TASK-2300 mandatory-gate invariant at
 * the integration boundary. Defaults to false so an unconfigured repository
 * completes the integration path with no lifecycle gate (mission task-2457
 * success criterion 1). A repository that wants fail-closed sets
 * `adapters.gates.requirePreIntegration: true` in its workflow.config.json.
 */
export function loadRequirePreIntegration(rootDir: string): boolean {
  const gates = loadGateConfiguration(rootDir);
  return typeof gates === 'object' && gates !== null && gates.requirePreIntegration === true;
}

/** Load all three phase gate lists at once. */
export function loadRepositoryGates(rootDir: string): RepositoryGates {
  const gates = loadGateConfiguration(rootDir);
  if (!gates || typeof gates !== 'object') {
    return { ...EMPTY_GATES };
  }
  return {
    preHandoff: declaredPhaseGateList(gates, 'preHandoff'),
    preReview: declaredPhaseGateList(gates, 'preReview'),
    preIntegration: declaredPhaseGateList(gates, 'preIntegration'),
  };
}

/** Read a phase's opt-in concurrency limit; serial is the default. */
export function loadPhaseGateParallelism(rootDir: string, phase: GatePlanPhase): number {
  const parallel = loadGateConfiguration(rootDir)?.parallel?.[phase];
  if (parallel === 'unlimited') { return Infinity; }
  return Number.isInteger(parallel) && (parallel as number) >= 2 ? parallel as number : 1;
}
