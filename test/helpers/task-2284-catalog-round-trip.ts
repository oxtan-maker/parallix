// Mission-local round-trip harness for TASK-2284.
//
// This is decision evidence, not a product surface: it proves that a candidate
// canonical task record can be parsed out of today's Markdown task files and
// re-serialized without losing a field. It deliberately does not import
// `src/platform/runtime/lib/tools/backlog.ts` — that module is a set of
// single-field regex readers and in-place patchers with no record type, and the
// mission's Restricted Areas forbid changing it. The parsing shapes accepted
// here mirror the spellings that module accepts (inline array, block sequence,
// bare scalar).

/**
 * A YAML folded/literal block scalar (`>-`, `|`, …). Its continuation lines are
 * kept verbatim: this is the shape that silently disappears when a reader only
 * matches `^key:\s*(.+)$`, which is exactly what today's readers do.
 */
export interface BlockScalar {
  readonly header: string;
  readonly lines: readonly string[];
}

export type BlockItem =
  /** `value` is the unquoted value; `raw` is the source spelling, kept so a
   *  round trip cannot silently normalize `- "a"` into `- a`. */
  | { readonly kind: 'plain'; readonly value: string; readonly raw: string }
  | { readonly kind: 'folded'; readonly scalar: BlockScalar };

export type FrontmatterValue =
  | { readonly kind: 'scalar'; readonly text: string }
  | { readonly kind: 'block-scalar'; readonly scalar: BlockScalar }
  | { readonly kind: 'inline-list'; readonly items: readonly string[]; readonly raw: string }
  | { readonly kind: 'block-list'; readonly items: readonly BlockItem[]; readonly indent: string };

export interface FrontmatterEntry {
  readonly key: string;
  readonly value: FrontmatterValue;
}

export interface ChecklistItem {
  /** The `#n` marker, without the `#`, or null when the item carries none. */
  readonly index: string | null;
  readonly checked: boolean;
  readonly text: string;
}

export interface TaskRecord {
  readonly frontmatter: readonly FrontmatterEntry[];
  /** Body between `SECTION:DESCRIPTION:BEGIN` and `:END`, or null when absent. */
  readonly description: string | null;
  readonly acceptanceCriteria: readonly ChecklistItem[];
  readonly definitionOfDone: readonly ChecklistItem[];
  /** Everything after the closing frontmatter fence, verbatim. */
  readonly body: string;
  /** Line ending observed in the source, so serialization can reproduce it. */
  readonly newline: string;
}

const FRONTMATTER_FENCE = /^---\s*$/;
const KEY_LINE = /^([A-Za-z0-9_.-]+):(.*)$/;
const BLOCK_ITEM = /^(\s+)-\s+(.*)$/;
const BLOCK_SCALAR_HEADER = /^[>|][-+]?\d*$/;
const CHECKLIST_ITEM = /^\s*-\s+\[([ xX])\]\s*(?:#(\S+)\s*)?(.*)$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function splitInlineList(inner: string): string[] {
  return inner
    .split(',')
    .map(part => unquote(part))
    .filter(part => part.length > 0);
}

function indentWidth(line: string): number {
  return (/^\s*/.exec(line) ?? [''])[0].length;
}

/** Consume the continuation lines belonging to a block scalar opened at `from`. */
function takeContinuation(lines: readonly string[], from: number, ownerIndent: number): { lines: string[]; next: number } {
  const taken: string[] = [];
  let cursor = from;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.trim() !== '' && indentWidth(line) <= ownerIndent) { break; }
    taken.push(line);
    cursor += 1;
  }
  // Trailing blank lines belong to whatever follows, not to this scalar.
  while (taken.length > 0 && taken[taken.length - 1].trim() === '') {
    taken.pop();
    cursor -= 1;
  }
  return { lines: taken, next: cursor };
}

function parseFrontmatter(lines: readonly string[]): FrontmatterEntry[] {
  const entries: FrontmatterEntry[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = KEY_LINE.exec(lines[i]);
    if (!match) { continue; }
    const key = match[1];
    const rest = match[2].trim();

    if (BLOCK_SCALAR_HEADER.test(rest)) {
      const continuation = takeContinuation(lines, i + 1, indentWidth(lines[i]));
      entries.push({ key, value: { kind: 'block-scalar', scalar: { header: rest, lines: continuation.lines } } });
      i = continuation.next - 1;
      continue;
    }

    if (rest === '') {
      const items: BlockItem[] = [];
      let indent = '  ';
      while (i + 1 < lines.length) {
        const itemMatch = BLOCK_ITEM.exec(lines[i + 1]);
        if (!itemMatch) { break; }
        indent = itemMatch[1];
        i += 1;
        if (BLOCK_SCALAR_HEADER.test(itemMatch[2].trim())) {
          const continuation = takeContinuation(lines, i + 1, indent.length);
          items.push({ kind: 'folded', scalar: { header: itemMatch[2].trim(), lines: continuation.lines } });
          i = continuation.next - 1;
          continue;
        }
        items.push({ kind: 'plain', value: unquote(itemMatch[2]), raw: itemMatch[2] });
      }
      if (items.length > 0) {
        entries.push({ key, value: { kind: 'block-list', items, indent } });
      } else {
        entries.push({ key, value: { kind: 'scalar', text: '' } });
      }
      continue;
    }

    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1);
      entries.push({ key, value: { kind: 'inline-list', items: splitInlineList(inner), raw: inner } });
      continue;
    }

    entries.push({ key, value: { kind: 'scalar', text: rest } });
  }
  return entries;
}

