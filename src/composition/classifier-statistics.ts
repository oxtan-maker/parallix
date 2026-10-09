import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { ClassifierStatisticsReadPort } from '../application/ports/review-classification-telemetry.js';
import { initOperatorState } from '../adapters/sqlite/adapter-factory.js';
import { SqliteReviewClassificationStore } from '../adapters/sqlite/review-classification-store.js';
import { SqliteClassifierStatisticsReader } from '../adapters/sqlite/classifier-statistics-reader.js';
import { resolveCanonicalRepositoryId } from '../adapters/git/repository-identity.js';
import { SqliteUsageRepository } from '../adapters/sqlite/usage-repository.js';

/** Composition wires adapters; SQL and query policy stay behind the typed read port. */
export async function createClassifierStatisticsReader(rootDir: string, configuration?: ParallixConfiguration): Promise<ClassifierStatisticsReadPort> {
  const { db } = await initOperatorState({ configuration });
  return new SqliteClassifierStatisticsReader(db, new SqliteReviewClassificationStore(db),
    String(resolveCanonicalRepositoryId(rootDir)), new SqliteUsageRepository(db));
}
