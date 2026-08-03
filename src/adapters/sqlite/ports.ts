/** SQLite-private migration and import mechanics. */

/** A record of an applied migration in the ledger. */
export interface MigrationLedgerEntry {
  readonly id: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

export interface MigrationLedgerRepository {
  findAll(): Promise<readonly MigrationLedgerEntry[]>;
  findById(_id: string): Promise<MigrationLedgerEntry | undefined>;
}

/** Digest and metadata retained for each import source. */
export interface ImportRecord {
  readonly sourcePath: string;
  readonly digest: string;
  readonly importedCount: number;
  readonly skippedCount: number;
  readonly importedAt: string;
  readonly backupPath?: string;
}
