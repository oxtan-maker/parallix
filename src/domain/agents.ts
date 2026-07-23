export type AgentFamily = string & { readonly __brand: 'AgentFamily' };

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
}

export interface StepSelectionPolicy {
  readonly eligible: readonly AgentFamily[];
  readonly strategy: 'random' | 'weighted';
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
  const policy = snapshot.steps[step] ?? snapshot.defaultPolicy;
  const available = new Map(snapshot.agents.map((agent) => [agent.family, agent]));
  return policy.eligible.filter((family) => {
    const candidate = available.get(family);
    return candidate !== undefined
      && !excluded.has(family)
      && candidate.launcherAvailable
      && blockedForMs(candidate.block, snapshot.capturedAtMs) === 0;
  });
}

function weightedPick(
  pool: readonly AgentFamily[],
  weights: Readonly<Partial<Record<AgentFamily, number>>>,
  random: () => number,
): AgentFamily {
  const total = pool.reduce((sum, family) => sum + (weights[family] ?? 1), 0);
  let cursor = random() * total;
  for (const family of pool) {
    cursor -= weights[family] ?? 1;
    if (cursor <= 0) { return family; }
  }
  return pool[pool.length - 1] as AgentFamily;
}

/** Pure and synchronous: no config, process, filesystem, or launcher probe access. */
export function selectAgent(
  snapshot: AgentSelectionSnapshot,
  step: string,
  request: SelectionRequest = {},
): AgentFamily {
  const pool = selectableAgents(snapshot, step, request.excluded);
  if (request.preferred && pool.includes(request.preferred)) { return request.preferred; }
  if (pool.length === 0) { throw new Error(`No available agent for step ${step}`); }
  const policy = snapshot.steps[step] ?? snapshot.defaultPolicy;
  const random = request.random ?? Math.random;
  if (policy.strategy === 'weighted') {
    return weightedPick(pool, policy.weights ?? {}, random);
  }
  return pool[Math.floor(random() * pool.length)] as AgentFamily;
}
