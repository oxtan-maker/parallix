/**
 * Re-export shim: the review-persistence bindings moved to
 * `src/adapters/review/review-persistence.ts` (TASK-2550) so the CLI
 * integrate adapter can bind the automatic revbounce's review-resume without
 * an adapter→composition import. Existing composition importers keep this
 * path.
 */
export { bindReviewPersistence, reviewLoopBindings } from '../adapters/review/review-persistence.js';
