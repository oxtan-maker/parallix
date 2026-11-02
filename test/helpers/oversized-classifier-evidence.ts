import type { DecisionData, DecisionRequest } from '../../src/application/ports/decision.js';
import type { ReviewEvidencePort } from '../../src/application/ports/review-evidence.js';

/** Shared disposable population for the count regression and manual application benchmark. */
export function oversizedClassifierEvidence() {
  const paths = Array.from({ length: 348 }, (_, i) => `src/optional-${i}.ts`);
  const source = 'const value = 123;\n'.repeat(130);
  const header = 'diff --git a/src/optional-0.ts b/src/optional-0.ts\n--- a/src/optional-0.ts\n+++ b/src/optional-0.ts\n@@ -1 +1 @@\n-old\n+';
  const diff = header + 'repair value '.repeat(Math.ceil((1_275_250 - header.length) / 13)).slice(0, 1_275_250 - header.length);
  return { paths, source, diff, repository: {
    tree: async () => paths, source: async () => source, diff: async () => diff,
    missionInterdiff: async () => ({ diff, paths }), mainCommits: async () => [],
    changedPaths: async () => paths, mergeBase: async () => 'base', subjects: async () => [],
  } satisfies ReviewEvidencePort };
}

export function evidenceCharacters(value: DecisionData): number {
  if (typeof value === 'string') { return value.length; }
  if (!value || typeof value !== 'object') { return 0; }
  return Object.values(value).reduce((sum: number, item: DecisionData) => sum + evidenceCharacters(item), 0);
}

export function countingEvidenceBudget() {
  const counts = { fullState: 0, calls: 0, characters: 0, largestFullState: 0 };
  return { counts, measure: (request: DecisionRequest) => {
    counts.calls++;
    const characters = evidenceCharacters(request.state) + evidenceCharacters(request.questions as DecisionData);
    counts.characters += characters;
    if (request.state && typeof request.state === 'object' && 'finding' in request.state) {
      counts.fullState++; counts.largestFullState = Math.max(counts.largestFullState, characters);
    }
    return { requestBytes: characters, inputTokens: Math.ceil(characters / 4), contextTokens: Math.ceil(characters / 4),
      maxRequestBytes: 1_000_000, maxInputTokens: 32000, maxContextTokens: 30000, tokenizerModel: 'counting-double' };
  } };
}
