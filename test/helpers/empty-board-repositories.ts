import type { composeBoardProjection } from '../../src/composition/board-projection.js';

type BoardRepositories = Required<Pick<Parameters<typeof composeBoardProjection>[0], 'blocklistRepo' | 'historyRepo' | 'laneEventRepo' | 'usageRepo'>>;
const unexpectedWrite = async (): Promise<never> => { throw new Error('Unexpected board read-fixture write'); };

/** Fresh, read-only empty repository boundaries for board projection contracts. */
export function emptyBoardRepositories(): BoardRepositories {
  return {
    blocklistRepo: { findAll: async () => [], findByAgent: async () => undefined, save: unexpectedWrite, deleteByAgent: unexpectedWrite, clear: unexpectedWrite },
    historyRepo: { findAll: async () => [], findByType: async () => [], append: unexpectedWrite, clear: unexpectedWrite },
    laneEventRepo: { findAll: async () => [], findByMissionId: async () => [], findByRepositoryId: async () => [], append: unexpectedWrite, clear: unexpectedWrite },
    usageRepo: { findAll: async () => [], findWhere: async () => [] },
  };
}
