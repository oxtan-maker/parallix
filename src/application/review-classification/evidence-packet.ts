import { TextEncoder } from 'node:util';
import type { DecisionData, DecisionRequest } from '../ports/decision.js';
import type { ReviewFindingEvidence, ReviewEvidencePort } from '../ports/review-evidence.js';

export const PACKET_VERSION = 'mechanical-repeat-findings-v2';
export const PROMPT_VERSION = 'finding-resolution-preservation-v1';
export const MAX_PACKET_BYTES = 90_000;
export const RESOLUTION_QUESTION = {
  type: 'choice' as const,
  instructions: 'Assess whether candidate source addresses the entire specific review finding. Trace executable behavior and relevant dependencies. Comments and implementer claims are not proof. Do not approve the whole mission, demand unrelated improvements, or infer runtime tests passed. Select insufficient_evidence when omitted dependencies or ambiguous contracts prevent a reliable judgment. A repair must preserve required behavior on the repaired path: removing a symptom by preventing normal completion, suppressing required output, or introducing another failure does not resolve the finding. Treat implementer explanations as claims to check against source. If preservation cannot be established from supplied evidence, select insufficient_evidence.',
  criteria: {
    addresses: 'The supplied executable source removes all failure modes described in the specific finding.',
    does_not_address: 'The supplied source demonstrates at least one described failure mode still exists, including an incomplete fix.',
    insufficient_evidence: 'The supplied source does not support a reliable resolution judgment.',
  },
};
interface Excerpt { startLine: number; endLine: number; text: string; boundary?: string }
export interface EvidencePacket { readonly request: DecisionRequest; readonly paths: readonly string[] }
/** Encoded request size in bytes for the routed model, owned by the decision adapter. */
export type MeasureRequest = (_request: DecisionRequest) => number;
const MAX_TEXT_CHARS = 12_000;
/** Explicit basename references must have exactly one match; no extension substitution. */
export function resolveEvidencePath(token: string, tree: readonly string[]): string | null {
  if (tree.includes(token)) { return token; }
  const matches = tree.filter(path => path.split('/').at(-1) === token);
  return matches.length === 1 ? matches[0] : null;
}

