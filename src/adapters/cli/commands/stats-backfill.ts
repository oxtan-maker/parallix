import type { StatsRow, StatsBackfillUnresolved, StatsBackfillSkipped } from '../../../application/ports.js';
import * as fmt from '../../../application/presentation/cli-format.js';
import type { StatsBackfillService } from '../../../application/stats-backfill-service.js';

function backfillReport(value: import('../../../application/ports.js').StatsProjection) {
  return { changes: value.changes ?? [], rows: value.rows, unresolved: value.unresolved || [], skipped: value.skipped || [] };
}

function renderBackfillSummary(report: { rows: readonly StatsRow[]; unresolved: readonly StatsBackfillUnresolved[]; skipped: readonly StatsBackfillSkipped[] }) {
  const lines = [];
  lines.push(`Resolved rows: ${report.rows.length}`);
  lines.push(`Unresolved missions: ${report.unresolved.length}`);
  lines.push(`Skipped missions: ${report.skipped.length}`);
  lines.push('');

  pushSummarySection(lines, 'Resolved:', row => `- ${row.date} ${row.mission} ${row.classification} ${row.implementer} ${row.pr_fix_rounds}`, report.rows);
  pushSummarySection(lines, 'Unresolved:', item => {
    const missing = Array.isArray(item.missing) && item.missing.length > 0 ? ` missing=${item.missing.join(',')}` : '';
    const detail = item.detail ? ` detail=${item.detail}` : '';
    return `- ${item.slug} reason=${item.reason}${missing}${detail}`;
  }, report.unresolved);
  pushSummarySection(lines, 'Skipped:', item => `- ${item.slug} ${item.reason}`, report.skipped);

  return lines.join('\n');
}

/** Append a labeled section to `lines`: a header, one `- ` prefixed row per item, and a trailing blank line. Skips empty sections. */
function pushSummarySection<T>(lines: string[], header: string, renderRow: (_item: T) => string, items: readonly T[]): void {
  if (items.length === 0) { return; }
  lines.push(header);
  for (const item of items) {
    lines.push(renderRow(item));
  }
  lines.push('');
}

function printUsage(log: (_message: string) => void = fmt.log.plain) {
  log(`Usage: px stats backfill [--apply] [--json]

Examples:
  px stats backfill
  px stats backfill --json
  px stats backfill --apply

Notes:
  - This command is for historical stats recovery only.
  - It reads and writes the measurement database (<PARALLIX_HOME>/parallix.db),
    which is the authority for statistics. It never reads or writes a legacy CSV.
  - Classification comes only from stored px Mission labels.
  - Dry-run is the default. --apply updates existing measurements idempotently.
  - Unknown counts stay unknown; missing causes or authorship are disclosed.
  - Non-done missions are skipped. Raw Review history is never rewritten.`);
}

function parseBackfillFlags(args: readonly string[]) {
  let apply = false;
  let json = false;

  for (let i = 0;i < args.length;i += 1) {
    const arg = args[i];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
    }
  }
  return { apply, json };
}

interface BackfillOptions {
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
  exit?: (_code?: number) => void;
  rootDir?: string;
  service?: Pick<StatsBackfillService, 'execute'>;
}

async function statsBackfill(args: string[], options: BackfillOptions = {}) {
  const opts = options;
  const log = opts.log || fmt.log.plain;
  const error = opts.error || fmt.log.plainError;
  const exit = opts.exit || process.exit;
  if (args.includes('--help') || args.includes('-h')) {
    printUsage(log);
    return;
  }

  const { apply, json } = parseBackfillFlags(args);
  const service = opts.service;
  if (!service) { throw new Error('stats-backfill command requires an injected service'); }
  const outcome = await service.execute({
    operationId: `stats-backfill:${Date.now()}`,
    apply,
    capabilities: apply ? new Set(['stats:apply'] as const) : new Set(),
  });

  if (outcome.status !== 'completed' || !outcome.value) {
    error(fmt.status('FAIL', outcome.error?.message || 'Could not backfill historical stats.'));
    exit(1);
    return;
  }

  const report = backfillReport(outcome.value);
  const changed = outcome.durableEvidence.length;
  const payload = {
    resolved: report.rows.length,
    unresolved: report.unresolved.length,
    skipped: report.skipped.length,
    changed,
    rows: report.rows,
    changes: report.changes,
    coverage: { missions: report.changes.length, before: report.changes.filter(item => item.beforeObserved).length, after: report.changes.filter(item => item.after !== null).length },
    unresolvedItems: report.unresolved,
    skippedItems: report.skipped,
  };

  printBackfillResult(report, payload, changed, apply, json, log, error);
}

function printBackfillResult(report: ReturnType<typeof backfillReport>, payload: unknown, changed: number, apply: boolean, json: boolean, log: (_msg: string) => unknown, error: (_msg: string) => unknown): void {
  if (json) {
    log(JSON.stringify(payload, null, 2));
  } else {
    log(renderBackfillSummary(report));
    log(`Reconciled mission coverage: ${report.changes.filter(item => item.beforeObserved).length} -> ${report.changes.filter(item => item.after !== null).length}/${report.changes.length}`);
    for (const item of report.changes) { log(`${item.mission}: stored [${item.before.map(count => count ?? 'unknown').join(', ')}] -> ${item.after ?? 'unknown'}; authors=${JSON.stringify(item.byImplementer)}; causes=${item.causes.join(',')}`); }
    if (apply) {
      log('');
      log(fmt.status('PASS', `Applied ${changed} stats rows to the measurement database`));
    }
  }

  if (apply && report.unresolved.length > 0) {
    error(fmt.status('INFO', `${report.unresolved.length} missions have incomplete reconstruction coverage.`));
  }
}

export default statsBackfill;
export { statsBackfill };
