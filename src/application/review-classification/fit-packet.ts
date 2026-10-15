import type { DecisionData, DecisionRequest } from '../ports/decision.js';
import { EvidenceOverBudgetError } from '../ports/review-evidence.js';
import type { MeasureBudget } from './repair-evidence-packet.js';

export interface FileDiff { readonly path: string; readonly added: number; readonly removed: number; readonly text: string }

/** Git file boundaries, including binary changes, mode changes and renames. No repository policy lives here. */
export function splitFileDiffs(diff: string): FileDiff[] {
  return diff.split(/(?=^diff --git )/m).filter(Boolean).map(text => {
    const header = text.match(/^diff --git (?:".*?"|a\/.*?) (".*?"|b\/.*?)$/m);
    const destination = text.match(/^\+\+\+ (?:b\/([^\n\t]+)|(".*?"))/m);
    const raw = destination?.[1] ?? destination?.[2] ?? header?.[1] ?? '(unlabelled diff)';
    let path = raw;
    if (raw.startsWith('"')) { try { path = JSON.parse(raw) as string; } catch { /* retain quoted path */ } }
    path = path.replace(/^b\//, '');
    return { path, added: (text.match(/^\+(?!\+\+ )/gm) ?? []).length,
      removed: (text.match(/^-(?!-- )/gm) ?? []).length, text };
  });
}

export function fitsDecisionBudget(request: DecisionRequest, measure: MeasureBudget): boolean {
  const b = measure(request);
  return b.inputTokens <= b.maxInputTokens && b.contextTokens <= b.maxContextTokens;
}

/** Mutable slots keep packet-specific shapes at their owning builders. */
export interface OptionalEvidence {
  readonly text: DecisionData;
  readonly tokens?: number;
  omit(): void;
}
export interface CommitList {
  readonly values: readonly DecisionData[];
  set(_values: readonly DecisionData[], _counts: { kept: number; dropped: number }): void;
}

/** One deterministic omission order, ranked only by the decision tokenizer. */
export function fitPacket(request: DecisionRequest, measure: MeasureBudget, options: {
  diffKey: string; context?: readonly OptionalEvidence[]; commits?: readonly CommitList[];
}): DecisionRequest {
  if (fitsDecisionBudget(request, measure)) { return request; }
  const state = request.state as Record<string, DecisionData>;
  const cost = (value: DecisionData) => measure({ ...request, state: value }).inputTokens;
  const emptyCost = cost('');
  const omittedCost = (value: DecisionData) => Math.max(0, cost(value) - emptyCost);
  let omittedTokens = 0;
  const omitted: Omit<FileDiff, 'text'>[] = [];
  const update = () => {
    state.omittedDiffs = omitted as unknown as DecisionData;
    state.omissionNotice = 'Omitted changes were not shown. Do not assume their contents or that they preserve the obligation.';
    state.omittedDiffCount = omitted.length;
    state.omittedTokens = omittedTokens;
  };
  for (const slot of [...(options.context ?? [])].sort((a, b) => (b.tokens ?? cost(b.text)) - (a.tokens ?? cost(a.text)))) {
    omittedTokens += omittedCost(slot.text);
    slot.omit(); update();
    if (fitsDecisionBudget(request, measure)) { return request; }
  }
  const files = splitFileDiffs(String(state[options.diffKey] ?? ''));
  const retained = new Set(files);
  const ranked = files.map((file, index) => ({ file, index, tokens: cost(file.text) }))
    .sort((a, b) => b.tokens - a.tokens || a.index - b.index);
  for (const { file } of ranked) {
    omittedTokens += omittedCost(file.text);
    retained.delete(file);
    omitted.push({ path: file.path, added: file.added, removed: file.removed });
    state[options.diffKey] = files.filter(f => retained.has(f)).map(f => f.text).join('');
    update();
    if (fitsDecisionBudget(request, measure)) { return request; }
  }
  for (const list of options.commits ?? []) {
    for (let kept = list.values.length - 1; kept >= 0; kept--) {
      omittedTokens += omittedCost(list.values[kept]);
      list.set(list.values.slice(0, kept), { kept, dropped: list.values.length - kept });
      update();
      if (fitsDecisionBudget(request, measure)) { return request; }
    }
  }
  throw new EvidenceOverBudgetError('Mandatory obligations and omission evidence exceed the decision budget');
}

/** Historical/unmodified packets carry no omissions; expose explicit call measurements. */
export function omissionMeasurements(state: DecisionData): { omittedDiffCount: number; omittedTokens: number } {
  const value = state as { omittedDiffCount?: number; omittedTokens?: number };
  return { omittedDiffCount: value.omittedDiffCount ?? 0, omittedTokens: value.omittedTokens ?? 0 };
}
