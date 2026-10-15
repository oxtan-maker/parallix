/** Normalize provider-authored human corrections into the application's feedback port. */
import * as crypto from 'node:crypto';
import type { MissionStore } from '../../application/domain-ports.js';
import type { HumanFeedbackPort } from '../../application/ports/review-round.js';
import { WORKFLOW_AGENT_NAMES } from '../agents/agent-family-names.js';
import { CLASSIFIER_FORGEJO_USER } from './setup-review-repository.js';
import type { getComments, readToken } from './review-adapter.js';
import { VALID_EVENT_TYPES, type createEvent } from './review-events.js';
type ForgejoFeedbackComment = {
  readonly kind?: string;
  readonly id?: string;
  readonly user?: string;
  readonly isBot?: boolean;
  readonly created?: string;
  readonly updated?: string;
  readonly body?: string;
  readonly state?: string;
  readonly dismissed?: boolean;
  readonly location?: string;
  readonly reviewId?: string;
};

function isHumanAuthor(comment: ForgejoFeedbackComment, configuredAgents: ReadonlySet<string>): boolean {
  const author = (comment.user ?? '').trim().toLowerCase();
  return Boolean(author) && !comment.isBot && !configuredAgents.has(author) && !author.endsWith('[bot]');
}

function feedbackSource(comment: ForgejoFeedbackComment, index: number): string {
  const id = comment.id?.trim() || `legacy-${index}`;
  const revision = comment.updated?.trim() || comment.created?.trim() || '';
  const bodyHash = crypto.createHash('sha256').update(comment.body ?? '').digest('hex').slice(0, 16);
  return `forgejo:${comment.kind ?? 'comment'}:${id}:${revision}:${bodyHash}:${comment.location ?? ''}`;
}

function isRequestChanges(comment: ForgejoFeedbackComment): boolean {
  return (comment.state ?? '').trim().toUpperCase() === 'REQUEST_CHANGES';
}

function isApproval(comment: ForgejoFeedbackComment): boolean {
  return comment.kind === 'review' && (comment.state ?? '').trim().toUpperCase() === 'APPROVED';
}

interface HumanFeedbackDependencies {
  slug: string; branch: string; worktree: string; providerEnabled: boolean;
  missionStore: MissionStore | null; log: (_msg: string) => void; error: (_msg: string) => void;
  fetchComments: typeof getComments; tokenFor: typeof readToken; recordHumanNote: typeof createEvent;
}
export function composeHumanFeedback(dependencies: HumanFeedbackDependencies): HumanFeedbackPort {
  const { slug, branch, worktree, providerEnabled, missionStore, log, error, fetchComments, tokenFor, recordHumanNote } = dependencies;
  return {
    async reconcile(state) {
      if (!providerEnabled) { return null; }
      const identity = state.reviewer || state.implementer;
      const token = identity ? tokenFor(identity, { rootDir: worktree }) : null;
      if (!token) { return null; }
      const comments = await fetchComments(branch, token, { rootDir: worktree });
      if (!Array.isArray(comments)) { return null; }
      const seen = new Set<unknown>(Array.isArray(state.metadata.humanFeedbackSources) ? state.metadata.humanFeedbackSources : []);
      const configuredAgents = new Set([...WORKFLOW_AGENT_NAMES, CLASSIFIER_FORGEJO_USER, state.reviewer ?? '', state.implementer ?? ''].map(value => value.toLowerCase()).filter(Boolean));
      const normalized = comments.map((comment, index) => ({ comment, index }));
      // Only human review bodies and their inline comments are operator
      // corrections. Issue prose is discussion, never a workflow command.
      const feedback = normalized
        .filter(({ comment }) => (comment.kind === 'review' || comment.kind === 'inline-comment') && isHumanAuthor(comment, configuredAgents))
        .map(({ comment, index }) => {
          const requested = isRequestChanges(comment);
          return {
            source: feedbackSource(comment, index), author: comment.user || 'unknown',
            state: comment.dismissed ? 'dismissed' as const : 'current' as const,
            disposition: requested ? 'REQUEST_CHANGES' as const : null,
            approval: isApproval(comment), reason: comment.body || '',
            reviewId: comment.kind === 'inline-comment' ? comment.reviewId || comment.id || String(index) : comment.id || String(index),
            findings: requested ? [{ id: `human-${comment.id || index + 1}`, summary: comment.body || 'Operator requested changes' }] : [],
          };
        });
      const unseen = feedback.filter(item => !seen.has(item.source));
      // A current correction on an approved round is not handled yet (the
      // loop stops for `px revoke-review`), so neither its audit note nor its
      // source is recorded: both are durable and would hide it from a retry.
      const deferred = (item: typeof feedback[number]) => state.phase === 'approved' && item.disposition === 'REQUEST_CHANGES' && item.state === 'current';
      const newFeedback = unseen.filter(item => !deferred(item));
      const consumedSources = new Set([...seen, ...newFeedback.map(item => item.source)]);
      state.metadata.humanFeedbackSources = [...consumedSources];
      state.metadata.humanFeedbackHistory = feedback.map(item => ({ source: item.source, author: item.author, state: item.state, disposition: item.disposition, reason: item.reason }));
      for (const item of newFeedback) {
        await recordHumanNote(slug, VALID_EVENT_TYPES.HUMAN_NOTE, {
          content: item.reason, actor: item.author, round: state.round, phase: state.phase,
          followUpReference: `${item.source}; state=${item.state}`,
        }, { worktree, skipGit: true, missionStore, log, error });
      }
      const currentRequest = [...unseen].reverse().find(item => item.disposition === 'REQUEST_CHANGES' && item.state === 'current');
      if (currentRequest) {
        const related = unseen.filter(item => item.disposition === 'REQUEST_CHANGES' && item.state === 'current' && item.reviewId === currentRequest.reviewId);
        return { ...currentRequest, reason: related.map(item => item.reason).filter(Boolean).join('\n'), findings: related.flatMap(item => item.findings) };
      }
      return dismissedApprovalObservation(normalized, configuredAgents);
    },
  };
}

function dismissedApprovalObservation(normalized: readonly { comment: ForgejoFeedbackComment; index: number }[], configuredAgents: ReadonlySet<string>): Awaited<ReturnType<HumanFeedbackPort['reconcile']>> {

  // A dismissal is relevant only when the newest review decision is the
  // approval that would otherwise authorize this continuation. Older or
  // dismissed change requests are historical facts, not permanent stops.
  const latestReview = [...normalized].reverse().find(({ comment }) => comment.kind === 'review');
  if (latestReview && latestReview.comment.dismissed && isApproval(latestReview.comment) && isHumanAuthor(latestReview.comment, configuredAgents)) {
    // A dismissed approval remains the latest provider decision even
    // after its audit note has been consumed. It must stop this pass
    // every time; source de-duplication controls only event recording.
    return {
      source: feedbackSource(latestReview.comment, latestReview.index), author: latestReview.comment.user || 'unknown',
      state: 'dismissed', disposition: null, approval: true, reason: latestReview.comment.body || '', findings: [],
    };
  }
  return null;

}
