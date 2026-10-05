/**
 * Review loop mechanisms.
 *
 * Binds the concrete review persistence, Backlog mirror, review provider,
 * agent launcher, artifact consumers, and pre-review Git/gate checks to the
 * typed ports in `src/application/ports/review-round.ts`. Every method reports
 * what its mechanism observed; the application loop in
 * `src/application/review-loop/` decides what happens next.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as fmt from '../../application/presentation/cli-format.js';
import { renderReviewLoopEvent } from './review-loop-presentation.js';
import { git, run } from '../git/git.js';
import { findMissionDir, resolveWorktree, missionBranchName, getPrimaryBranch } from '../filesystem/mission-utils.js';
import type { PullRequestReference } from '../../domain/review.js';
import { resolveTaskFile, getTaskImplementer, getTaskStatus, enforceTaskAssignee, transitionTask, reportTaskResolution } from '../backlog/backlog.js';
import { transitionVirtual } from '../config/state-map.js';
import { getPrStatus, readToken, getLatestReviewForPr, getComments, providerAvailable, resolveReviewUser, isProviderEnabled } from './review-adapter.js';
import { buildAutonomousReviewMatrix, formatMatrixSummary } from '../agents/runtime-matrix.js';
import { buildReviewPrompt, buildActOnReviewPrompt, buildCompactReviewPrompt, buildCompactActOnReviewPrompt } from './review-prompts.js';
import { ReviewState, readReviewState, writeReviewState, resetReviewState, persistReviewStateOrThrow, assertReviewStatePersisted } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import type {
  HandoffFacts, PreReviewGateFacts, PreReviewRebaseFacts, ProviderPollRequest, ReviewAgentLaunch, ReviewAgentPort, ReviewLoopPorts,
  ReviewLoopState, ReviewPromptFacts, ReviewProviderPort, StartReviewRound,
} from '../../application/ports/review-round.js';
import { workflowLauncherStatus, startAgent, eligibleAgentsForStep, selectAgent } from '../agents/agents.js';
import { WORKFLOW_AGENT_NAMES } from '../agents/agent-family-names.js';
import { rebaseBeforeReviewRound } from './rebase.js';
import { packageRoot } from '../filesystem/package-root.js';
import { resolveAgentModel } from '../config/product-config.js';
import { resolvePollIntervalMs, resolvePollTimeoutMs, pollForReview, pollForDisposition } from './review-polling.js';
import { buildMetadataFooter, resolveArtifactDir, consumeReviewerArtifacts, consumeImplementerArtifacts } from './review-artifacts.js';
import { pushReviewRef, isStaleInfoPushRejection, fetchReviewBranch } from '../forgejo/forgejo.js';
import { CONTINUE_SKIP_CHECK_TIMEOUT_MS, runPreReviewGate, gateFailureReason, hookFailureReason } from './review-gate-handling.js';
import { persistNormalizedPhaseRepair, recordStageStatsSafe, stageLaunchSinceMs, maybeUpdateGraphifyBeforeReview } from './review-agent-fallback.js';
import { openReviewRound } from './review-round-open.js';
import { createEvent, VALID_EVENT_TYPES } from './review-events.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The production review authority a composition root binds for one loop. */
export interface ReviewLoopBindings {
  readonly readReviewState?: (_slug: string, _worktree?: string, _store?: MissionStore | null) => Promise<ReviewState | null> | ReviewState | null;
  readonly writeReviewState?: typeof writeReviewState;
  readonly resetReviewState?: typeof resetReviewState;
  readonly consumeReviewerArtifacts?: typeof consumeReviewerArtifacts;
  readonly consumeImplementerArtifacts?: typeof consumeImplementerArtifacts;
  readonly missionStore?: MissionStore | null;
  readonly lifecycleService?: MissionLifecycleService | null;
  readonly performHandoffFn?: (_slug: string, _options: Record<string, unknown>) => Promise<unknown>;
  readonly onAgentLaunched?: (_agent: string, _phase: 'review' | 'review-response') => Promise<void> | void;
  readonly onAutonomousStop?: (_reason: string) => Promise<void> | void;
  readonly log?: (_msg: string) => void;
  readonly error?: (_msg: string) => void;
  readonly exit?: (_code: number) => void;
  /** Provider seams retained here so adapter contracts can exercise normalization. */
  readonly getComments?: typeof getComments;
  readonly readToken?: typeof readToken;
  readonly isProviderEnabled?: typeof isProviderEnabled;
  readonly createEvent?: typeof createEvent;
}

