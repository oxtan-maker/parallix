import type { KnownRepository, RepositoryId } from '../../domain/repository.js';
import type { KnownRepositoryEntry, KnownRepositoriesRepository } from '../../adapters/sqlite/ports.js';

/**
 * Application boundary for KnownRepository observations.
 *
 * Repository identity is anchored by RepositoryId. A changed path or
 * rediscovered repository replaces observation metadata (path, lastAccessed)
 * without creating a second Mission identity.
 *
 * Maps to ADR 0053 classification: `database-owned-domain-state`.
 * Maps to domain invariant: `KnownRepository` in `src/domain/repository.ts`.
 */
export class KnownRepositoryService {
  private readonly repository: KnownRepositoriesRepository;

  constructor(repository: KnownRepositoriesRepository) {
    this.repository = repository;
  }

  /**
   * Save (or update) a KnownRepository observation.
   *
   * If an observation already exists for this RepositoryId, the path and
   * lastAccessed metadata are replaced. This is the canonical path-replacement
   * mechanism: rediscovering the same repository at a different filesystem
   * location updates the observation rather than creating a duplicate.
   */
  async saveObservation(
    repository: KnownRepository,
    path: string,
    lastAccessed: string,
  ): Promise<void> {
    const entry: KnownRepositoryEntry = {
      id: repository.id,
      path,
      lastAccessed,
    };
    await this.repository.save(entry);
  }

  /**
   * Load the current observation for a specific RepositoryId.
   * Returns `null` when no observation exists.
   */
  async loadObservation(id: RepositoryId): Promise<KnownRepositoryEntry | null> {
    const entry = await this.repository.findById(id);
    return entry ?? null;
  }

  /**
   * List all known repository observations, ordered by last access.
   * Returns an empty array when no observations exist.
   */
  async listAll(): Promise<readonly KnownRepositoryEntry[]> {
    return this.repository.findAll();
  }

  /**
   * Remove the observation for a specific RepositoryId.
   */
  async remove(id: RepositoryId): Promise<void> {
    await this.repository.deleteById(id);
  }
}
