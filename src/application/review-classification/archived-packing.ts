import type { DecisionData, DecisionRequest } from '../ports/decision.js';
import { EvidenceOverBudgetError, EvidenceReadError, type ReviewEvidencePort, type ReviewFindingEvidence } from '../ports/review-evidence.js';
import { RESOLUTION_QUESTION, resolveEvidencePath, sourceWindows, type EvidencePacket } from './evidence-packet.js';
import { fitsBudget, type MeasureBudget } from './repair-evidence-packet.js';

export const ARCHIVED_PACKING_VERSION = 'archived-window-basename-complete-v1';
const PARTIAL = 'Exact line windows may cut declarations or control flow; no complete-function or execution-path claim. Callers, indirect callbacks, macros, closure state, external libraries and dependencies may be missing. No global symbol expansion. Do not assume omitted code. Select insufficient_evidence if material.';
const COMPLETE = 'Complete referenced files supplied. Unreferenced dependencies, external contracts and runtime evidence may be missing. Do not assume missing evidence. Select insufficient_evidence if material.';
const LEXICAL = 'Line windows only. Symbol occurrences are lexical matches, not resolved dependencies. Missing code, callers, macro expansion and dynamic wiring must not be assumed.';
const TOKENS = /[A-Za-z0-9_./@-]+\.[A-Za-z0-9_+-]+/g;
const HINTS = /([A-Za-z0-9_./@-]+\.[A-Za-z0-9_+-]+):(\d+)/g;
type Excerpt = { startLine: number; endLine: number; text: string; boundary?: string };

