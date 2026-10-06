import { TextEncoder } from 'node:util';
import type { DecisionRequest } from '../ports/decision.js';
import type { RepeatFindingEvidence, ReviewEvidencePort } from '../ports/review-evidence.js';

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
export type PacketResult = { readonly request: DecisionRequest; readonly paths: readonly string[] }
  | { readonly fallback: string };
/** Python json.dumps accounting used by the frozen 90k protocol, including model envelope. */
export function archivedPacketBytes(request: DecisionRequest): number {
  const encode = (value: unknown): string => {
    if (Array.isArray(value)) { return `[${value.map(encode).join(', ')}]`; }
    if (value !== null && typeof value === 'object') {
      return `{${Object.entries(value).map(([key, item]) => `${encode(key)}: ${encode(item)}`).join(', ')}}`;
    }
    return JSON.stringify(value).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  };
  return new TextEncoder().encode(encode({ model: 'typesafe/jev-1.13', ...request })).length;
}

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

/** All material is mechanically collected from the same two pinned revisions. */
export async function buildEvidencePacket(input: RepeatFindingEvidence, repository: ReviewEvidencePort, worktree?: string): Promise<PacketResult> {
  const ids = input.findings.map(f => f.id);
  if (!/^[a-f0-9]{40,64}$/.test(input.priorRevision) || !/^[a-f0-9]{40,64}$/.test(input.candidateRevision)
    || !ids.length || new Set(ids).size !== ids.length || !input.priorReviewComment.trim() || !input.implementerResponse.trim()
    || input.resolvedFindingIds.length !== ids.length || new Set(input.resolvedFindingIds).size !== ids.length
    || ids.some(id => !input.resolvedFindingIds.includes(id))) { return { fallback: 'incomplete-evidence' }; }
  try {
    await repository.tree(input.priorRevision);
    const tree = await repository.tree(input.candidateRevision);
    const text = [input.priorReviewComment, input.implementerResponse, ...input.findings.map(f => `${f.summary} ${f.location === null ? 'None' : f.location}`)].join('\n');
    const citations = text.replace(/\bfile:\/\/(?=\/)/g, '');
    // Stack traces cite absolute paths. Strip only this mission's known root;
    // foreign worktrees and runtime paths must never become repository evidence.
    const prefix = worktree ? `${worktree.replace(/\/+$/, '')}/` : null;
    const relative = (path: string) => {
      const local = path.replace(/^file:\/\/(?=\/)/, '');
      return prefix && local.startsWith(prefix) ? local.slice(prefix.length) : local;
    };
    const tokens = [...new Set((citations.match(/[A-Za-z0-9_/@-]+(?:\.[A-Za-z0-9_+-]+)+/g) ?? []).map(relative))];
    const roots = tokens.filter(token => tree.includes(token));
    for (const finding of input.findings) {
      const explicit = finding.location?.replace(/^file:\/\/(?=\/)/, '').match(/^([^:]+):\d+/)?.[1];
      if (explicit && !resolveEvidencePath(relative(explicit), tree)) { return { fallback: 'missing-or-ambiguous-path' }; }
    }
    if (!roots.length) { return { fallback: 'no-structural-excerpts' }; }
    const additions = [...new Set(tokens.map(token => resolveEvidencePath(token, tree))
      .filter((p): p is string => p !== null && !roots.includes(p)))];
    const paths = [...roots, ...additions];
    if (!paths.length) { return { fallback: 'no-structural-excerpts' }; }
    const symbols = [...new Set([
      ...(text.match(/\b(?:[a-z_]+[A-Z][A-Za-z0-9_]*|[A-Z][a-z][A-Za-z0-9_]*)\b/g) ?? []),
      ...[...text.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)].map(m => m[1]),
      ...[...text.matchAll(/\b([a-z_][a-z0-9_]+)\s*\(/g)].map(m => m[1]),
    ])].slice(0, 64);
    const diff = await repository.diff(input.priorRevision, input.candidateRevision, roots);
    const changed: Record<string, number[]> = {};
    let current = '';
    for (const line of diff.split('\n')) {
      if (line.startsWith('+++ b/')) { current = line.slice(6); }
      const match = line.match(/@@ .*\+(\d+)(?:,(\d+))? @@/);
      if (match && current) {
        (changed[current] ??= []).push(...Array.from({ length: Math.min(Number(match[2] ?? 1), 200) }, (_, n) => Number(match[1]) + n));
      }
    }
    const whole: Record<string, Excerpt[]> = {};
    const windows: Record<string, Excerpt[]> = {};
    const omissions: string[] = [];
    for (const path of paths) {
      const source = await repository.source(input.candidateRevision, path);
      whole[path] = [{ startLine: 1, endLine: source.split('\n').length - Number(source.endsWith('\n')), text: source }];
      const hints = [...citations.matchAll(/([A-Za-z0-9_/@-]+(?:\.[A-Za-z0-9_+-]+)+):(\d+)/g)]
        .filter(m => roots.includes(path) ? relative(m[1]) === path : resolveEvidencePath(relative(m[1]), tree) === path).map(m => Number(m[2]));
      const extracted = sourceWindows(source, hints, roots.includes(path) ? changed[path] ?? [] : [], symbols);
      if (extracted.excerpts.length) { windows[path] = extracted.excerpts; }
      const evidence = new TextEncoder().encode(source).length <= 6000 ? 'Complete file; dependencies still not established'
        : 'Line windows only. Symbol occurrences are lexical matches, not resolved dependencies. Missing code, callers, macro expansion and dynamic wiring must not be assumed.';
      omissions.push(`${path}: ${evidence}`, ...extracted.omissions.map(o => `${path}: ${o}`));
    }
    let packetDiff = diff;
    if (additions.length) {
      const expandedDiff = await repository.diff(input.priorRevision, input.candidateRevision, Object.keys(windows));
      if (new TextEncoder().encode(expandedDiff).length <= 15000) { packetDiff = expandedDiff; }
    }
    const packet = (excerpts: Record<string, Excerpt[]>, contextOmissions: string[], complete: boolean, selectedDiff = packetDiff): DecisionRequest => ({
      state: { finding: input.findings.map(f => `${f.id}: ${f.summary}`).join('\n\n'),
        priorReviewComment: input.priorReviewComment, implementerResponse: input.implementerResponse,
        candidateSourceExcerpts: excerpts as unknown as import('../ports/decision.js').DecisionData, contextOmissions,
        coverage: complete ? 'Complete referenced files supplied. Unreferenced dependencies, external contracts and runtime evidence may be missing. Do not assume missing evidence. Select insufficient_evidence if material.'
          : 'Exact line windows may cut declarations or control flow; no complete-function or execution-path claim. Callers, indirect callbacks, macros, closure state, external libraries and dependencies may be missing. No global symbol expansion. Do not assume omitted code. Select insufficient_evidence if material.',
        diff: new TextEncoder().encode(selectedDiff).length <= 15000 ? selectedDiff : 'Diff exceeds bounded allowance; changed declarations supplied, complete diff omitted.',
        validation: 'No runtime execution proof supplied. Comments and implementer responses are unverified claims.' },
      questions: { resolution: RESOLUTION_QUESTION },
    });
    // The frozen builder escalates when the exact-path preparation has no source windows.
    if (roots.length && !roots.some(path => Object.hasOwn(windows, path))) { return { fallback: 'no-structural-excerpts' }; }
    const baseWindows = Object.fromEntries(Object.entries(windows).filter(([path]) => roots.includes(path)));
    const baseOmissions = omissions.filter(o => roots.some(path => o.startsWith(`${path}: `)));
    if (archivedPacketBytes(packet(baseWindows, baseOmissions, false, diff)) > MAX_PACKET_BYTES) { return { fallback: 'oversize' }; }
    const selected = Object.keys(windows);
    const selectedWhole = Object.fromEntries(selected.map(path => [path, whole[path]]));
    const full = packet(selectedWhole, omissions.filter(o => !selected.some(path => o.startsWith(`${path}: `))), true);
    if (selected.length && archivedPacketBytes(full) <= MAX_PACKET_BYTES) { return { request: full, paths: selected }; }
    const bounded = packet(windows, omissions, false);
    if (!Object.keys(windows).length) { return { fallback: 'no-structural-excerpts' }; }
    return archivedPacketBytes(bounded) <= MAX_PACKET_BYTES ? { request: bounded, paths: Object.keys(windows) } : { fallback: 'oversize' };
  } catch { return { fallback: 'repository-read-failed' }; }
}
