/** Read-only retained-state comparison; no provider calls, database access or research writes. */
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { GitReviewEvidence } from '../../src/adapters/review/review-evidence.js';
import { packArchivedState } from '../../src/application/review-classification/archived-packing.js';
import type { ReviewFindingEvidence } from '../../src/application/ports/review-evidence.js';
import type { DecisionData } from '../../src/application/ports/decision.js';

const corpusPath = process.argv[2];
if (!corpusPath) { throw new Error('Usage: replay-archived-packing.ts <retained generalization/corpus.json> [repository]'); }
const corpus = JSON.parse(await readFile(corpusPath, 'utf8')) as {
  id: string; cohort: string; input: ReviewFindingEvidence; baseline: { state: DecisionData } | null;
}[];
const repository = new GitReviewEvidence(process.argv[3] ?? process.cwd());
const normalize = (state: DecisionData) => {
  const result = structuredClone(state) as Record<string, DecisionData>;
  result.diff = (result.diff as string).replace(/^index [0-9a-f]+\.\.[0-9a-f]+/gm, 'index <blob>..<blob>');
  return result;
};
let count = 0, exact = 0, semantic = 0;
for (const sample of corpus.filter(row => row.cohort === '2650-development' && row.baseline)) {
  count++;
  const actual = (await packArchivedState(sample.input, repository)).request.state;
  if (isDeepStrictEqual(actual, sample.baseline!.state)) { exact++; }
  if (isDeepStrictEqual(normalize(actual), normalize(sample.baseline!.state))) { semantic++; }
  else { console.error('Mismatch:', sample.id); }
}
console.log(JSON.stringify({ count, exact, semantic, cosmeticDifference: 'Nine-character Git blob abbreviations' }));
if (count !== 42 || semantic !== 42) { process.exitCode = 1; }
