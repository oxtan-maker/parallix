/** Recovery keeps its launch identity but shares the implementation policy. */
export function agentPolicyStep(step: string): string {
  return step === 'act-on-review' ? 'active' : step;
}

export type AgentFamily = string & { readonly __brand: 'AgentFamily' };

/** A selector exhausted the eligible pool after applying its exclusions. */
export class AgentPoolExhaustedError extends Error {
  readonly kind = 'agent-pool-exhausted';
  readonly step: string;

  constructor(step: string, message: string) {
    super(message);
    this.step = step;
    this.name = 'AgentPoolExhaustedError';
  }
}

export function agentFamily(value: string): AgentFamily {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9-]*$/.test(normalized)) {
    throw new Error(`Invalid agent family: ${JSON.stringify(value)}`);
  }
  return normalized as AgentFamily;
}

export type AgentBlock =
  | { readonly kind: 'none' }
  | { readonly kind: 'indefinite'; readonly reason: string | null }
  | { readonly kind: 'until'; readonly untilMs: number; readonly reason: string | null };

export interface AgentAvailability {
  readonly family: AgentFamily;
  readonly launcherAvailable: boolean;
  readonly block: AgentBlock;
  /**
   * Why the launcher is unavailable (`launcher missing`, `launcher
   * probe-failed: exit 1`, …), when the probe reported a cause. Read-only
   * explanation for operators; selection never branches on it.
   */
  readonly launcherDetail?: string | null;
}

export interface StepSelectionPolicy {
  readonly eligible: readonly AgentFamily[];
  readonly strategy: string;
  readonly weights?: Readonly<Partial<Record<AgentFamily, number>>>;
}

/** All effectful eligibility inputs, resolved before the hot selection path. */
export interface AgentSelectionSnapshot {
  readonly capturedAtMs: number;
  readonly defaultPolicy: StepSelectionPolicy;
  readonly steps: Readonly<Record<string, StepSelectionPolicy>>;
  readonly agents: readonly AgentAvailability[];
}

export interface SelectionRequest {
  readonly preferred?: AgentFamily | null;
  /** Explicit operator override precedes launcher probing, but never blocks or exclusions. */
  readonly override?: AgentFamily | null;
  readonly excluded?: ReadonlySet<AgentFamily>;
  readonly random?: () => number;
}

export function blockedForMs(block: AgentBlock, nowMs: number): number {
  if (block.kind === 'none') { return 0; }
  if (block.kind === 'indefinite') { return Infinity; }
  return Math.max(0, block.untilMs - nowMs);
}

export function selectableAgents(
  snapshot: AgentSelectionSnapshot,
  step: string,
  excluded: ReadonlySet<AgentFamily> = new Set(),
): AgentFamily[] {
  const policy = selectionPolicy(snapshot, step);
  const available = new Map(snapshot.agents.map((agent) => [agent.family, agent]));
  return [...new Set(policy.eligible)].filter((family) => {
    const candidate = available.get(family);
    return candidate !== undefined
      && !excluded.has(family)
      && candidate.launcherAvailable
      && blockedForMs(candidate.block, snapshot.capturedAtMs) === 0;
  });
}

/** Invalid operator policy must never be treated as recoverable pool exhaustion. */
export class AgentSelectionPolicyError extends Error {
  readonly code = 'WORKFLOW_AGENT_POLICY_INVALID';
  constructor(step: string, detail: string) {
    super(`Invalid agent policy for step "${step}": ${detail}. Fix config/agents.json before retrying.`);
    this.name = 'AgentSelectionPolicyError';
  }
}

export function selectionPolicy(snapshot: AgentSelectionSnapshot, step: string): StepSelectionPolicy {
  const policyStep = agentPolicyStep(step);
  const configured = snapshot.steps[policyStep];
  if (policyStep === 'review' && (!configured || configured.eligible.length === 0)) {
    throw new AgentSelectionPolicyError(step, 'review requires explicit nonempty eligible families');
  }
  const policy = configured ?? snapshot.defaultPolicy;
  if (policy.strategy !== 'random' && policy.strategy !== 'weighted') {
    throw new AgentSelectionPolicyError(step, `unknown selection strategy ${JSON.stringify(policy.strategy)}`);
  }
  if (policy.strategy === 'weighted') {
    const weights = policy.weights ?? {};
    for (const family of policy.eligible) {
      const weight = weights[family];
      if (!Object.hasOwn(weights, family) || !Number.isFinite(weight) || weight! < 0) {
        throw new AgentSelectionPolicyError(step, `weight for ${family} must be an explicit finite nonnegative number`);
      }
    }
    if (!policy.eligible.some(family => weights[family]! > 0)) {
      throw new AgentSelectionPolicyError(step, 'weighted policy requires at least one positive weight');
    }
  }
  return policy;
}

function weightedPick(
  pool: readonly AgentFamily[],
  weights: Readonly<Partial<Record<AgentFamily, number>>>,
  random: () => number,
  step: string,
): AgentFamily {
  const positive = pool.filter(family => weights[family]! > 0);
  if (positive.length === 0) {
    throw new AgentPoolExhaustedError(step, `No available positive weight remains for step ${step} after blocks, availability and exclusions; zero-weight families cannot be drawn.`);
  }
  // Scale before summing: even multiple MAX_VALUE weights cannot overflow.
  const scale = Math.max(...positive.map(family => weights[family]!));
  if (positive.some(family => weights[family]! / scale === 0)) {
    throw new AgentSelectionPolicyError(step, 'positive weight range exceeds numeric sampling precision; reduce the weight range');
  }
  const total = positive.reduce((sum, family) => sum + weights[family]! / scale, 0);
  let cursor = random() * total;
  for (const family of positive) {
    cursor -= weights[family]! / scale;
    if (cursor < 0) { return family; }
  }
  return positive[positive.length - 1];
}

/** Pure and synchronous: no config, process, filesystem, or launcher probe access. */
export function selectAgent(
  snapshot: AgentSelectionSnapshot,
  step: string,
  request: SelectionRequest = {},
): AgentFamily {
  const policy = selectionPolicy(snapshot, step);
  if (request.override && policy.eligible.includes(request.override) && !request.excluded?.has(request.override)) {
    const candidate = snapshot.agents.find(agent => agent.family === request.override);
    if (candidate && blockedForMs(candidate.block, snapshot.capturedAtMs) === 0) { return request.override; }
  }
  const pool = selectableAgents(snapshot, step, request.excluded);
  if (request.preferred && pool.includes(request.preferred)) { return request.preferred; }
  const random = request.random ?? Math.random;
  if (policy.strategy === 'weighted') {
    return weightedPick(pool, policy.weights!, random, step);
  }
  if (pool.length === 0) { throw new AgentPoolExhaustedError(step, `No available agent for step ${step}`); }
  return pool[Math.floor(random() * pool.length)] as AgentFamily;
}
