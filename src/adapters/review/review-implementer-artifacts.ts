/**
 * Implementer artifact consumption: resolve the implementer artifact set,
 * record the resolution, and close the implementer round.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { resolveWorktree } from '../filesystem/mission-utils.js';
import { readReviewState, writeReviewState, reviewStateFile } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { parseResolutionDispositions, type ReviewItemDisposition } from '../../domain/review.js';
import { createEvent, consumeHumanNotes, VALID_EVENT_TYPES, CreateEventParams, CreateEventOptions, CreateEventResult } from './review-events.js';
import { recordImplementerResolution } from './review-round.js';
import { reviewArtifactPath, staleReviewWrite, renderResolution, resolveArtifactRead, resolveArtifactDir, readArtifactFile, deleteArtifactFile, normalizeDisposition, headRevision } from './review-artifact-files.js';
import { postWorkflowComment } from './review-workflow-posting.js';
import { resolveProviderEnabled, type RepoEventFn } from './review-reviewer-artifacts.js';

type ImplementerArtifactOptions = {
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
  readArtifactFn?: typeof readArtifactFile;
  deleteArtifactFn?: typeof deleteArtifactFile;
  tmpDir?: string | null;
  worktree?: string;
  providerEnabled?: boolean | null;
  forgejoEnabled?: boolean | null;
  readTokenFn?: (_user: string, _opts?: Record<string, unknown>) => string | null;
  getCommentsFn?: (_branch: string, _token: string) => Promise<unknown[]>;
  postCommentFn?: (_branch: string, _token: string, _body: string, _opts?: Record<string, unknown>) => unknown;
  buildMetadataFooterFn?: (_s: string, _r?: string) => string | Promise<string>;
  createEventFn?: (_s: string, _t: string, _p: CreateEventParams, _o: CreateEventOptions) => CreateEventResult | Promise<CreateEventResult>;
  readReviewStateFn?: (_s: string, _r?: string) => any;
  writeReviewStateFn?: typeof writeReviewState;
  currentState?: { metadata?: Record<string, unknown> } | null;
  missionStore?: MissionStore | null;
  recordImplementerResolutionFn?: typeof recordImplementerResolution;
  headRevisionFn?: (_worktree: string) => string;
  /**
   * Typed inbound transport (`px resolve`). Same rule as the reviewer side: the
   * dispositions reach the domain typed, and the round-summary Markdown is
   * rendered here for the event body rather than parsed back out of it.
   */
  output?: {
    items: readonly ReviewItemDisposition[];
    evidence: readonly string[];
    blockedReason?: string | null;
    disposition: string;
    resultingRevision?: string;
  };
  /** Mission version the caller read; threaded to the recorder so a stale resolution fails closed. */
  expectedVersion?: number;
};

type ResolvedImplementerArtifactSet = {
  resolution: string | null;
  dispositionRaw: string | null;
  resolutionPath: string;
  dispositionPath: string;
};

/** Provider flag precedence: explicit > forgejo alias > worktree config. */

function typedImplementerArtifactSet(slug: string, tmpDir: string, output: { items: readonly ReviewItemDisposition[]; evidence: readonly string[]; blockedReason?: string | null; disposition: string }): ResolvedImplementerArtifactSet {
  return {
    resolution: renderResolution(output),
    dispositionRaw: output.disposition,
    resolutionPath: reviewArtifactPath(slug, 'round-resolution.md', tmpDir),
    dispositionPath: reviewArtifactPath(slug, 'review-disposition.txt', tmpDir),
  };
}

function resolveImplementerArtifactSet(slug: string, options: { tmpDir: string; readArtifactFn: typeof readArtifactFile }): ResolvedImplementerArtifactSet {
  const resolutionResolved = resolveArtifactRead(slug, 'round-resolution.md', { tmpDir: options.tmpDir, readArtifactFn: options.readArtifactFn });
  const dispositionResolved = resolveArtifactRead(slug, 'review-disposition.txt', { tmpDir: options.tmpDir, readArtifactFn: options.readArtifactFn });
  return {
    resolution: resolutionResolved.value,
    dispositionRaw: dispositionResolved.value,
    resolutionPath: resolutionResolved.path,
    dispositionPath: dispositionResolved.path,
  };
}