/** Match Python json.dumps' archived byte accounting, including ASCII escapes and separators. */
export function archivedPacketBytes(request: DecisionRequest): number {
  const compact = JSON.stringify({ model: 'typesafe/jev-1.13', ...request });
  let encoded = '', quoted = false, escaped = false;
  for (let index = 0; index < compact.length; index++) {
    const char = compact[index];
    if (char === '"' && !escaped) { quoted = !quoted; }
    encoded += char.charCodeAt(0) >= 127 ? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}` : char;
    if (!quoted && (char === ',' || char === ':')) { encoded += ' '; }
    escaped = char === '\\' && !escaped;
  }
  return Buffer.byteLength(encoded);
}

function changedLines(diff: string): Record<string, number[]> {
  const changed: Record<string, number[]> = {};
  let current = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) { current = line.slice(6); }
    const match = line.match(/@@ .*\+(\d+)(?:,(\d+))? @@/);
    if (match && current) {
      (changed[current] ??= []).push(...Array.from({ length: Math.min(Number(match[2] ?? 1), 200) }, (_, i) => Number(match[1]) + i));
    }
  }
  return changed;
}

/** Frozen archived selection, before production admission; no mutable records or inferred dependencies. */
export async function packArchivedState(input: ReviewFindingEvidence, repository: ReviewEvidencePort, worktree?: string): Promise<EvidencePacket> {
  const tree = await repository.tree(input.candidateRevision);
  const text = [input.priorReviewComment, input.implementerResponse,
    ...input.findings.map(f => `${f.summary} ${f.location ?? 'None'}`)].join('\n');
  const relative = (path: string) => worktree && path.startsWith(`${worktree}/`) ? path.slice(worktree.length + 1) : path;
  const tokens = (text.match(TOKENS) ?? []).map(relative);
  const roots = [...new Set(tokens.filter(p => tree.includes(p)))];
  const symbols = [...new Set([
    ...(text.match(/\b(?:[a-z_]+[A-Z][A-Za-z0-9_]*|[A-Z][a-z][A-Za-z0-9_]*)\b/g) ?? []),
    ...[...text.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)].map(m => m[1]),
    ...[...text.matchAll(/\b([a-z_][a-z0-9_]+)\s*\(/g)].map(m => m[1]),
  ])].slice(0, 64);
  const omissions: string[] = [];
  let diff = '';
  try { diff = await repository.diff(input.priorRevision, input.candidateRevision, roots); }
  catch { omissions.push('Historical diff unavailable'); }
  const changed = changedLines(diff);
  const excerpts: Record<string, Excerpt[]> = {};
  const sources: Record<string, string> = {};
  const hints = [...text.matchAll(HINTS)];
  const add = async (path: string, expansion: boolean) => {
    const source = await repository.source(input.candidateRevision, path);
    sources[path] = source;
    const lines = source ? source.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).length - Number(/[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]$/.test(source)) : 0;
    const selectedHints = hints.filter(m => (expansion ? resolveEvidencePath(relative(m[1]), tree) : relative(m[1])) === path).map(m => Number(m[2]));
    const small = Buffer.byteLength(source) <= 6000;
    const window = small ? { excerpts: [{ startLine: 1, endLine: lines, text: source }], omissions: [] }
      : sourceWindows(source, selectedHints, expansion ? [] : changed[path] ?? [], symbols);
    if (window.excerpts.length) { excerpts[path] = window.excerpts; }
    omissions.push(`${path}: ${small ? 'Complete file; dependencies still not established' : LEXICAL}`,
      ...window.omissions.map(o => `${path}: ${o}`));
  };
  for (const path of roots) { await add(path, false); }
  const request: DecisionRequest = { state: {
    finding: input.findings.map(f => `${f.id}: ${f.summary}`).join('\n\n'),
    priorReviewComment: input.priorReviewComment, implementerResponse: input.implementerResponse,
    candidateSourceExcerpts: excerpts as unknown as DecisionData, contextOmissions: omissions, coverage: PARTIAL,
    diff: Buffer.byteLength(diff) <= 15000 ? diff : 'Diff exceeds bounded allowance; changed declarations supplied, complete diff omitted.',
    validation: 'No runtime execution proof supplied. Comments and implementer responses are unverified claims.',
  }, questions: { resolution: RESOLUTION_QUESTION } };
  if (!Object.keys(excerpts).length || archivedPacketBytes(request) > 90000) {
    throw new EvidenceOverBudgetError('archived-window-preparation-fallback');
  }
  const additions = [...new Set(tokens.map(token => resolveEvidencePath(token, tree))
    .filter((p): p is string => p !== null && !(p in excerpts)))];
  for (const path of additions) { await add(path, true); }
  const state = request.state as Record<string, DecisionData>;
  if (additions.length) {
    try {
      const expanded = await repository.diff(input.priorRevision, input.candidateRevision, Object.keys(excerpts));
      if (Buffer.byteLength(expanded) <= 15000) { state.diff = expanded; }
    } catch { /* Retained archived fallback preserves the base diff and its omission. */ }
  }
  const full: DecisionRequest = { ...request, state: { ...state,
    candidateSourceExcerpts: Object.fromEntries(Object.keys(excerpts).map(path => [path, [{ startLine: 1,
      endLine: sources[path].split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).length - Number(/[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]$/.test(sources[path])), text: sources[path] }]])),
    contextOmissions: omissions.filter(note => !Object.keys(excerpts).some(path => note.startsWith(`${path}: `))), coverage: COMPLETE,
  } };
  const result = archivedPacketBytes(full) <= 90000 ? full : request;
  if (archivedPacketBytes(result) > 90000) { throw new EvidenceOverBudgetError('archived-packet-oversize'); }
  return { request: result, paths: Object.keys(excerpts) };
}

/** Production admission refuses missing pinned revisions and mandatory evidence instead of truncating. */
export async function buildArchivedEvidencePacket(input: ReviewFindingEvidence, repository: ReviewEvidencePort,
  measure: MeasureBudget, validation?: DecisionData, worktree?: string): Promise<EvidencePacket> {
  try { await repository.tree(input.priorRevision); }
  catch { throw new EvidenceReadError('Pinned prior revision unavailable'); }
  const packet = await packArchivedState(input, repository, worktree);
  const extras = { ...(input.humanFeedback ? { humanFeedback: input.humanFeedback } : {}), ...(validation ? { validation } : {}) };
  const request = Object.keys(extras).length ? { ...packet.request, state: { ...(packet.request.state as Record<string, DecisionData>), ...extras } } : packet.request;
  if (!fitsBudget(request, measure)) { throw new EvidenceOverBudgetError('Archived evidence exceeds production budget'); }
  return { ...packet, request };
}