/** The per-request knobs the mechanisms read. */
export type ReviewLoopTarget = Partial<Pick<StartReviewRound, 'focus' | 'verbose' | 'pollTimeoutSeconds' | 'missionPath'>> & { readonly worktree?: string };

/**
 * One Node process can receive overlapping CLI/controller calls for the same
 * worktree; this process-local set keeps one effective loop owner per key.
 */
const activeReviewControllers = new Set<string>();

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

/** The explicit --mission override wins over the slug-derived mission location. */
function resolveEffectiveMissionPath(missionPath: string | undefined, missionDir: string | null, log: (_msg: string) => void): string | null {
  if (missionPath && fs.existsSync(missionPath)) {
    const effective = fs.statSync(missionPath).isDirectory() ? path.join(missionPath, 'MISSION.md') : missionPath;
    log(fmt.status('INFO', `Using mission contract from --mission override: ${effective}`));
    return effective;
  }
  if (missionPath) {
    log(fmt.status('WARN', `--mission path not found: ${missionPath}; falling back to slug-derived mission location${missionDir ? ` (${missionDir})` : ''}.`));
  }
  return null;
}

function headRevision(worktree: string): string | null {
  try {
    const head = git(['-C', worktree, 'rev-parse', 'HEAD']);
    return head.status === 0 ? ((head.stdout || '').trim() || null) : null;
  } catch {
    return null;
  }
}

function primaryBranch(worktree: string): string {
  try { return getPrimaryBranch(worktree, git) || 'main'; } catch { return 'main'; }
}