/** Persist the reviewer findings and outcome events to the repo store. */

type ImplementerArtifactFailure = { consumed: true; ok: false; diagnostic: string };

/** Name which of the two required implementer artifacts is missing, and why that is fatal. */
function reportIncompleteImplementerArtifacts(context: {
  slug: string; resolution: string | null; disposition: string | null;
  resolutionPath: string; dispositionPath: string; reviewStatePath: string | null;
  providerEnabled: boolean; error: (_msg: string) => void;
}): ImplementerArtifactFailure {
  const { slug, resolutionPath, dispositionPath, reviewStatePath, providerEnabled, error } = context;
  const missing: string[] = [];
  if (!context.resolution) { missing.push('round-resolution'); }
  if (!context.disposition) { missing.push('disposition'); }
  const expected = `Incomplete implementer artifacts for ${slug}. Expected ${resolutionPath} and ${dispositionPath}.`;
  if (providerEnabled) {
    error(fmt.status('FAIL', expected));
  } else {
    // With provider=none there is no PR review to fall back on, so the local
    // state path is named: it is the only place the operator can repair this.
    const statePathStr = reviewStatePath ? ` local review state at ${reviewStatePath}; ` : ' ';
    error(fmt.status('FAIL', `${expected}${statePathStr}No provider review posted (provider=none); add review-disposition.txt and a round resolution, or use \`node parallix review <slug> --submit-review approve\`.`));
  }
  return { consumed: true, ok: false, diagnostic: `Implementer artifacts incomplete: missing ${missing.join(', ')}` };
}

/**
 * Item dispositions and the blocked reason carried by a round resolution. A
 * malformed disposition list yields none rather than failing the round; a
 * BLOCKED disposition falls back to prose when no structured reason was given.
 */
function parseImplementerResolution(resolution: string, disposition: string): { itemDispositions: ReviewItemDisposition[]; blockedReason: string | null } {
  let itemDispositions: ReviewItemDisposition[] = [];
  let blockedReason: string | null = null;
  try {
    itemDispositions = [...parseResolutionDispositions(resolution)];
    const blockedMatch = resolution.match(/blocked_reason:\s*"([^"]*)"/i);
    if (blockedMatch) { blockedReason = blockedMatch[1]; }
  } catch {
    itemDispositions = [];
  }
  if (disposition === 'BLOCKED' && !blockedReason) {
    const match = resolution.match(/blocked.*?:\s*(.+)/i);
    if (match) { blockedReason = match[1].trim(); }
  }
  return { itemDispositions, blockedReason };
}

/**
 * Close the round on the aggregate so the next handoff can open round N+1 on
 * the same pull request. Returns a failure result, or null when the round
 * closed (or was already closed).
 */
