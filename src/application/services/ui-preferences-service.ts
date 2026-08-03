import type { UIPreferenceEntry, UIPreferencesRepository } from '../ports/operator-preferences.js';

/**
 * Application boundary for UI preferences.
 *
 * Preferences are persisted through the checked SQLite repository and survive
 * application restart. No in-memory or JSON fallback exists in production.
 *
 * Maps to ADR 0053 classification: `opaque-operator-setting` (technical
 * persistence metadata, not a domain entity).
 */
export class UIPreferencesService {
  private readonly repository: UIPreferencesRepository;

  constructor(repository: UIPreferencesRepository) {
    this.repository = repository;
  }

  /**
   * Get the current value for a preference key.
   * Returns `null` when the key has no stored value.
   */
  async get(key: string): Promise<string | null> {
    const entry = await this.repository.findByKey(key);
    return entry?.value ?? null;
  }

  /**
   * Set a preference value. Updates the stored entry or creates it.
   * The updatedAt timestamp is set to the current ISO timestamp.
   */
  async set(key: string, value: string): Promise<void> {
    const entry: UIPreferenceEntry = {
      key,
      value,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.save(entry);
  }

  /**
   * Get all stored preferences.
   * Returns an empty array when no preferences exist.
   */
  async getAll(): Promise<readonly UIPreferenceEntry[]> {
    return this.repository.findAll();
  }

  /**
   * Delete a preference by key.
   */
  async delete(key: string): Promise<void> {
    await this.repository.deleteByKey(key);
  }

  /**
   * Clear all preferences.
   */
  async clear(): Promise<void> {
    await this.repository.clear();
  }
}