/** The configured review provider for this mission branch. */
function providerPort(slug: string, branch: string, worktree: string, target: ReviewLoopTarget, log: (_msg: string) => void, error: (_msg: string) => void): ReviewProviderPort {
  const intervalMs = resolvePollIntervalMs();
  const timeoutMs = resolvePollTimeoutMs(target.pollTimeoutSeconds || 0);
  let prNumber: number | null = null;
  let token: string | null | undefined;
  const credentials = () => (token === undefined ? (token = readToken(resolveReviewUser('') as string, { rootDir: worktree }) as string | null) : token);
  const poll = (request: ProviderPollRequest, quickTimeoutMs: number) => ({
    intervalMs: request.quick ? 1000 : intervalMs,
    timeoutMs: request.quick ? quickTimeoutMs : timeoutMs,
    verbose: Boolean(target.verbose), label: request.label, log,
    ...(request.retryCount === undefined ? {} : { retryCount: request.retryCount }),
  });
  const push = (options: Record<string, unknown>) => pushReviewRef(branch, branch, worktree, { ...options, token: credentials() } as never);
  return {
    async ensureReachable() {
      const url = process.env.FORGEJO_URL || 'http://localhost:3300';
      log(fmt.status('INFO', `Checking review-provider availability at ${url}...`));
      if (await providerAvailable(url)) {
        log(fmt.status('INFO', `Review provider is running and reachable at ${url}.`));
        return true;
      }
      error(fmt.status('FAIL', `Review provider not reachable at ${url}`));
      error('       Attempting to bootstrap provider containers...');
      if (run('bash', [path.join(packageRoot(MODULE_DIR), 'scripts', 'bootstrap.sh')], { stdio: 'inherit' }).status === 0) {
        log(fmt.status('INFO', 'Bootstrap succeeded. Continuing with review loop.'));
        return true;
      }
      error(fmt.status('FAIL', 'Bootstrap failed. Please run \'scripts/bootstrap.sh\' manually and retry.'));
      return false;
    },
    openPullRequest(): PullRequestReference | null {
      const pr = getPrStatus(branch, worktree) as Record<string, unknown>;
      const id = String(pr.number ?? '').trim();
      if (!pr.exists || pr.state !== 'open' || !id) { return null; }
      prNumber = pr.number as number;
      return { kind: 'pull-request', provider: 'forgejo', id, url: typeof pr.url === 'string' && pr.url.trim() ? pr.url : null, sourceBranch: branch, targetBranch: primaryBranch(worktree) };
    },
    async latestReview(reviewer, sinceIso) {
      const latest = await getLatestReviewForPr(prNumber as number, reviewer, sinceIso, credentials() as string) as Record<string, unknown> | null;
      return latest ? (latest.state as string | null) ?? null : null;
    },
    pollReview: async (reviewer, sinceIso, request) => await pollForReview(prNumber as number, reviewer, sinceIso, credentials() as string, poll(request, 2000)),
    pollDisposition: async (implementer, sinceIso, request) => await pollForDisposition(prNumber as number, implementer, sinceIso, credentials() as string, poll(request, CONTINUE_SKIP_CHECK_TIMEOUT_MS)),
    publishRevision() {
      if (!credentials()) { return null; }
      // A stale lease is refetched once, then forced: the review ref mirrors the mission branch.
      let result = push({ forceWithLease: true });
      if (isStaleInfoPushRejection(result)) {
        log(fmt.status('INFO', `Push rejected as stale; fetching review/${branch} and retrying.`));
        fetchReviewBranch(branch, worktree, { token: credentials() } as never);
        result = push({ forceWithLease: true });
        if (isStaleInfoPushRejection(result)) {
          log(fmt.status('INFO', 'Force-with-lease still stale; using force push.'));
          result = push({ force: true });
        }
      }
      return { ok: result.status === 0, status: result.status ?? null, detail: result.stderr || result.stdout || '' };
    },
  };
}

/** Role prompts and launches through the configured agent launcher. */
function agentPort(slug: string, branch: string, worktree: string, missionPath: string | undefined, target: ReviewLoopTarget, bindings: ReviewLoopBindings, writeState: typeof writeReviewState, log: (_msg: string) => void, error: (_msg: string) => void): ReviewAgentPort {
  const focus = target.focus ?? 'all';
  const rolePrompt = (role: ReviewAgentLaunch['role'], facts: ReviewPromptFacts, actual: string): string => role === 'reviewer'
    ? `${buildCompactReviewPrompt({ reviewer: facts.reviewer, branch, implementer: facts.implementer, focus, attempt: facts.attempt, repoRoot: worktree, missionPath, actualReviewer: actual, reviewBaseline: facts.reviewBaseline, integrationRepair: facts.integrationRepair } as never)}${facts.humanFeedback ? `\n\nHuman review correction (authoritative): ${facts.humanFeedback}` : ''}`
    : `${buildCompactActOnReviewPrompt({ implementer: facts.implementer, branch, attempt: facts.attempt, reviewOutcome: facts.reviewOutcome, repoRoot: worktree, missionPath, actualImplementer: actual, reviewBaseline: facts.reviewBaseline } as never)}${facts.humanFeedback ? `\n\nHuman review correction (authoritative): ${facts.humanFeedback}` : ''}`;
  return {
    async launch({ role, agent, exclude, prompt, recovery }) {
      const phase = role === 'reviewer' ? 'review' : 'review-response';
      return await startAgent(role === 'reviewer' ? 'review' : 'act-on-review', {
        agent,
        prompt: (actual: string) => [prompt ? rolePrompt(role, prompt, actual) : null, recovery ? String(recovery.prompt(actual)) : null].filter(part => part !== null).join('\n\n'),
        worktree, slug, role, exclude: [...exclude],
        ...(recovery?.sessionPolicy === undefined ? {} : { sessionPolicy: recovery.sessionPolicy }),
        // A bare repair launch is not review work the board reports.
        ...(prompt ? { onLaunch: ({ agent: launched }: { agent: string }) => bindings.onAgentLaunched?.(launched, phase) } : {}),
      } as never) as Awaited<ReturnType<ReviewAgentPort['launch']>>;
    },
    dryRunPrompt(role, facts) {
      return role === 'reviewer'
        ? buildReviewPrompt({ reviewer: facts.reviewer, branch, implementer: facts.implementer, focus, attempt: facts.attempt, repoRoot: worktree, missionPath, actualReviewer: facts.reviewer, reviewBaseline: facts.reviewBaseline, integrationRepair: facts.integrationRepair } as never)
        : buildActOnReviewPrompt({ implementer: facts.implementer, branch, attempt: facts.attempt, repoRoot: worktree, missionPath, reviewBaseline: facts.reviewBaseline } as never);
    },
    async recordStage(role, state, identity, launch) {
      const reviewer = role === 'reviewer';
      await recordStageStatsSafe(reviewer ? 'review' : 'active', {
        stage: reviewer ? 'review' : 'follow-up', slug, rootDir: worktree, worktree, reviewer: identity.reviewer, implementer: identity.implementer,
        result: launch?.result ?? undefined, sinceMs: stageLaunchSinceMs(launch?.result) || 0, log, error,
        state: state as never, writeReviewStateFn: writeState,
        model: resolveAgentModel((reviewer ? identity.reviewer : identity.implementer)!, worktree),
        missionStore: bindings.missionStore ?? null,
      });
    },
  };
}

