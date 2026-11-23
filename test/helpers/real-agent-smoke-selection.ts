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

/** Disposable pi route backed by the kub2 llama.cpp server (PX-0076). */
export interface Kub2SmokeRoute {
  readonly provider: string;
  readonly model: string;
}

interface SmokeSelectionOptions {
  readonly explicitAgent?: string | null;
  readonly explicitModel?: string | null;
  readonly configuredCustomModel?: string | null;
  readonly configuredCustomRunner: string;
  /** Resolves the kub2 route when its provider is configured and reachable; null otherwise. */
  readonly resolveKub2Route?: () => Promise<Kub2SmokeRoute | null>;
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
  /** Pi provider the disposable settings must pin; set only on the kub2 route. */
  readonly piProvider?: string;
  readonly reason: 'explicit-override' | 'kub2-pi' | 'custom-admitted' | 'custom-saturated-codex' | 'custom-saturated-codex-unavailable';
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

const KUB2_PROVIDER = 'gemma-kub2';
const KUB2_CAPACITY = 2;
const KUB2_REACHABILITY_TIMEOUT_MS = 3000;

/** Pi writes its JSON files with trailing commas, which JSON.parse rejects. */
export function parsePiJson(raw: string): any {
  return JSON.parse(raw.replace(/,\s*([\]}])/g, '$1'));
}

/**
 * The kub2 route exists only when the operator's pi models.json declares the
 * gemma-kub2 provider and its endpoint answers GET /models. The check never
 * runs inference, and any miss returns null so selection falls through.
 */
export async function resolveKub2SmokeRoute(
  piAgentHome: string,
  fetchEndpoint: typeof fetch = fetch,
  timeoutMs = KUB2_REACHABILITY_TIMEOUT_MS,
): Promise<Kub2SmokeRoute | null> {
  try {
    const modelsPath = path.join(piAgentHome, 'models.json');
    if (!fs.existsSync(modelsPath)) return null;
    const provider = parsePiJson(fs.readFileSync(modelsPath, 'utf8')).providers?.[KUB2_PROVIDER];
    const model = provider?.models?.[0]?.id;
    if (typeof provider?.baseUrl !== 'string' || typeof model !== 'string' || !model) return null;
    const response = await fetchEndpoint(`${provider.baseUrl.replace(/\/+$/, '')}/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok ? { provider: KUB2_PROVIDER, model } : null;
  } catch {
    return null;
  }
}

/**
 * The kub2 route owns a lease pool of two slots that never touches the
 * operator or the shared smoke admission state: a dedicated lease home plus a
 * disposable policy directory whose workflow.config.json carries the capacity,
 * so adapters.agents.maxConcurrentCustom is neither read nor changed.
 */
export function configureKub2SmokeAdmission(
  environment: NodeJS.ProcessEnv = process.env,
  temporaryRoot = os.tmpdir(),
  uid: number | string = process.getuid?.() ?? 'user',
): { readonly admissionHome: string; readonly policyRoot: string } {
  const explicit = environment.PARALLIX_E2E_CUSTOM_ADMISSION_HOME?.trim();
  const admissionHome = explicit
    ? path.resolve(explicit)
    : path.join(temporaryRoot, `parallix-smoke-kub2-admission-${uid}`);
  const policyRoot = path.join(temporaryRoot, `parallix-smoke-kub2-policy-${uid}`);
  fs.mkdirSync(admissionHome, { recursive: true });
  fs.mkdirSync(policyRoot, { recursive: true });
  const policy = `${JSON.stringify({ adapters: { agents: { maxConcurrentCustom: KUB2_CAPACITY } } })}\n`;
  const policyPath = path.join(policyRoot, 'workflow.config.json');
  if (!fs.existsSync(policyPath) || fs.readFileSync(policyPath, 'utf8') !== policy) {
    const staged = `${policyPath}.${process.pid}`;
    fs.writeFileSync(staged, policy);
    fs.renameSync(staged, policyPath);
  }
  environment.PARALLIX_CUSTOM_ADMISSION_HOME = admissionHome;
  environment.PARALLIX_CUSTOM_ADMISSION_REPOSITORY = policyRoot;
  return { admissionHome, policyRoot };
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
 * Decide once, before the smoke lifecycle starts. After an explicit override,
 * a reachable kub2 route is chosen without touching production custom
 * admission or Codex. Otherwise a successful capacity probe
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

  const kub2 = await options.resolveKub2Route?.();
  if (kub2) {
    return {
      agent: 'custom', runner: 'pi', model: kub2.model, reasoningEffort: null,
      piProvider: kub2.provider, reason: 'kub2-pi',
    };
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

export { KUB2_CAPACITY, KUB2_PROVIDER, CODEX_SMOKE_MODEL, CODEX_SMOKE_REASONING_EFFORT };
