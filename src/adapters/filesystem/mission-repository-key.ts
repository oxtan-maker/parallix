import { createHash } from 'node:crypto';
import { resolveCanonicalRepositoryRoot } from '../config/product-config.js';

/** Shared repository identity for mission terminal hosting and retrieval. */
export function missionRepositoryKey(worktree: string): string {
  return createHash('sha256').update(resolveCanonicalRepositoryRoot(worktree)).digest('hex').slice(0, 12);
}