async function closeImplementerRound(slug: string, context: {
  disposition: string; itemDispositions: ReviewItemDisposition[]; worktree: string;
  options: any; log: (_msg: string) => void; error: (_msg: string) => void;
}): Promise<ImplementerArtifactFailure | null> {
  const { disposition, itemDispositions, worktree, options, log, error } = context;
  const recordImplementerResolutionFn = options.recordImplementerResolutionFn || recordImplementerResolution;
  const headRevisionFn = options.headRevisionFn || headRevision;
  let resultingRevision: string;
  try {
    resultingRevision = options.output?.resultingRevision ?? headRevisionFn(worktree);
  } catch (revisionError) {
    const revErr = (revisionError as Error).message;
    error(fmt.status('FAIL', `Could not record the implementer resolution for ${slug}: ${revErr}`));
    return { consumed: true, ok: false, diagnostic: `Implementer resolution persist failed: ${revErr}` };
  }
  const recorded = await recordImplementerResolutionFn(slug, {
    itemDispositions,
    evidence: `${disposition} — implementer round summary for ${slug}`,
    resultingRevision,
    respondedAt: new Date().toISOString(),
    ...(options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
  }, { missionStore: options.missionStore });
  if (recorded.outcome === 'failed') {
    error(fmt.status('FAIL', `Could not record the implementer resolution for ${slug}: ${recorded.diagnostic}`));
    return { consumed: true, ok: false, diagnostic: `Implementer resolution persist failed: ${recorded.diagnostic}` };
  }
  if (recorded.outcome === 'unchanged') {
    log(fmt.status('INFO', `Implementer resolution for ${slug} already recorded (${recorded.reason}).`));
  }
  return null;
}

/** Mirror the round resolution and its disposition onto the pull request. */
async function mirrorImplementerArtifacts(slug: string, context: {
  resolution: string; disposition: string; implementer: string; worktree: string;
  options: any; log: (_msg: string) => void; error: (_msg: string) => void;
}): Promise<ImplementerArtifactFailure | null> {
  const { resolution, disposition, implementer, worktree, options, log, error } = context;
  const postOptions = {
    rootDir: worktree, reviewIdentity: implementer, readTokenFn: options.readTokenFn,
    postCommentFn: options.postCommentFn, buildMetadataFooterFn: options.buildMetadataFooterFn, log, error,
  };
  for (const [body, label] of [[resolution, 'resolution'], [`Autonomous review disposition: ${disposition}`, 'disposition']] as const) {
    const result = await postWorkflowComment(slug, body, postOptions);
    if (!result.ok) {
      return { consumed: true, ok: false, diagnostic: `Implementer ${label} post failed: ${(result as { error?: string }).error}` };
    }
  }
  return null;
}

/** Persist the implementer round-summary and disposition events to the repo store. */
async function persistImplementerEvents(params: {
  slug: string;
  implementer: string;
  round: number | undefined;
  phase: string | undefined;
  resolution: string;
  disposition: string;
  itemDispositions: ReviewItemDisposition[];
  blockedReason: string | null;
  createEventFn: RepoEventFn;
  worktree: string;
  log: (_msg: string) => void;
  error: (_msg: string) => void;
}): Promise<{ ok: true } | { ok: false; diagnostic: string }> {
  const { slug, implementer, round, phase, resolution, disposition, itemDispositions, blockedReason, createEventFn, worktree, log, error } = params;
  const summaryEventResult = await createEventFn(slug, VALID_EVENT_TYPES.IMPLEMENTER_ROUND_SUMMARY, {
    content: resolution, round, phase, actor: implementer,
    itemDispositions,
    ...(disposition === 'BLOCKED' && blockedReason ? { blockedReason } : {})
  }, { worktree, skipGit: true, log: log, error });

  if (!summaryEventResult.ok) {
    const summaryErr = (summaryEventResult as { error?: string }).error;
    error(fmt.status('FAIL', `Failed to persist implementer round summary to repo store: ${summaryErr}`));
    return { ok: false, diagnostic: `Implementer artifact persist failed (round-summary): ${summaryErr}` };
  }

  const dispositionEventResult = await createEventFn(slug, VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION, {
    content: `Autonomous review disposition: ${disposition}`, round, phase, actor: implementer, disposition
  }, { worktree, skipGit: true, log: log, error });

  if (!dispositionEventResult.ok) {
    const dispErr = (dispositionEventResult as { error?: string }).error;
    error(fmt.status('FAIL', `Failed to persist implementer disposition to repo store: ${dispErr}`));
    return { ok: false, diagnostic: `Implementer artifact persist failed (disposition): ${dispErr}` };
  }

  log(fmt.status('INFO', `Persisted implementer artifacts to repo store: ${(summaryEventResult as { path?: string }).path}, ${(dispositionEventResult as { path?: string }).path}`));
  return { ok: true };
}

export async function consumeImplementerArtifacts(
  slug: string,
  implementer: string,
  options: ImplementerArtifactOptions = {}
): Promise<{ consumed: boolean; ok?: boolean; disposition?: string | null; diagnostic?: string | null }> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const readArtifactFn = options.readArtifactFn || readArtifactFile;
  const deleteArtifactFn = options.deleteArtifactFn || deleteArtifactFile;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const tmpDir = options.tmpDir || resolveArtifactDir(worktree);
  const providerEnabled = resolveProviderEnabled(options, worktree);
  const reviewStatePath = reviewStateFile(slug, worktree);

  const artifacts = options.output
    ? typedImplementerArtifactSet(slug, tmpDir, options.output)
    : resolveImplementerArtifactSet(slug, { tmpDir, readArtifactFn });
  const disposition = normalizeDisposition(artifacts.dispositionRaw || '');
  const hasAny = artifacts.resolution !== null || artifacts.dispositionRaw !== null;

  if (!hasAny) {
    return { consumed: false };
  }
  if (!artifacts.resolution || !disposition) {
    return reportIncompleteImplementerArtifacts({ slug, resolution: artifacts.resolution, disposition, resolutionPath: artifacts.resolutionPath, dispositionPath: artifacts.dispositionPath, reviewStatePath, providerEnabled: Boolean(providerEnabled), error });
  }

  const staleResolution = await staleReviewWrite(slug, options.expectedVersion, options.missionStore);
  if (staleResolution) {
    error(fmt.status('FAIL', staleResolution));
    return { consumed: true, ok: false, diagnostic: staleResolution };
  }

  const currentState = await Promise.resolve((options.readReviewStateFn || readReviewState)(slug, worktree));
  const round = currentState ? currentState.round : 1;
  const phase = currentState ? currentState.phase : 'fixing';

  const { itemDispositions, blockedReason } = options.output
    ? { itemDispositions: [...options.output.items], blockedReason: options.output.blockedReason ?? null }
    : parseImplementerResolution(artifacts.resolution, disposition);

  // Close the round on the aggregate. `ready-for-next-round` is the state the
  // next handoff needs to open round N+1 on the same pull request.
  //
  // Committed before the round-summary events, and pinned to the version the
  // caller read: the events advance the Mission, so a resolution recorded after
  // them could neither check the caller's version nor notice a concurrent write
  // that landed in between. The recorder saves with a compare-and-swap on the
  // version it checks, which is what makes this atomic rather than pre-checked.
  if (disposition !== 'BLOCKED') {
    const closed = await closeImplementerRound(slug, { disposition, itemDispositions, worktree, options, log, error });
    if (closed) { return closed; }
  }

  const persisted = await persistImplementerEvents({
    slug, implementer, round, phase, resolution: artifacts.resolution, disposition, itemDispositions, blockedReason,
    createEventFn: options.createEventFn || createEvent, worktree, log, error,
  });
  if (!persisted.ok) { return { consumed: true, ok: false, diagnostic: 'diagnostic' in persisted ? persisted.diagnostic : 'implementer event persistence failed' }; }

  if (providerEnabled && options.readTokenFn && options.getCommentsFn) {
    await consumeHumanNotes(slug, implementer, {
      getCommentsFn: options.getCommentsFn,
      createEventFn: (options.createEventFn || createEvent) as any,
      readTokenFn: options.readTokenFn,
      reviewIdentity: implementer,
      worktree,
      writeReviewStateFn: options.writeReviewStateFn,
      currentState: options.currentState,
      log: log,
      error
    });
  }

  if (providerEnabled) {
    const mirrored = await mirrorImplementerArtifacts(slug, { resolution: artifacts.resolution, disposition, implementer, worktree, options, log, error });
    if (mirrored) { return mirrored; }
  } else {
    log(fmt.status('INFO', `Review provider disabled; skipping PR mirroring for ${slug}`));
  }

  if (!options.output) {
    deleteArtifactFn(artifacts.resolutionPath);
    deleteArtifactFn(artifacts.dispositionPath);
  }

  return { consumed: true, ok: true, disposition };
}

