/**
 * Review artifact file utilities: metadata footer, artifact paths and I/O,
 * typed-transport rendering, and verdict/disposition normalization.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { git } from '../git/git.js';
import { readReviewState, ReviewState, type ReviewStateData } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { type ReviewFinding, type ReviewItemDisposition } from '../../domain/review.js';
import { resolveArtifactDir as resolveConfiguredArtifactDir } from './review-adapter.js';

type CreateResult = { ok: boolean; path: string | null; error?: string | null; event?: unknown };
export type CreateEventFn = (_s: string, _t: string, _p: Record<string, unknown>, _o: Record<string, unknown>) => CreateResult | Promise<CreateResult>;
export type ReviewStateReader = (_s: string, _r?: string, _store?: MissionStore | null) => ReviewState | ReviewStateData | null | Promise<ReviewState | ReviewStateData | null>;

// ============================================================================
// Metadata Footer
// ============================================================================

export async function buildMetadataFooter(slug: string, rootDir = process.cwd(), missionStore: MissionStore | null = null): Promise<string> {
  const state = await readReviewState(slug, rootDir, missionStore);
  if (!state) { return ''; }
  return `\n\n---\n\`[workflow-round:${state.round}, workflow-phase:${state.phase}]\``;
}

// ============================================================================
// Artifact Path Utilities
// ============================================================================

export function reviewArtifactPath(slug: string, artifactName: string, tmpDir = os.tmpdir()): string {
  return path.join(tmpDir, `${slug}-${artifactName}`);
}

// ============================================================================
// Typed-transport rendering (one-way export)
// ============================================================================

/**
 * Render typed findings as the Markdown the review event and the provider
 * comment carry. One direction only: the domain already has the findings, so
 * nothing reads this back.
 */
/**
 * Fast pre-check that refuses a review write whose caller read an older Mission.
 *
 * Not the authority: the recorders commit with a compare-and-swap on the
 * version they check, and that is what makes a submission atomic. This runs
 * first so an obviously stale caller is turned away before any work, and it is
 * the only guard on the paths that record no decision at all — a `BLOCKED`
 * resolution writes events without reaching a recorder.
 */
export async function staleReviewWrite(
  slug: string,
  expectedVersion: number | undefined,
  missionStore: MissionStore | null | undefined,
): Promise<string | null> {
  if (expectedVersion === undefined || !missionStore) { return null; }
  if (typeof (missionStore as { load?: unknown }).load !== 'function') { return null; }
  const loaded = await missionStore.load(slug as never);
  if (loaded.kind !== 'found') { return null; }
  const actual = (loaded as { version: number }).version;
  if (actual === expectedVersion) { return null; }
  return `stale write for ${slug}: expected version ${expectedVersion}, found ${actual}. `
    + `Re-read \`px status ${slug}\` and retry.`;
}

export function renderFindings(findings: readonly ReviewFinding[]): string {
  if (findings.length === 0) { return 'No findings.'; }
  return findings
    .map((finding) => `## ${finding.id}: ${finding.summary}${finding.location ? `\n\nLocation: ${finding.location}` : ''}`)
    .join('\n\n');
}

/** The same one-way render for an implementer's round resolution. */
export function renderResolution(output: {
  items: readonly ReviewItemDisposition[];
  evidence: readonly string[];
  blockedReason?: string | null;
}): string {
  const ids = (kind: ReviewItemDisposition['kind']) =>
    output.items.filter((item) => item.kind === kind).map((item) => item.findingId);
  return [
    `fixed_items: ${JSON.stringify(ids('fixed'))}`,
    `pushed_back_items: ${JSON.stringify(ids('pushed_back'))}`,
    `parked_items: ${JSON.stringify(ids('parked'))}`,
    ...(output.blockedReason ? [`blocked_reason: ${JSON.stringify(output.blockedReason)}`] : []),
    '',
    output.evidence.join('\n'),
  ].join('\n');
}

/**
 * Read one agent-written artifact from the configured artifact directory.
 *
 * There is no second location to look in: the /tmp legacy fallback was removed
 * by the architecture migration cutover, so an artifact the agent did not write where the
 * loop is looking simply isn't there.
 */
export function resolveArtifactRead(
  slug: string,
  artifactName: string,
  opts: { tmpDir: string; readArtifactFn: typeof readArtifactFile }
): { path: string; value: string | null } {
  const { tmpDir, readArtifactFn } = opts;
  const artifactPath = reviewArtifactPath(slug, artifactName, tmpDir);
  return { path: artifactPath, value: readArtifactFn(artifactPath) };
}

/**
 * Resolve the directory where review artifacts are written and consumed.
 */
export function resolveArtifactDir(rootDir = process.cwd()): string {
  return resolveConfiguredArtifactDir(rootDir);
}

export function readArtifactFile(filePath: string, readFileSync = fs.readFileSync): string | null {
  try {
    const value = readFileSync(filePath, 'utf8');
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return null;
  }
}

export function deleteArtifactFile(filePath: string, unlinkSync = fs.unlinkSync): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Best-effort cleanup only.
  }
}

// ============================================================================
// Normalization Utilities
// ============================================================================

export function normalizeReviewVerdict(value: string): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  return ['approve', 'request-changes', 'comment'].includes(normalized) ? normalized : null;
}

export function normalizeDisposition(value: string): string | null {
  const normalized = String(value || '').trim().toUpperCase();
  return ['CHANGES_MADE', 'PUSHBACK_ALL', 'PARKED', 'BLOCKED'].includes(normalized) ? normalized : null;
}

/**
 * The revision the implementer hands back — the branch tip it produced.
 *
 * A worktree that cannot report a HEAD has no revision to record; failing here
 * is honest, where a synthesized placeholder would write a non-SHA revision
 * into the aggregate and make the round look answered against a change nobody
 * can resolve.
 */
export function headRevision(worktree: string): string {
  const result = git(['-C', worktree, 'rev-parse', 'HEAD']);
  const sha = result.stdout.trim();
  if (!sha) {
    throw new Error(`Cannot resolve HEAD in ${worktree}: the implementer round has no revision to record`);
  }
  return sha;
}

