interface GateEntryRecord { key?: unknown; order?: number; after?: unknown; }

/** A single ordered gate command for one phase. */
export interface RepositoryGate {
  key: string;
  command: string;
  order: number;
  after?: string[];
  reuse?: 'never' | 'clean-tree';
}

/** The complete declared gate surface for a repository. */
export interface RepositoryGates {
  preHandoff: RepositoryGate[];
  preReview: RepositoryGate[];
  preIntegration: RepositoryGate[];
}

/** @param {unknown} raw */
export function normalizeGates(raw: unknown): RepositoryGate[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  /** @type {RepositoryGate[]} */
  const gates: RepositoryGate[] = [];
  for (const entry of raw as unknown[]) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const key = record.key;
    const command = record.command;
    if (typeof key !== 'string' || !key) {
      continue;
    }
    if (typeof command !== 'string' || !command.trim()) {
      continue;
    }
    const order = typeof record.order === 'number' ? record.order : 0;
    const after = Array.isArray(record.after) && record.after.every((dependency: unknown) => typeof dependency === 'string' && dependency)
      ? record.after as string[]
      : undefined;
    const reuse: RepositoryGate['reuse'] = record.reuse === 'clean-tree' ? 'clean-tree' : 'never';
    gates.push({ key, command, order, ...(after ? { after } : {}), reuse });
  }
  return gates.sort((a, b) => a.order - b.order);
}

/**
 * Structural validation for the `adapters.gates` object. Returns a list of
 * human-readable issues; an empty list means the shape is acceptable.
 * @param {unknown} adapters
 */
export function validateRepositoryGates(adapters: unknown): string[] {
  const issues: string[] = [];
  if (!adapters || typeof adapters !== 'object') {
    return issues;
  }
  const gatesValue = (adapters as { gates?: unknown }).gates;
  const gates = gatesValue as Record<string, unknown>;
  if (gates === undefined) {
    return issues;
  }
  if (typeof gates !== 'object' || Array.isArray(gates)) {
    return ['adapters.gates must be an object'];
  }
  // adapters.gates declares additionalProperties:false in the workflow schema;
  // reject any key it does not recognise so a typo (e.g. requireIntegration)
  // fails validation instead of silently disappearing.
  const KNOWN_GATE_KEYS = new Set(['maxConcurrent', 'requirePreIntegration', 'parallel', 'preHandoff', 'preReview', 'preIntegration']);
  for (const key of Object.keys(gates)) {
    if (!KNOWN_GATE_KEYS.has(key)) {
      issues.push(`adapters.gates.${key} is not a recognised key (allowed: ${[...KNOWN_GATE_KEYS].join(', ')})`);
    }
  }
  if (gates.requirePreIntegration !== undefined && typeof gates.requirePreIntegration !== 'boolean') {
    issues.push('adapters.gates.requirePreIntegration must be a boolean');
  }
  validateMaxConcurrent(gates.maxConcurrent, issues);
  validateParallelism(gates.parallel, issues);
  const PHASE_LABELS = {
    preHandoff: 'pre-handoff',
    preReview: 'pre-review',
    preIntegration: 'pre-integration',
  } as const;
  for (const [phase, expected] of Object.entries(PHASE_LABELS)) {
    const value = gates[phase];
    if (value === undefined) {
      continue;
    }
    if (!Array.isArray(value)) {
      issues.push(`adapters.gates.${phase} must be an array (${expected} gates)`);
      continue;
    }
    (value as unknown[]).forEach((entry, index) => validateGateEntry(entry, phase, index, issues));
    validateGateDependencies(value as GateEntryRecord[], phase, issues);
  }
  return issues;
}

function validateMaxConcurrent(value: unknown, issues: string[]): void {
  if (value !== undefined && (!Number.isInteger(value) || (value as number) < 1)) {
    issues.push('adapters.gates.maxConcurrent must be a positive integer');
  }
}

function validateParallelism(parallel: unknown, issues: string[]): void {
  if (parallel !== undefined) {
    if (!parallel || typeof parallel !== 'object' || Array.isArray(parallel)) {
      issues.push('adapters.gates.parallel must be an object');
    } else {
      for (const [phase, limit] of Object.entries(parallel as Record<string, unknown>)) {
        if (!['preHandoff', 'preReview', 'preIntegration'].includes(phase)) {
          issues.push(`adapters.gates.parallel.${phase} is not a recognised phase`);
        } else if (!Number.isInteger(limit) || (limit as number) < 2) {
          issues.push(`adapters.gates.parallel.${phase} must be an integer of at least 2`);
        }
      }
    }
  }
}

function validateGateEntry(rawEntry: unknown, phase: string, index: number, issues: string[]): void {
  const entry = rawEntry as Record<string, unknown>;
  if (!entry || typeof entry !== 'object') {
    issues.push(`adapters.gates.${phase}[${index}] must be an object`);
    return;
  }
  if (typeof entry.key !== 'string' || !entry.key) {
    issues.push(`adapters.gates.${phase}[${index}].key must be a non-empty string`);
  }
  if (typeof entry.command !== 'string' || !entry.command.trim()) {
    issues.push(`adapters.gates.${phase}[${index}].command must be a non-empty string`);
  }
  if (entry.order !== undefined && typeof entry.order !== 'number') {
    issues.push(`adapters.gates.${phase}[${index}].order must be a number`);
  }
  if (entry.after !== undefined && (!Array.isArray(entry.after) || entry.after.some((dependency: unknown) => typeof dependency !== 'string' || !dependency))) {
    issues.push(`adapters.gates.${phase}[${index}].after must be an array of non-empty gate keys`);
  }
  if (entry.reuse !== undefined && entry.reuse !== 'never' && entry.reuse !== 'clean-tree') {
    issues.push(`adapters.gates.${phase}[${index}].reuse must be "never" or "clean-tree"`);
  }

}

function validateGateDependencies(value: GateEntryRecord[], phase: string, issues: string[]): void {
  const seen = new Set<string>();
  for (const entry of [...value].sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0))) {
    if (typeof entry?.key !== 'string') { continue; }
    if (seen.has(entry.key)) { issues.push(`adapters.gates.${phase} has duplicate gate key "${entry.key}"`); }
    if (Array.isArray(entry.after)) {
      for (const dependency of entry.after) {
        if (typeof dependency === 'string' && !seen.has(dependency)) {
          issues.push(`adapters.gates.${phase} gate "${entry.key}" must depend on an earlier gate, not "${dependency}"`);
        }
      }
    }
    seen.add(entry.key);
  }
}
