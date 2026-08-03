export interface KnownRepositoryEntry {
  readonly id: string;
  readonly path: string;
  readonly lastAccessed: string;
}

export interface KnownRepositoriesRepository {
  findAll(): Promise<readonly KnownRepositoryEntry[]>;
  findById(_id: string): Promise<KnownRepositoryEntry | undefined>;
  save(_entry: KnownRepositoryEntry): Promise<void>;
  deleteById(_id: string): Promise<void>;
  clear(): Promise<void>;
}
