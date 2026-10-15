import { isBookkeepingPath } from '../../domain/integration-validation-policy.js';
import type { ReviewEvidencePort } from '../ports/review-evidence.js';

/** One recorded green integration validation: the hooks that passed at a revision, and when. */
export interface RecordedValidation {
  readonly sha: string;
  readonly baseline?: string;
  readonly hooks: readonly string[];
  readonly recordedAt: string;
}

/** How the candidate relates to the revision a validation ran against. */
export type GateFactRelation = 'same' | 'backlog-only' | 'rebase-only' | 'code-changed';

export type GateFactRejection = 'no-fact' | 'fact-after-round-start' | 'gate-not-validated' | 'code-after-validated-sha' | 'relation-unavailable';

/** The recorded execution fact a repair packet may cite as authoritative. */
export interface GateFact {
  readonly gate: string;
  readonly validationSha: string;
  readonly recordedAt: string;
  readonly candidate: string;
  readonly relation: Exclude<GateFactRelation, 'code-changed'>;
}

export type GateFactResult = { readonly admitted: true; readonly fact: GateFact } | { readonly admitted: false; readonly reason: GateFactRejection };

/** Paths of a stable mission interdiff which are not Backlog task records. */
export function substantiveInterdiffPaths(paths: readonly string[]): readonly string[] {
  return paths.filter(path => !isBookkeepingPath(path));
}

/** The manifest or lock file without its own package version, so only a root version bump compares equal. */
function withoutRootVersion(path: string, source: string): string | null {
  try {
    const json = JSON.parse(source) as { version?: unknown; packages?: Record<string, { version?: unknown }> };
    delete json.version;
    if (path === 'package-lock.json' && json.packages?.['']) { delete json.packages[''].version; }
    return JSON.stringify(json);
  } catch { return null; }
}

/** True when both revisions hold the same manifest or lock file apart from the root package's version. */
async function sameApartFromRootVersion(path: string, validated: string, candidate: string, repository: ReviewEvidencePort): Promise<boolean> {
  if (path !== 'package.json' && path !== 'package-lock.json') { return false; }
  const [before, after] = await Promise.all([repository.source(validated, path), repository.source(candidate, path)]);
  const left = withoutRootVersion(path, before);
  return left !== null && left === withoutRootVersion(path, after);
}

/** Relation of a validated revision to the candidate; a failed git read is `null`, never an admission. */
export async function relateToCandidate(validated: string, candidate: string, repository: ReviewEvidencePort,
  candidateBaseline: string | null, validatedBaseline: string | null): Promise<GateFactRelation | null> {
  if (validated === candidate) { return 'same'; }
  try {
    const changed = await repository.changedPaths(validated, candidate);
    if (changed.every(isBookkeepingPath)) { return 'backlog-only'; }
    if (!candidateBaseline || !validatedBaseline) { return null; }
    const interdiff = await repository.missionInterdiff({ baseline: validatedBaseline, revision: validated }, { baseline: candidateBaseline, revision: candidate }, { unbounded: true });
    const remaining = substantiveInterdiffPaths(interdiff.paths);
    const unexplained = await Promise.all(remaining.map(async path => !(await sameApartFromRootVersion(path, validated, candidate, repository))));
    return unexplained.some(Boolean) ? 'code-changed' : 'rebase-only';
  } catch { return null; }
}

/**
 * Newest validation which ran the failed gate before the round started and still covers the candidate.
 * Validations recorded after the round started may have been produced by the repair under review, so
 * they never count.
 */
export async function admitGateFact(input: {
  readonly validations: readonly RecordedValidation[];
  readonly gate: string | null;
  readonly roundStartedAt: string;
  readonly candidate: string;
  readonly relate: (_validatedSha: string, _validation: RecordedValidation) => Promise<GateFactRelation | null>;
}): Promise<GateFactResult> {
  if (!input.validations.length) { return { admitted: false, reason: 'no-fact' }; }
  const started = Date.parse(input.roundStartedAt);
  const before = input.validations.filter(v => Number.isFinite(started) && Date.parse(v.recordedAt) <= started);
  if (!before.length) { return { admitted: false, reason: 'fact-after-round-start' }; }
  const covering = before.filter(v => input.gate !== null && v.hooks.includes(input.gate));
  if (!covering.length) { return { admitted: false, reason: 'gate-not-validated' }; }
  let unavailable = false;
  for (const validation of [...covering].reverse()) {
    const relation = await input.relate(validation.sha, validation);
    if (relation === null) { unavailable = true; continue; }
    if (relation !== 'code-changed') {
      return { admitted: true, fact: { gate: input.gate!, validationSha: validation.sha, recordedAt: validation.recordedAt, candidate: input.candidate, relation } };
    }
  }
  return { admitted: false, reason: unavailable ? 'relation-unavailable' : 'code-after-validated-sha' };
}
