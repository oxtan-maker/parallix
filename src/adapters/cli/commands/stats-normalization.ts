// Compatibility helpers bind the canonical repository identity at the adapter.
import { resolveCanonicalRepositoryId } from '../../git/repository-identity.js';
import {
  normalizeStatsRow as normalizeRowWithRepository,
  canonicalizeStatsRow as canonicalizeRowWithRepository,
  type StatsRow, type NormalizeStatsRowOptions,
} from '../../../application/services/statistics-row.js';
export * from '../../../application/services/statistics-row.js';

export function normalizeStatsRow(row: StatsRow = {}, options: NormalizeStatsRowOptions = {}) {
  return normalizeRowWithRepository(row, {
    repo: row.repo || options.repo || resolveCanonicalRepositoryId(options.rootDir || process.cwd()),
  });
}

export function canonicalizeStatsRow(row: StatsRow, options: NormalizeStatsRowOptions = {}) {
  return canonicalizeRowWithRepository(row, {
    repo: row.repo || options.repo || resolveCanonicalRepositoryId(options.rootDir || process.cwd()),
  });
}
