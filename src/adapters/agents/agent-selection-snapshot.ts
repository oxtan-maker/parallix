import { agentFamily, type AgentAvailability, type AgentFamily, type AgentSelectionSnapshot, type StepSelectionPolicy } from '../../domain/agents.js';
import type { AgentSelectionSnapshotPort } from '../../application/domain-ports.js';
import { AgentBlockService, parseAgentBlockUntil } from '../../application/services/agent-block-service.js';
import type { AgentBlocklistRepository } from '../../application/ports/agent-blocklist.js';
import { readAgentConfig, type AgentConfig } from './agent-config.js';
import { workflowLauncherStatus } from './launcher-selection.js';

type LauncherStatus = { supported: boolean; detail?: string; health?: string; reason?: string };

export interface AgentSelectionSnapshotAdapterOptions {
  readonly blocklistRepo: AgentBlocklistRepository;
  readonly knownAgentFamilies: readonly AgentFamily[];
  readonly readConfig?: () => AgentConfig | null;
  readonly launcherStatus?: (_family: string) => LauncherStatus;
  readonly now?: () => number;
}

function policy(value: any, fallback: readonly AgentFamily[]): StepSelectionPolicy {
  const eligible = Array.isArray(value?.eligible)
    ? value.eligible.map((name: string) => agentFamily(name))
    : [...fallback];
  return {
    eligible,
    strategy: value?.selection === 'weighted' ? 'weighted' : 'random',
    ...(value?.weights && typeof value.weights === 'object' ? { weights: value.weights } : {}),
  };
}

/**
 * Materializes the effectful selection inputs once. Runtime blocks are read
 * exclusively from the SQLite blocklist repository; configuration contributes
 * static step policy only and is never consulted for block decisions.
 */
export class SqliteAgentSelectionSnapshotAdapter implements AgentSelectionSnapshotPort {
  private readonly blocklistRepo: AgentBlocklistRepository;
  private readonly knownAgentFamilies: readonly AgentFamily[];
  private readonly readConfig: () => AgentConfig | null;
  private readonly launcherStatus: (_family: string) => LauncherStatus;
  private readonly now: () => number;

  constructor(options: AgentSelectionSnapshotAdapterOptions) {
    this.blocklistRepo = options.blocklistRepo;
    this.knownAgentFamilies = options.knownAgentFamilies;
    this.readConfig = options.readConfig ?? (() => readAgentConfig());
    this.launcherStatus = options.launcherStatus ?? workflowLauncherStatus;
    this.now = options.now ?? Date.now;
  }

  async load(): Promise<AgentSelectionSnapshot> {
    const capturedAtMs = this.now();
    const states = await new AgentBlockService(this.blocklistRepo).queryAll(this.knownAgentFamilies, capturedAtMs);
    const byFamily = new Map(states.map((state) => [state.agent, state]));
    const config = this.readConfig() ?? {};
    const agents: AgentAvailability[] = this.knownAgentFamilies.map((family) => {
      const state = byFamily.get(family)!;
      const launcher = this.launcherStatus(family);
      return {
        family,
        launcherAvailable: launcher.supported,
        launcherDetail: launcher.supported ? null : (launcher.reason ?? launcher.detail ?? launcher.health ?? null),
        block: !state.blocked ? { kind: 'none' }
          : state.until ? { kind: 'until', untilMs: parseAgentBlockUntil(state.until), reason: state.reason }
            : { kind: 'indefinite', reason: state.reason },
      };
    });
    const steps = Object.fromEntries(Object.entries(config.steps ?? {}).map(([step, value]) => [step, policy(value, this.knownAgentFamilies)]));
    return { capturedAtMs, defaultPolicy: policy(null, this.knownAgentFamilies), steps, agents };
  }
}
