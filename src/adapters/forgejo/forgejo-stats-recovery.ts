import type { ForgejoAsyncApiCall, ForgejoIssueComment, ForgejoPullRequest,
  ForgejoReview, ForgejoReviewComment } from './forgejo-types.js';
import { forgejoApiAsync } from './forgejo-api.js';
import { reconcileRecoveryEvidence, recoveryInstant, type StatsRecoveryCollection,
  type StatsRecoveryEvidence, type StatsRecoverySource } from '../../application/stats-recovery-evidence.js';

export interface ForgejoStatsRecoveryOptions {
  readonly apiCall?: ForgejoAsyncApiCall;
  readonly rootDir?: string;
  readonly pageSize?: number;
  readonly maxPages?: number;
  readonly configuration?: import('../../application/ports/configuration.js').ParallixConfiguration;
}

type RecoveryFailure = { source: StatsRecoverySource; detail: string };

interface PullCollectionContext {
  readonly repositoryId: string;
  readonly token: string | undefined;
  readonly api: ForgejoAsyncApiCall;
  readonly options: ForgejoStatsRecoveryOptions;
  readonly pageSize: number;
  readonly maxPages: number;
  readonly records: StatsRecoveryEvidence[];
  readonly failures: RecoveryFailure[];
}

/** Complete read-only repository collection; no endpoint in this adapter mutates Forgejo. */
export async function collectForgejoStatsRecovery(repositoryId: string, token: string | undefined,
  options: ForgejoStatsRecoveryOptions = {}): Promise<StatsRecoveryCollection> {
  const api = options.apiCall ?? forgejoApiAsync;
  const pageSize = options.pageSize ?? 50;
  const maxPages = options.maxPages ?? 100;
  const failures: RecoveryFailure[] = [];
  const pulls = await pages<ForgejoPullRequest>('forgejo-pr', '/pulls?state=all', token, api, options, pageSize, maxPages, failures);
  const records: StatsRecoveryEvidence[] = [];
  for (const pull of pulls) {
    await collectPullEvidence(pull, { repositoryId, token, api, options, pageSize, maxPages, records, failures });
  }
  return reconcileRecoveryEvidence(records, failures);
}

async function collectPullEvidence(pull: ForgejoPullRequest, context: PullCollectionContext): Promise<void> {
  const number = pull.number;
  if (!number) { return; }
  const { repositoryId, token, api, options, pageSize, maxPages, records, failures } = context;
  const links = { repositoryId, missionId: missionFromPull(pull), revision: pull.head?.sha ?? null, pullRequest: number };
  add(records, failures, 'forgejo-pr', `forgejo-pr:${pull.id ?? number}`, pull.created_at ?? pull.updated_at,
    links, `Forgejo GET /pulls/${number}`, { ...pull }, 'workflow-telemetry');
  const [reviews, issueComments] = await Promise.all([
    pages<ForgejoReview>('forgejo-review', `/pulls/${number}/reviews`, token, api, options, pageSize, maxPages, failures),
    pages<ForgejoIssueComment>('forgejo-issue-comment', `/issues/${number}/comments`, token, api, options, pageSize, maxPages, failures),
  ]);
  appendReviews(records, failures, number, links, reviews);
  appendIssueComments(records, failures, number, links, issueComments);
  const reviewComments = (await Promise.all(reviews.flatMap(review => review.id === undefined ? [] : [
    pages<ForgejoReviewComment>('forgejo-review-comment', `/pulls/${number}/reviews/${review.id}/comments`,
      token, api, options, pageSize, maxPages, failures),
  ]))).flat();
  appendReviewComments(records, failures, number, links, reviewComments);
}

function appendReviews(records: StatsRecoveryEvidence[], failures: RecoveryFailure[], number: number,
  links: StatsRecoveryEvidence['links'], reviews: readonly ForgejoReview[]): void {
  for (const review of reviews) {
    add(records, failures, 'forgejo-review', `forgejo-review:${review.id ?? `${number}:${review.submitted_at}`}`,
      review.submitted_at ?? review.created_at ?? review.updated_at,
      { ...links, revision: review.commit_id ?? links.revision }, `Forgejo GET /pulls/${number}/reviews`, { ...review }, 'review-decision');
  }
}

function appendIssueComments(records: StatsRecoveryEvidence[], failures: RecoveryFailure[], number: number,
  links: StatsRecoveryEvidence['links'], comments: readonly ForgejoIssueComment[]): void {
  for (const comment of comments) {
    add(records, failures, 'forgejo-issue-comment', `forgejo-issue-comment:${comment.id ?? `${number}:${comment.created_at}`}`,
      comment.created_at ?? comment.updated_at, links, `Forgejo GET /issues/${number}/comments`, { ...comment }, 'provider-comment');
  }
}

function appendReviewComments(records: StatsRecoveryEvidence[], failures: RecoveryFailure[], number: number,
  links: StatsRecoveryEvidence['links'], comments: readonly ForgejoReviewComment[]): void {
  for (const comment of comments) {
    add(records, failures, 'forgejo-review-comment', `forgejo-review-comment:${comment.id ?? `${number}:${comment.created_at}`}`,
      comment.created_at ?? comment.updated_at, links, `Forgejo GET /pulls/${number}/comments`, { ...comment }, 'provider-comment');
  }
}

async function pages<T>(source: StatsRecoverySource, endpoint: string, token: string | undefined,
  api: ForgejoAsyncApiCall, options: ForgejoStatsRecoveryOptions, pageSize: number, maxPages: number,
  failures: RecoveryFailure[]): Promise<T[]> {
  const output: T[] = [];
  const separator = endpoint.includes('?') ? '&' : '?';
  for (let page = 1; page <= maxPages; page += 1) {
    const path = `${endpoint}${separator}page=${page}&limit=${pageSize}`;
    const result = await api<T[]>('GET', path, token, undefined,
      { rootDir: options.rootDir, configuration: options.configuration });
    if (!result.ok || !Array.isArray(result.data)) {
      failures.push({ source, detail: `${path}: ${result.statusCode ?? result.error ?? 'unavailable'}` });
      break;
    }
    output.push(...result.data);
    if (result.data.length < pageSize) { break; }
  }
  return output;
}

function add(records: StatsRecoveryEvidence[], failures: RecoveryFailure[],
  source: StatsRecoverySource, identity: string, timestamp: string | undefined,
  links: StatsRecoveryEvidence['links'], provenance: string, raw: Readonly<Record<string, unknown>>,
  kind: StatsRecoveryEvidence['kind']): void {
  if (!timestamp) { failures.push({ source, detail: `${identity}: timestamp unavailable` }); return; }
  try {
    records.push({ identity, source, kind, observedAt: recoveryInstant(timestamp), links, provenance,
      collectionEra: 'historical-reconstruction', classification: 'direct-observation', raw });
  } catch (error) {
    failures.push({ source, detail: `${identity}: ${error instanceof Error ? error.message : String(error)}` });
  }
}

function missionFromPull(pull: ForgejoPullRequest): string | null {
  for (const value of [pull.head?.label, pull.head?.ref]) {
    const mission = value?.match(/(?:^|:)mission\/((?:task|px)-\d+(?:\.\d+)?)(?:$|\/)/)?.[1];
    if (mission) { return mission; }
  }
  return null;
}
