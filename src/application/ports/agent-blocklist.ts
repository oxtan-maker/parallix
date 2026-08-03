export interface AgentBlockEntry {
  readonly agent: string;
  readonly blocked: boolean;
  readonly until?: string;
  readonly reason?: string;
}

export interface AgentBlocklistRepository {
  findAll(): Promise<readonly AgentBlockEntry[]>;
  findByAgent(_agent: string): Promise<AgentBlockEntry | undefined>;
  save(_entry: AgentBlockEntry): Promise<void>;
  deleteByAgent(_agent: string): Promise<void>;
  clear(): Promise<void>;
}
