import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error agents.js is CJS without type declarations
import { eligibleAgentsForStep, workflowLauncherStatus } from '../agents/agents.js';

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'agents.json');

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
    configPath = CONFIG_PATH,
    existsSyncFn = fs.existsSync
  } = options;

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