function markerBlock(body: string, marker: string): string | null {
  const begin = new RegExp(`<!--\\s*${marker}:BEGIN\\s*-->`);
  const end = new RegExp(`<!--\\s*${marker}:END\\s*-->`);
  const beginMatch = begin.exec(body);
  const endMatch = end.exec(body);
  if (!beginMatch || !endMatch || endMatch.index < beginMatch.index) { return null; }
  return body.slice(beginMatch.index + beginMatch[0].length, endMatch.index);
}

function parseChecklist(block: string | null): ChecklistItem[] {
  if (block === null) { return []; }
  const items: ChecklistItem[] = [];
  for (const line of block.split(/\r?\n/)) {
    const match = CHECKLIST_ITEM.exec(line);
    if (!match) { continue; }
    items.push({
      checked: match[1].toLowerCase() === 'x',
      index: match[2] ?? null,
      text: match[3].trim(),
    });
  }
  return items;
}

/** Parse a task Markdown file into the candidate canonical record. */
export function parseTaskRecord(source: string): TaskRecord {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  if (!FRONTMATTER_FENCE.test(lines[0] ?? '')) {
    throw new Error('task record does not start with a frontmatter fence');
  }
  const closing = lines.findIndex((line, index) => index > 0 && FRONTMATTER_FENCE.test(line));
  if (closing === -1) {
    throw new Error('task record has no closing frontmatter fence');
  }

  const frontmatter = parseFrontmatter(lines.slice(1, closing));
  const body = lines.slice(closing + 1).join(newline);
  const description = markerBlock(body, 'SECTION:DESCRIPTION');

  return {
    frontmatter,
    description,
    acceptanceCriteria: parseChecklist(markerBlock(body, 'AC')),
    definitionOfDone: parseChecklist(markerBlock(body, 'DOD')),
    body,
    newline,
  };
}

function serializeEntry(entry: FrontmatterEntry): string[] {
  const { key, value } = entry;
  if (value.kind === 'scalar') {
    return [value.text === '' ? `${key}:` : `${key}: ${value.text}`];
  }
  if (value.kind === 'block-scalar') {
    return [`${key}: ${value.scalar.header}`, ...value.scalar.lines];
  }
  if (value.kind === 'inline-list') {
    return [`${key}: [${value.raw}]`];
  }
  return [
    `${key}:`,
    ...value.items.flatMap(item => (item.kind === 'plain'
      ? [`${value.indent}- ${item.raw}`]
      : [`${value.indent}- ${item.scalar.header}`, ...item.scalar.lines])),
  ];
}

/** Re-serialize a record back to task Markdown. */
export function serializeTaskRecord(record: TaskRecord): string {
  const frontmatterLines = record.frontmatter.flatMap(serializeEntry);
  return ['---', ...frontmatterLines, '---'].join(record.newline)
    + record.newline
    + record.body;
}

export interface FieldDifference {
  readonly field: string;
  readonly expected: unknown;
  readonly actual: unknown;
}

function compare(field: string, expected: unknown, actual: unknown, differences: FieldDifference[]): void {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    differences.push({ field, expected, actual });
  }
}

/** Field-by-field diff of two records. An empty result means a lossless trip. */
export function diffTaskRecords(expected: TaskRecord, actual: TaskRecord): FieldDifference[] {
  const differences: FieldDifference[] = [];
  const keys = new Set([
    ...expected.frontmatter.map(entry => entry.key),
    ...actual.frontmatter.map(entry => entry.key),
  ]);
  compare(
    'frontmatter.order',
    expected.frontmatter.map(entry => entry.key),
    actual.frontmatter.map(entry => entry.key),
    differences,
  );
  for (const key of keys) {
    compare(
      `frontmatter.${key}`,
      expected.frontmatter.find(entry => entry.key === key)?.value,
      actual.frontmatter.find(entry => entry.key === key)?.value,
      differences,
    );
  }
  compare('description', expected.description, actual.description, differences);
  compare('acceptanceCriteria', expected.acceptanceCriteria, actual.acceptanceCriteria, differences);
  compare('definitionOfDone', expected.definitionOfDone, actual.definitionOfDone, differences);
  compare('body', expected.body, actual.body, differences);
  return differences;
}

export interface RoundTripResult {
  readonly differences: readonly FieldDifference[];
  readonly byteIdentical: boolean;
  readonly parsed: TaskRecord;
  readonly serialized: string;
}

/** Parse → serialize → re-parse, reporting every field that failed to survive. */
export function roundTrip(source: string): RoundTripResult {
  const parsed = parseTaskRecord(source);
  const serialized = serializeTaskRecord(parsed);
  return {
    parsed,
    serialized,
    byteIdentical: serialized === source,
    differences: diffTaskRecords(parsed, parseTaskRecord(serialized)),
  };
}
