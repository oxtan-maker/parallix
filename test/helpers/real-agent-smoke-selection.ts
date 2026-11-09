import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CODEX_SMOKE_MODEL = 'gpt-6-luna';
const CODEX_SMOKE_REASONING_EFFORT = 'low';
const SUPPORTED_SMOKE_AGENTS = new Set(['custom', 'codex']);
const SUPPORTED_CUSTOM_RUNNERS = new Set(['opencode', 'pi']);

interface CapacityReservation {
  release(): void;
}

interface SmokeSelectionOptions {
  readonly explicitAgent?: string | null;
  readonly explicitModel?: string | null;
  readonly configuredCustomModel?: string | null;
  readonly configuredCustomRunner: string;
  readonly acquireCustomCapacity: () => Promise<CapacityReservation | null>;
  readonly codexEligible: () => boolean | Promise<boolean>;
  readonly codexBlocked: () => boolean | Promise<boolean>;
  readonly codexAvailable: () => boolean | Promise<boolean>;
}

export interface RealAgentSmokeSelection {
  readonly agent: 'custom' | 'codex';
  readonly runner: string;
  readonly model: string | null;
  readonly reasoningEffort: 'low' | null;
  readonly reason: 'explicit-override' | 'custom-admitted' | 'custom-saturated-codex' | 'custom-saturated-codex-unavailable';
}

/**
 * Real smoke processes share one lease-only database by default so the
 * production capacity probe observes concurrent smoke launches. Operator
 * admission state is never inherited; manual replays may name another
 * disposable directory through the E2E-only override.
 */
export function configureRealAgentSmokeAdmissionHome(
  environment: NodeJS.ProcessEnv = process.env,
  temporaryRoot = os.tmpdir(),
  uid: number | string = process.getuid?.() ?? 'user',
): string {
  const explicit = environment.PARALLIX_E2E_CUSTOM_ADMISSION_HOME?.trim();
  const admissionHome = explicit
    ? path.resolve(explicit)
    : path.join(temporaryRoot, `parallix-smoke-admission-${uid}`);
  fs.mkdirSync(admissionHome, { recursive: true });
  environment.PARALLIX_CUSTOM_ADMISSION_HOME = admissionHome;
  return admissionHome;
}

function validateExplicitSelection(agent: string, model: string | null): void {
  if (!SUPPORTED_SMOKE_AGENTS.has(agent)) {
    throw new Error(`Unknown real agent "${agent}"; expected custom or codex`);
  }
  if (agent === 'codex' && model !== CODEX_SMOKE_MODEL) {
    throw new Error(`Codex smoke override requires model ${CODEX_SMOKE_MODEL}`);
  }
}

function customSelection(
  options: SmokeSelectionOptions,
  reason: RealAgentSmokeSelection['reason'],
): RealAgentSmokeSelection {
  if (!SUPPORTED_CUSTOM_RUNNERS.has(options.configuredCustomRunner)) {
    throw new Error(
      `Unknown custom runner "${options.configuredCustomRunner}"; expected one of: ${[...SUPPORTED_CUSTOM_RUNNERS].join(', ')}`,
    );
  }
  return {
    agent: 'custom',
    runner: options.configuredCustomRunner,
    model: options.explicitModel ?? options.configuredCustomModel ?? null,
    reasoningEffort: null,
    reason,
  };
}

/**
 * Decide once, before the smoke lifecycle starts. A successful capacity probe
 * is released immediately; the real custom launch still performs normal
 * admission, so a later capacity change waits or fails on the production path
 * and can never trigger a cross-runner retry.
 */
export async function selectRealAgentSmoke(options: SmokeSelectionOptions): Promise<RealAgentSmokeSelection> {
  if (options.explicitAgent) {
    const model = options.explicitModel ?? options.configuredCustomModel ?? null;
    validateExplicitSelection(options.explicitAgent, model);
    if (options.explicitAgent === 'codex') {
      return {
        agent: 'codex', runner: 'codex', model: CODEX_SMOKE_MODEL,
        reasoningEffort: CODEX_SMOKE_REASONING_EFFORT, reason: 'explicit-override',
      };
    }
    return customSelection(options, 'explicit-override');
  }

  const reservation = await options.acquireCustomCapacity();
  if (reservation) {
    reservation.release();
    return customSelection(options, 'custom-admitted');
  }

  const eligible = await options.codexEligible();
  const blocked = eligible ? await options.codexBlocked() : true;
  const available = eligible && !blocked ? await options.codexAvailable() : false;
  if (eligible && !blocked && available) {
    return {
      agent: 'codex', runner: 'codex', model: CODEX_SMOKE_MODEL,
      reasoningEffort: CODEX_SMOKE_REASONING_EFFORT, reason: 'custom-saturated-codex',
    };
  }
  return customSelection(options, 'custom-saturated-codex-unavailable');
}

export { CODEX_SMOKE_MODEL, CODEX_SMOKE_REASONING_EFFORT };
