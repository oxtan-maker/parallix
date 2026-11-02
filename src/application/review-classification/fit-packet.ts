import type { DecisionData, DecisionRequest, DecisionRequestBudget } from '../ports/decision.js';
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

function admitted(b: DecisionRequestBudget, requestBytes = false): boolean {
  return [b.requestBytes, b.inputTokens, b.contextTokens, b.maxRequestBytes, b.maxInputTokens, b.maxContextTokens]
    .every(n => Number.isFinite(n) && n >= 0) && !!b.tokenizerModel
    && (!requestBytes || b.requestBytes <= b.maxRequestBytes) && b.inputTokens <= b.maxInputTokens && b.contextTokens <= b.maxContextTokens;
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

/** Estimates select batches only. Every returned candidate passes complete adapter accounting. */
export function fitPacket(request: DecisionRequest, measure: MeasureBudget, options: {
  diffKey: string; context?: readonly OptionalEvidence[]; commits?: readonly CommitList[]; requestBytes?: boolean;
}): DecisionRequest {
  const bytes = () => Buffer.byteLength(JSON.stringify(request));
  let estimatedBytes = bytes();
  const batch = estimatedBytes > 256_000;
  // Small packets get exact admission first, even when a byte estimate would overstate tokens.
  // For large packets obtain limits without traversing their evidence in the tokenizer.
  let budget = measure(!batch ? request : { ...request, state: '' });
  if (!batch && admitted(budget, options.requestBytes)) { return request; }
  const estimatedCapacity = () => Math.min(options.requestBytes ? budget.maxRequestBytes : Infinity, 4 * budget.maxInputTokens, 4 * budget.maxContextTokens);
  if (batch && estimatedBytes <= estimatedCapacity()) {
    budget = measure(request);
    if (admitted(budget, options.requestBytes)) { return request; }
  }
  const excessRatio = (minimum: number) => Math.max(minimum, budget.inputTokens / budget.maxInputTokens,
    budget.contextTokens / budget.maxContextTokens, options.requestBytes ? budget.requestBytes / budget.maxRequestBytes : 1);
  const state = request.state as Record<string, DecisionData>;
  const cost = (value: DecisionData) => measure({ ...request, state: value }).inputTokens;
  const emptyCost = cost('');
  let omittedTokens = 0;
  const omitted: Omit<FileDiff, 'text'>[] = [];
  const update = () => {
    state.omittedDiffs = omitted as unknown as DecisionData;
    state.omissionNotice = 'Omitted changes were not shown. Do not assume their contents or that they preserve the obligation.';
    state.omittedDiffCount = omitted.length;
    state.omittedTokens = omittedTokens;
  };
  // Component counts rank optional evidence; they are never added to authorize a request.
  // The adapter may count structured state differently from concatenated text.
  function* reductions(): Generator<number> {
    const slots = (options.context ?? []).map(slot => ({ slot, tokens: slot.tokens ?? cost(slot.text) }))
      .sort((a, b) => b.tokens - a.tokens);
    for (const { slot } of slots) {
      const size = Buffer.byteLength(JSON.stringify(slot.text));
      omittedTokens += Math.max(0, cost(slot.text) - emptyCost);
      slot.omit(); update();
      yield size;
    }
    const files = splitFileDiffs(String(state[options.diffKey] ?? ''));
    const retained = new Set(files);
    const ranked = files.map((file, index) => ({ file, index, tokens: cost(file.text) }))
      .sort((a, b) => b.tokens - a.tokens || a.index - b.index);
    for (const { file, tokens } of ranked) {
      omittedTokens += Math.max(0, tokens - emptyCost);
      retained.delete(file);
      omitted.push({ path: file.path, added: file.added, removed: file.removed });
      state[options.diffKey] = files.filter(f => retained.has(f)).map(f => f.text).join('');
      update();
      yield Buffer.byteLength(JSON.stringify(file.text));
    }
    for (const list of options.commits ?? []) {
      for (let kept = list.values.length - 1; kept >= 0; kept--) {
        omittedTokens += Math.max(0, cost(list.values[kept]) - emptyCost);
        list.set(list.values.slice(0, kept), { kept, dropped: list.values.length - kept });
        update();
        yield Buffer.byteLength(JSON.stringify(list.values[kept]));
      }
    }
  }
  const remaining = reductions();
  let target = Math.min(estimatedCapacity(), estimatedBytes / excessRatio(1)) * 0.8;
  for (;;) {
    // Account for new metadata at the next exact check, rather than serializing the full
    // packet for each file. An underestimated batch is corrected geometrically below.
    let reduction = remaining.next();
    if (reduction.done) {
      if (admitted(measure(request), options.requestBytes)) { return request; }
      break;
    }
    estimatedBytes -= reduction.value;
    while (batch && estimatedBytes > target) {
      reduction = remaining.next();
      if (reduction.done) { break; }
      estimatedBytes -= reduction.value;
    }
    budget = measure(request);
    if (admitted(budget, options.requestBytes)) { return request; }
    if (reduction.done) { break; }
    estimatedBytes = bytes();
    target = estimatedBytes / excessRatio(1.25) * 0.8;
  }
  throw new EvidenceOverBudgetError('Mandatory obligations and omission evidence exceed the decision budget');
}

/** Historical/unmodified packets carry no omissions; expose explicit call measurements. */
export function omissionMeasurements(state: DecisionData): { omittedDiffCount: number; omittedTokens: number } {
  const value = state as { omittedDiffCount?: number; omittedTokens?: number };
  return { omittedDiffCount: value.omittedDiffCount ?? 0, omittedTokens: value.omittedTokens ?? 0 };
}