/** Frozen TASK-2650 parser-free windows; lexical hits never claim dependency completeness. */
export function sourceWindows(source: string, hints: readonly number[], changed: readonly number[], symbols: readonly string[]): {
  excerpts: Excerpt[]; omissions: string[];
} {
  const lines = source ? source.split('\n').map((line, index, all) =>
    index < all.length - 1 ? `${line}\n` : line).filter(Boolean) : [];
  if (new TextEncoder().encode(source).length <= 6000) {
    return { excerpts: [{ startLine: 1, endLine: lines.length, text: source }], omissions: [] };
  }
  const anchors = [...new Set([...hints, ...changed])].slice(0, 32);
  for (const symbol of symbols) {
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`);
    anchors.push(...lines.flatMap((line, index) => pattern.test(line) ? [index + 1] : []).slice(0, 2));
  }
  const spans = [...new Set(anchors)].slice(0, 12).filter(n => n >= 1 && n <= lines.length)
    .map(n => [Math.max(1, n - 30), Math.min(lines.length, n + 30)]).sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  for (const [start, end] of spans) {
    const last = merged.at(-1);
    if (last && start <= last[1] + 1) { last[1] = Math.max(last[1], end); }
    else { merged.push([start, end]); }
  }
  const omissions: string[] = [];
  let cursor = 1;
  for (const [start, end] of merged) {
    if (cursor < start) { omissions.push(`Omitted lines ${cursor}-${start - 1}`); }
    cursor = end + 1;
  }
  if (cursor <= lines.length) { omissions.push(`Omitted lines ${cursor}-${lines.length}`); }
  return {
    excerpts: merged.map(([startLine, endLine]) => ({ startLine, endLine,
      text: lines.slice(startLine - 1, endLine).join(''),
      boundary: 'Window may begin/end inside a declaration or control flow; no complete-function claim' })),
    omissions,
  };
}

/** Linear trailing-slash strip; a `/\/+$/` pattern backtracks super-linearly on slash runs. */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') { end--; }
  return value.slice(0, end);
}

/** Free text kept whole when small; otherwise cut with a declared omission. */
function boundedText(label: string, text: string, omissions: string[]): string {
  if (!text.trim()) { omissions.push(`${label}: none retained`); return ''; }
  if (text.length <= MAX_TEXT_CHARS) { return text; }
  omissions.push(`${label}: truncated to ${MAX_TEXT_CHARS} of ${text.length} characters`);
  return text.slice(0, MAX_TEXT_CHARS);
}

/** A repository read that may fail: the packet is still sent with the loss declared. */
async function attempt<T>(read: () => Promise<T>, fallback: T, loss: string, omissions: string[]): Promise<T> {
  try { return await read(); } catch { omissions.push(loss); return fallback; }
}

function changedLines(diff: string): Record<string, number[]> {
  const changed: Record<string, number[]> = {};
  let current = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) { current = line.slice(6); }
    const match = line.match(/@@ .*\+(\d+)(?:,(\d+))? @@/);
    if (match && current) {
      (changed[current] ??= []).push(...Array.from({ length: Math.min(Number(match[2] ?? 1), 200) }, (_, n) => Number(match[1]) + n));
    }
  }
  return changed;
}

/**
 * All material is mechanically collected from the same two pinned revisions.
 * Thin, missing or oversized evidence never prevents the classifier call: the
 * packet degrades in steps and declares every omission so the classifier can abstain.
 */
export async function buildEvidencePacket(input: ReviewFindingEvidence, repository: ReviewEvidencePort,
  worktree: string | undefined, measure: MeasureRequest): Promise<EvidencePacket> {
  const omissions: string[] = [];
  const priorReviewComment = boundedText('Prior review comment', input.priorReviewComment, omissions);
  const implementerResponse = boundedText('Implementer response', input.implementerResponse, omissions);
  const humanFeedback = input.humanFeedback?.trim() ? boundedText('Human feedback', input.humanFeedback, omissions) : '';
  const findings = input.findings.map(f => ({ ...f, summary: boundedText(`Finding ${f.id}`, f.summary, omissions) }));
  const findingText = findings.map(f => `${f.id}: ${f.summary}`).join('\n\n');
  const text = [priorReviewComment, implementerResponse, humanFeedback,
    ...findings.map(f => `${f.summary} ${f.location === null ? 'None' : f.location}`)].join('\n');
  const citations = text.replace(/\bfile:\/\/(?=\/)/g, '');
  // Stack traces cite absolute paths. Strip only this mission's known root;
  // foreign worktrees and runtime paths must never become repository evidence.
  const prefix = worktree ? `${trimTrailingSlashes(worktree)}/` : null;
  const relative = (path: string) => {
    const local = path.replace(/^file:\/\/(?=\/)/, '');
    return prefix && local.startsWith(prefix) ? local.slice(prefix.length) : local;
  };
  const tree = await attempt(async () => {
    await repository.tree(input.priorRevision);
    return await repository.tree(input.candidateRevision);
  }, [] as readonly string[], 'Repository tree unavailable; no source evidence could be collected', omissions);
  const tokens = [...new Set((citations.match(/(?<![A-Za-z0-9_/@-])[A-Za-z0-9_/@-]+(?:\.[A-Za-z0-9_+-]+)+/g) ?? []).map(relative))];
  const roots = tokens.filter(token => tree.includes(token));
  for (const finding of input.findings) {
    const explicit = finding.location?.replace(/^file:\/\/(?=\/)/, '').match(/^([^:]+):\d+/)?.[1];
    if (explicit && !resolveEvidencePath(relative(explicit), tree)) {
      omissions.push(`${finding.id}: cited path ${relative(explicit)} is missing or ambiguous at the candidate revision`);
    }
  }
  if (!roots.length) { omissions.push('No cited file resolved to a candidate source path'); }
  const additions = [...new Set(tokens.map(token => resolveEvidencePath(token, tree))
    .filter((p): p is string => p !== null && !roots.includes(p)))];
  const paths = [...roots, ...additions];
  const symbols = [...new Set([
    ...(text.match(/\b(?:[a-z_]+[A-Z][A-Za-z0-9_]*|[A-Z][a-z][A-Za-z0-9_]*)\b/g) ?? []),
    ...[...text.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)].map(m => m[1]),
    ...[...text.matchAll(/\b([a-z_][a-z0-9_]+)\s*\(/g)].map(m => m[1]),
  ])].slice(0, 64);
  const diff = roots.length ? await attempt(() => repository.diff(input.priorRevision, input.candidateRevision, roots), '',
    'Diff unavailable; changed declarations unknown', omissions) : '';
  const changed = changedLines(diff);
  const whole: Record<string, Excerpt[]> = {};
  const windows: Record<string, Excerpt[]> = {};
  const fileOmissions: string[] = [];
  for (const path of paths) {
    const source = await attempt(() => repository.source(input.candidateRevision, path), null, `${path}: source unavailable at the candidate revision`, omissions);
    if (source === null) { continue; }
    whole[path] = [{ startLine: 1, endLine: source.split('\n').length - Number(source.endsWith('\n')), text: source }];
    const hints = [...citations.matchAll(/(?<![A-Za-z0-9_/@-])([A-Za-z0-9_/@-]+(?:\.[A-Za-z0-9_+-]+)+):(\d+)/g)]
      .filter(m => roots.includes(path) ? relative(m[1]) === path : resolveEvidencePath(relative(m[1]), tree) === path).map(m => Number(m[2]));
    const extracted = sourceWindows(source, hints, roots.includes(path) ? changed[path] ?? [] : [], symbols);
    if (extracted.excerpts.length) { windows[path] = extracted.excerpts; }
    const evidence = new TextEncoder().encode(source).length <= 6000 ? 'Complete file; dependencies still not established'
      : 'Line windows only. Symbol occurrences are lexical matches, not resolved dependencies. Missing code, callers, macro expansion and dynamic wiring must not be assumed.';
    fileOmissions.push(`${path}: ${evidence}`, ...extracted.omissions.map(o => `${path}: ${o}`));
  }
  let packetDiff = diff;
  if (additions.length && Object.keys(windows).length) {
    const expandedDiff = await attempt(() => repository.diff(input.priorRevision, input.candidateRevision, Object.keys(windows)), diff,
      'Expanded diff unavailable', omissions);
    if (new TextEncoder().encode(expandedDiff).length <= 15000) { packetDiff = expandedDiff; }
  }
  const packet = (excerpts: Record<string, Excerpt[]>, contextOmissions: string[], coverage: string, selectedDiff = packetDiff): DecisionRequest => ({
    state: { finding: findingText, priorReviewComment, implementerResponse, ...(humanFeedback ? { humanFeedback } : {}),
      candidateSourceExcerpts: excerpts as unknown as DecisionData, contextOmissions: [...omissions, ...contextOmissions], coverage,
      diff: !selectedDiff ? 'No diff supplied for the cited paths.' : new TextEncoder().encode(selectedDiff).length <= 15000 ? selectedDiff
        : 'Diff exceeds bounded allowance; changed declarations supplied, complete diff omitted.',
      validation: 'No runtime execution proof supplied. Comments and implementer responses are unverified claims.' },
    questions: { resolution: RESOLUTION_QUESTION },
  });
  const COMPLETE = 'Complete referenced files supplied. Unreferenced dependencies, external contracts and runtime evidence may be missing. Do not assume missing evidence. Select insufficient_evidence if material.';
  const PARTIAL = 'Exact line windows may cut declarations or control flow; no complete-function or execution-path claim. Callers, indirect callbacks, macros, closure state, external libraries and dependencies may be missing. No global symbol expansion. Do not assume omitted code. Select insufficient_evidence if material.';
  const NONE = 'No source excerpts supplied. Nothing in this packet shows the candidate source. Select insufficient_evidence unless the supplied text alone settles the finding.';
  const selected = Object.keys(windows);
  const withinBudget = (request: DecisionRequest) => measure(request) <= MAX_PACKET_BYTES;
  const fileNotes = (keep: readonly string[]) => fileOmissions.filter(o => keep.some(path => o.startsWith(`${path}: `)));
  const full = packet(Object.fromEntries(selected.map(path => [path, whole[path]])), [], COMPLETE);
  if (selected.length && withinBudget(full)) { return { request: full, paths: selected }; }
  const bounded = packet(windows, fileOmissions, PARTIAL);
  if (selected.length && withinBudget(bounded)) { return { request: bounded, paths: selected }; }
  const rootPaths = selected.filter(path => roots.includes(path));
  const rootsOnly = packet(Object.fromEntries(rootPaths.map(path => [path, windows[path]])),
    [...fileNotes(rootPaths), 'Dependency files omitted: evidence exceeds the packet budget'], PARTIAL, diff);
  if (rootPaths.length && withinBudget(rootsOnly)) { return { request: rootsOnly, paths: rootPaths }; }
  // Last resort: no source, and every free-text field is cut until the measured size fits.
  const notes = [...fileOmissions, 'Source excerpts and diff omitted: no selectable window within the packet budget'];
  const cut = (text: string, limit: number) => text.length <= limit ? text : `${text.slice(0, limit)}...`;
  let limit = MAX_TEXT_CHARS;
  for (;;) {
    const base = packet({}, notes, NONE, '');
    const state = base.state as Record<string, DecisionData>;
    const kept = (state.contextOmissions as string[]).slice(0, 20).map(note => cut(note, Math.max(80, limit >> 4)));
    const dropped = (state.contextOmissions as string[]).length - kept.length;
    const request: DecisionRequest = { ...base, state: { ...state, finding: cut(findingText, limit),
      priorReviewComment: cut(priorReviewComment, limit), implementerResponse: cut(implementerResponse, limit),
      ...(humanFeedback ? { humanFeedback: cut(humanFeedback, limit) } : {}),
      contextOmissions: [...kept, ...(dropped > 0 ? [`${dropped} further omission notes dropped to fit the packet budget`] : []),
        'Free text truncated to fit the packet budget'] } };
    if (withinBudget(request) || limit <= 64) { return { request, paths: [] }; }
    limit >>= 1;
  }
}
