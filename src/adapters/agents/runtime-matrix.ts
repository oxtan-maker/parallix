import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eligibleAgentsForStep, workflowLauncherStatus } from './agents.js';
import { packageRoot } from '../filesystem/package-root.js';
import { CONFIG_PATH as WORKFLOW_AGENT_CONFIG_PATH } from './agent-config.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

// Working-tree config/agents.json is authoritative (ADR 0044: the bundled copy
// under packageRoot is the fallback). Resolve the working-tree-first path so the
// matrix reports the same governing path that eligibleAgentsForStep() reads
// instead of always claiming the bundled package-root copy governs eligibility
// when an operator working-tree override is in effect.
function resolveConfigPath(configPath: string | undefined, existsSyncFn: typeof fs.existsSync): string {
  if (configPath) {
    return configPath;
  }
  const workingTree = path.resolve(process.cwd(), WORKFLOW_AGENT_CONFIG_PATH);
  return existsSyncFn(workingTree)
    ? workingTree
    : path.join(packageRoot(MODULE_DIR), WORKFLOW_AGENT_CONFIG_PATH);
}

interface LauncherStatusResult {
  supported: boolean;
  detail: string;
  health?: string;
  reason?: string;
}

interface BuildMatrixOptions {
  step?: string;
  eligibleAgentsForStepFn?: typeof eligibleAgentsForStep;
  workflowLauncherStatusFn?: typeof workflowLauncherStatus;
  configPath?: string;
  existsSyncFn?: typeof fs.existsSync;
}

export function launcherStatus(agent: string, options: { workflowLauncherStatusFn?: typeof workflowLauncherStatus } = {}): LauncherStatusResult {
  const { workflowLauncherStatusFn = workflowLauncherStatus } = options;
  return workflowLauncherStatusFn(agent);
}

export function buildAutonomousReviewMatrix(options: BuildMatrixOptions = {}): { step: string; agents: string[]; configPath: string; configPresent: boolean; launchers: Record<string, LauncherStatusResult> } {
  const {
    step = 'review',
    eligibleAgentsForStepFn = eligibleAgentsForStep,
    workflowLauncherStatusFn = workflowLauncherStatus,
    configPath: configPathOption,
    existsSyncFn = fs.existsSync
  } = options;

  const configPath = resolveConfigPath(configPathOption, existsSyncFn);
  const agents = eligibleAgentsForStepFn(step);
  const launchers: Record<string, LauncherStatusResult> = Object.fromEntries(
    agents.map((agent: string) => [agent, workflowLauncherStatusFn(agent)])
  );

  return {
    step,
    agents,
    configPath,
    configPresent: existsSyncFn(configPath),
    launchers
  };
}

export function formatMatrixSummary(matrix: { step: string; agents: string[]; configPath: string; configPresent: boolean; launchers: Record<string, LauncherStatusResult> }): string[] {
  const lines: string[] = [];

  lines.push(`Agent eligibility config: ${matrix.configPresent ? 'present' : 'missing'} (${matrix.configPath})`);
  lines.push(`Launcher support matrix (step: ${matrix.step}):`);
  for (const agent of matrix.agents) {
    const launcher = matrix.launchers[agent];
    const status = launcher.supported ? 'supported' : 'blocked';
    const health = launcher.health ? `, ${launcher.health}` : '';
    const reason = launcher.reason ? `; ${launcher.reason}` : '';
    lines.push(`  - ${agent}: ${status} (${launcher.detail}${health}${reason})`);
  }
  lines.push(
    'Reviewer is chosen at runtime from the eligible-and-supported pool, ' +
    'excluding the implementer (config-driven via agents.json; no hardcoded routing).'
  );

  return lines;
}

interface RunnableDiffFamilyOptions {
  step?: string;
  eligibleAgentsForStepFn?: typeof eligibleAgentsForStep;
  workflowLauncherStatusFn?: typeof workflowLauncherStatus;
}

export function runnableDifferentFamilyExists(implementer: string, options: RunnableDiffFamilyOptions = {}): boolean {
  const {
    step = 'review',
    eligibleAgentsForStepFn = eligibleAgentsForStep,
    workflowLauncherStatusFn = workflowLauncherStatus
  } = options;
  const agents = eligibleAgentsForStepFn(step);
  return agents.some((a: string) => a !== implementer && workflowLauncherStatusFn(a).supported);
}