/** Map the pre-review rebase result onto the facts the review loop interprets. */
export function preReviewRebaseFacts(result: Awaited<ReturnType<typeof rebaseBeforeReviewRound>>): PreReviewRebaseFacts {
  if (result.ok) { return { ok: true }; }
  const failure = result.failure;
  const gate = failure?.kind === 'gate'
    ? { area: failure.gate.area, exitCode: failure.gate.exitCode, command: failure.gate.command, operation: failure.operation, reason: gateFailureReason({ ok: false, area: failure.gate.area, command: failure.gate.command, exitCode: failure.gate.exitCode, stdout: failure.gate.stdout, stderr: failure.gate.stderr, error: failure.gate.error }) }
    : undefined;
  // Typed hook evidence (TASK-2377.02) is preferred; hookOutput is the fallback.
  const hook = result.hookFailure
    ? hookFailureReason(
      failure?.kind === 'hook' ? failure.hook.output : (result.hookOutput || ''),
      failure?.kind === 'hook' && failure.operation !== 'commit' ? `git ${failure.operation} (pre-review rebase, ${failure.hook.hook})` : 'git commit (pre-review safety commit)',
    )
    : undefined;
  return {
    ok: false, gate, hook,
    diagnostic: result.hookOutput || '',
    verifyReason: failure?.kind === 'hook' ? hookFailureReason(failure.hook.output, `git ${failure.operation}`) : undefined,
  };
}

function gateFacts(result: Awaited<ReturnType<typeof runPreReviewGate>>): PreReviewGateFacts {
  return result.ok
    ? { ok: true }
    : { ok: false, area: result.area, exitCode: result.exitCode, diagnostic: [result.stdout, result.stderr, result.error].filter(Boolean).join('\n'), reason: gateFailureReason(result) };
}

/**
 * Bind every review-loop mechanism for one Mission. The composition root
 * supplies the review authority; the request supplies the worktree, prompt
 * focus, and provider polling knobs.
 */
