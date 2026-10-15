/**
 * Coerce a CSV cell into a numeric value for INTEGER/REAL columns. An empty or
 * unparseable cell becomes SQL NULL ("unavailable"), which is distinct from a
 * measured 0 and matches the domain's `Measurement<'unavailable'>` kind. node:sqlite
 * stores integer-valued numbers as INTEGER and fractional ones as REAL by affinity.
 */
function numericCell(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseStatsRecords(lines: readonly string[]) {
  const headers = parseCsvLine(lines[0]);

  // Parse all records — malformed records are reported but do not abort
  // the entire import. Valid records are committed in a single transaction.
  const records: Record<string, string>[] = [];
  const skipped = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    try {
      const values = parseCsvLine(line, headers.length, i + 1);
      const record: Record<string, string> = {};
      headers.forEach((header: string, idx: number) => {
        record[header] = values[idx] || '';
      });
      // Validate required fields: at least repo or date must be present
      if (!record['repo'] && !record['date']) {
        throw new Error(
          `Row at line ${i + 1} has no repo or date field`,
        );
      }
      records.push(record);
    } catch (err) {
      skipped.push({ line: i + 1, error: (err as Error).message });
    }
  }

  return { records, skipped };
}
export function statsValues(record: Record<string, string>) {
  return [
    record['date'] ?? null,
    record['repo'] || '',
    record['mission'] || '',
    record['classification'] ?? null,
    record['implementer'] ?? null,
    numericCell(record['pr_fix_rounds']),
    record['provider'] ?? null,
    record['model'] ?? null,
    record['implementer_agent'] ?? null,
    record['reviewer_agent'] ?? null,
    record['stage'] || 'default',
    numericCell(record['input_tokens']),
    numericCell(record['output_tokens']),
    numericCell(record['cached_tokens']),
    numericCell(record['thoughts_tokens']),
    numericCell(record['context_tokens']),
    numericCell(record['tool_calls']),
    numericCell(record['openai_usage_before']),
    numericCell(record['openai_usage_after']),
    numericCell(record['openai_usage_delta']),
    numericCell(record['duration_minutes']),
    numericCell(record['cost_usd']),
  ];
}
/**
 * Parse a single CSV line into an array of field values.
 * Validates column count and unmatched quotes.
 */
export function parseCsvLine(
  line: string,
  expectedColumns?: number,
  lineNumber?: number,
): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());

  // Check for unmatched quotes
  if (inQuotes) {
    throw new Error(
      `Unmatched quote at line ${lineNumber ?? '?'}; " was not closed`,
    );
  }

  // Validate column count matches headers
  if (expectedColumns !== undefined && result.length !== expectedColumns) {
    throw new Error(
      `Expected ${expectedColumns} columns but found ${result.length} ` +
      `at line ${lineNumber ?? '?'}; likely a malformed row`,
    );
  }

  return result;
}