export function createReviewLoopPorts(slug: string, target: ReviewLoopTarget, bindings: ReviewLoopBindings = {}): ReviewLoopPorts {
  const log = bindings.log ?? fmt.log.plain;
  const error = bindings.error ?? fmt.log.plainError;
  const exit = bindings.exit ?? process.exit;
  const worktree = target.worktree || resolveWorktree(slug) || process.cwd();
  const branch = missionBranchName(slug, worktree);
  const missionStore = bindings.missionStore ?? null;
  const lifecycleService = bindings.lifecycleService ?? null;
  const readState = bindings.readReviewState ?? readReviewState;
  const writeState = bindings.writeReviewState ?? writeReviewState;
  const missionPath = resolveEffectiveMissionPath(target.missionPath, findMissionDir(slug, worktree, { missionPath: target.missionPath }), log) || undefined;
  const providerEnabled = (bindings.isProviderEnabled ?? isProviderEnabled)(worktree);
  const fetchComments = bindings.getComments ?? getComments;
  const tokenFor = bindings.readToken ?? readToken;
  const recordHumanNote = bindings.createEvent ?? createEvent;
  const artifactDir = resolveArtifactDir(worktree);
  const task = resolveTaskFile(slug, worktree);
  const key = `${path.resolve(worktree)}\u0000${slug}`;
  const verbose = Boolean(target.verbose);
  const artifactOptions = (state?: ReviewLoopState) => ({ worktree, tmpDir: artifactDir, buildMetadataFooterFn: buildMetadataFooter, forgejoEnabled: providerEnabled, log, error, ...(state ? { currentState: state as ReviewState } : {}) });
  return {
    branch,
    worktree,
    polling: { intervalMs: resolvePollIntervalMs(), timeoutMs: resolvePollTimeoutMs(target.pollTimeoutSeconds || 0) },
    missionStore,
    lifecycle: lifecycleService,
    state: {
      read: async () => await Promise.resolve(readState(slug, worktree, missionStore)),
      persist: async state => { await persistReviewStateOrThrow(writeState, slug, state as ReviewState, worktree, missionStore); },
      async reset() {
        const result = await (bindings.resetReviewState ?? resetReviewState)(slug, worktree);
        assertReviewStatePersisted(result, { slug, phase: 'reset', round: null });
        return result.outcome === 'committed';
      },
      create: identity => new ReviewState(slug, identity),
      resume: persisted => ReviewState.from(slug, persisted as ReviewState),
      repairInvalidPhase: async state => { await persistNormalizedPhaseRepair(slug, state as ReviewState, worktree, { log, writeReviewStateFn: writeState, missionStore }); },
      openRound: async state => (await openReviewRound(slug, state as ReviewState, { worktree, log, error, writeReviewStateFn: writeState, missionStore, lifecycleService })).ok,
    },
    task: {
      task,
      implementer: () => (task.ok ? getTaskImplementer(task.taskFile!) || null : null),
      status: () => (task.ok ? getTaskStatus(task.taskFile!) : null),
      reportUnresolved: () => reportTaskResolution(task, slug, error),
      mirror: async (lane, implementer) => { await transitionTask(slug, lane, { ...(implementer ? { implementer } : {}), rootDir: worktree, log }); },
      mirrorApproved: async () => { await transitionVirtual(transitionTask, slug, 'approved', { log }); },
      assign: implementer => Boolean(task.ok && enforceTaskAssignee(task.taskFile!, implementer)),
    },
    handoff: bindings.performHandoffFn
      ? { handoff: async implementer => await bindings.performHandoffFn!(slug, { forgejoUser: implementer, worktree, recoverGateFailure: true }) as HandoffFacts }
      : null,
    provider: providerEnabled ? providerPort(slug, branch, worktree, target, log, error) : null,
    humanFeedback: {
      async reconcile(state) {
        if (!providerEnabled) { return null; }
        const identity = state.reviewer || state.implementer;
        const token = identity ? tokenFor(identity, { rootDir: worktree }) : null;
        if (!token) { return null; }
        const comments = await fetchComments(branch, token, { rootDir: worktree });
        if (!Array.isArray(comments)) { return null; }
        const seen = new Set(Array.isArray(state.metadata.humanFeedbackSources) ? state.metadata.humanFeedbackSources as string[] : []);
        const configuredAgents = new Set([...WORKFLOW_AGENT_NAMES, state.reviewer ?? '', state.implementer ?? ''].map(value => value.toLowerCase()).filter(Boolean));
        const normalized = comments.map((raw, index) => ({ comment: raw as ForgejoFeedbackComment, index }));
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
        const newFeedback = feedback.filter(item => !seen.has(item.source));
        const consumedSources = new Set([...seen, ...newFeedback.map(item => item.source)]);
        state.metadata.humanFeedbackSources = [...consumedSources];
        state.metadata.humanFeedbackHistory = feedback.map(item => ({ source: item.source, author: item.author, state: item.state, disposition: item.disposition, reason: item.reason }));
        for (const item of newFeedback) {
          await recordHumanNote(slug, VALID_EVENT_TYPES.HUMAN_NOTE, {
            content: item.reason, actor: item.author, round: state.round, phase: state.phase,
            followUpReference: `${item.source}; state=${item.state}`,
          }, { worktree, skipGit: true, missionStore, log, error });
        }
        const currentRequest = [...newFeedback].reverse().find(item => item.disposition === 'REQUEST_CHANGES' && item.state === 'current');
        if (currentRequest) {
          const related = newFeedback.filter(item => item.disposition === 'REQUEST_CHANGES' && item.state === 'current' && item.reviewId === currentRequest.reviewId);
          return { ...currentRequest, reason: related.map(item => item.reason).filter(Boolean).join('\n'), findings: related.flatMap(item => item.findings) };
        }
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
      },
    },
    routing: {
      eligibleFamilies: () => eligibleAgentsForStep('review'),
      launcherStatus: agent => workflowLauncherStatus(agent),
      nominate: excluded => selectAgent('review', { exclude: new Set(excluded) }),
      runtimeMatrix: () => formatMatrixSummary(buildAutonomousReviewMatrix()),
    },
    agents: agentPort(slug, branch, worktree, missionPath, target, bindings, writeState, log, error),
    artifacts: {
      consumeReviewer: async (reviewer, state) => await (bindings.consumeReviewerArtifacts ?? consumeReviewerArtifacts)(slug, reviewer, { ...artifactOptions(state), verbose, missionStore } as never) as never,
      consumeImplementer: async (implementer, state) => await (bindings.consumeImplementerArtifacts ?? consumeImplementerArtifacts)(slug, implementer, artifactOptions(state) as never) as never,
    },
    preReview: {
      refreshKnowledgeGraph: async () => { await maybeUpdateGraphifyBeforeReview(worktree, { commandRunner: run, log }); },
      rebase: async () => preReviewRebaseFacts(await rebaseBeforeReviewRound(slug, {
        worktree, log, error, verbose, taskFile: task.taskFile, gitFn: git, isReviewProviderEnabledFn: isProviderEnabled,
        ...(missionStore ? { rebaseWorkflowOptions: { missionServicesFn: async () => ({ store: missionStore, lifecycle: lifecycleService }) } as never } : {}),
      })),
      runGate: async () => gateFacts(await runPreReviewGate(slug, worktree, { runFn: run, log, error })),
      reviewBaseline() {
        try {
          const primary = getPrimaryBranch(worktree, git);
          return (git(['-C', worktree, 'rev-parse', primary]).stdout || '').trim() || primary;
        } catch {
          return undefined;
        }
      },
      head: () => headRevision(worktree),
    },
    output: { emit: event => renderReviewLoopEvent(event, { log, error }), log, error, exit, onAgentLaunched: bindings.onAgentLaunched, onAutonomousStop: bindings.onAutonomousStop },
    lock: {
      tryAcquire: () => (activeReviewControllers.has(key) ? false : (activeReviewControllers.add(key), true)),
      release: () => { activeReviewControllers.delete(key); },
    },
  };
}
