import type { ParallixConfiguration } from '../../../application/ports/configuration.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as fmt from '../../../application/presentation/cli-format.js';
import stats from './stats.js';
import { compareCodeUnits } from '../../../domain/comparators.js';
import { git } from '../../git/git.js';
import {
  getTaskFrontmatterValue,
  getTaskStatus,
  resolveTaskFile,
} from '../../backlog/backlog.js';
import { findMissionDir } from '../../filesystem/mission-utils.js';
import type { StatsBackfillService } from '../../../application/stats-backfill-service.js';

interface StatsAugmented {
  resolveMissionClassification: (_slug: string, _rootDir?: string, _readLabels?: undefined, _configuration?: ParallixConfiguration) => { classification?: string | null; source?: string };
  resolveStatsRepoName: (_rootDir: string) => string;
  loadMeasurementRows: (_options?: { configuration?: ParallixConfiguration; rootDir?: string; dbPath?: string; store?: unknown }) => { rows: Record<string, string>[] };
  deriveImplementerAndFixRounds: (_slug: string, _rootDir?: string, _missionStore?: unknown) => { implementer: string; prFixRounds: number | null; source: string };
  upsertMeasurementRow: (_row: Record<string, string>, _options?: { rootDir?: string; dbPath?: string; store?: unknown }) => { changed: boolean };
}

function getStats(): StatsAugmented {
  return stats as unknown as StatsAugmented;
}

function hasCheckpointFiles(missionDir: string) {
  if (!missionDir || !fs.existsSync(missionDir)) {return false;}
  return fs.readdirSync(missionDir).some(file => /^CP-\d+\.md$/i.test(file) || /^CHECKPOINT_FINAL\.md$/i.test(file));
}

function listHistoricalMissionSlugs(rootDir = process.cwd()) {
  const missionsRoot = path.join(rootDir, 'docs', 'missions');
  if (!fs.existsSync(missionsRoot)) {return [];}

  const slugs = [];
  for (const year of fs.readdirSync(missionsRoot).sort(compareCodeUnits)) {
    const yearDir = path.join(missionsRoot, year);
    if (!/^\d{4}$/.test(year) || !fs.statSync(yearDir).isDirectory()) {continue;}
    for (const slug of fs.readdirSync(yearDir).sort(compareCodeUnits)) {
      if (!/^task-\d+/i.test(slug)) {continue;}
      const missionDir = path.join(yearDir, slug);
      if (!fs.statSync(missionDir).isDirectory()) {continue;}
      if (!hasCheckpointFiles(missionDir)) {continue;}
      slugs.push(slug);
    }
  }
  return slugs;
}

function extractDateOnly(value: unknown) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function normalizeHistoricalImplementer(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {return null;}
  if (/(^|[^a-z])codex([^a-z]|$)/.test(normalized)) {return 'codex';}
  if (/(^|[^a-z])claude([^a-z]|$)/.test(normalized)) {return 'claude';}
  if (/(^|[^a-z])gemini([^a-z]|$)/.test(normalized)) {return 'gemini';}
  if (/(^|[^a-z])custom([^a-z]|$)/.test(normalized)) {return 'custom';}
  if (/(^|[^a-z])vibe([^a-z]|$)/.test(normalized)) {return 'vibe';}
  if (/(^|[^a-z])magnus([^a-z]|$)/.test(normalized)) {return 'magnus';}
  if (/(^|[^a-z])human([^a-z]|$)/.test(normalized)) {return 'human';}
  return null;
}

function deriveImplementerFromGitHistory(slug: string, taskFile: string, rootDir = process.cwd()) {
  const missionDir = findMissionDir(slug, rootDir);
  const targets: string[] = [missionDir, taskFile].filter((x): x is string => Boolean(x));
  if (targets.length === 0) {return null;}

  const result = git(['-C', rootDir, 'log', '--all', '--format=%an|%ae', '--', ...targets]);
  if (result.status !== 0) {return null;}

  const authors: string[] = result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [name = '', email = ''] = line.split('|');
      return normalizeHistoricalImplementer(email) || normalizeHistoricalImplementer(name);
    })
    .filter(Boolean) as string[];

  if (authors.length === 0) {return null;}
  // new Set(authors)[0] == authors[0]: first author, dedupe irrelevant to element 0.
  return authors[0];
}

function deriveDateFromGitHistory(slug: string, taskFile: string, rootDir = process.cwd()) {
  const missionDir = findMissionDir(slug, rootDir);
  const targets: string[] = [missionDir, taskFile].filter((x): x is string => Boolean(x));
  if (targets.length === 0) {return null;}

  const result = git(['-C', rootDir, 'log', '--all', '-1', '--date=short', '--format=%cd', '--', ...targets]);
  if (result.status !== 0) {return null;}
  return extractDateOnly(result.stdout.trim());
}

function resolveHistoricalClassification(slug: string, rootDir = process.cwd(), configuration?: ParallixConfiguration) {
  const s = getStats();
  const resolution = s.resolveMissionClassification(slug, rootDir, undefined, configuration);
  return { value: resolution.classification || null, source: 'mission-state' };
}

type HistoricalMissionOutcome =
  | { kind: 'row'; row: any }
  | { kind: 'unresolved'; unresolved: any }
  | { kind: 'skipped'; skipped: any };

async function collectHistoricalMission(slug: string, rootDir: string, repoName: string, missionStore: unknown, stats: ReturnType<typeof getStats>, configuration?: ParallixConfiguration): Promise<HistoricalMissionOutcome> {
  const taskResolution = resolveTaskFile(slug, rootDir);
  if (!taskResolution.ok) {
    return { kind: 'unresolved', unresolved: { slug, reason: 'task-resolution', detail: taskResolution.reason } };
  }
  const taskFile = taskResolution.taskFile!;
  const status = getTaskStatus(taskFile);
  if (status !== 'done') {
    return { kind: 'skipped', skipped: { slug, reason: `status=${status || 'unknown'}` } };
  }
  const date = extractDateOnly(getTaskFrontmatterValue(taskFile, 'updated_date') ?? '') || deriveDateFromGitHistory(slug, taskFile, rootDir);
  const classification = resolveHistoricalClassification(slug, rootDir, configuration);
  let implementerInfo: { implementer: string; prFixRounds: number | null; source: string } | null = null;
  let implementerError: string | null = null;
  try {
    implementerInfo = await Promise.resolve(stats.deriveImplementerAndFixRounds(slug, rootDir, missionStore));
  } catch (error) {
    implementerError = error instanceof Error ? error.message : String(error);
  }
  if (!implementerInfo?.implementer || implementerInfo.implementer === 'unknown') {
    const gitHistoryImplementer = deriveImplementerFromGitHistory(slug, taskFile, rootDir);
    if (gitHistoryImplementer) {
      implementerInfo = { implementer: gitHistoryImplementer, prFixRounds: 0, source: 'git-history-author' };
    }
  }
  if (!date || !classification.value || !implementerInfo?.implementer) {
    return {
      kind: 'unresolved', unresolved: {
        slug,
        reason: 'missing-fields',
        date: date || null,
        classification: classification.value || null,
        implementer: implementerInfo?.implementer || null,
        prFixRounds: implementerInfo?.prFixRounds ?? null,
        sources: { classification: classification.source, implementer: implementerInfo?.source || null },
        missing: [...(!date ? ['date'] : []), ...(!classification.value ? ['classification'] : []), ...(!implementerInfo?.implementer ? ['implementer'] : [])],
        detail: implementerError,
      },
    };
  }
  return {
    kind: 'row', row: {
      date,
      repo: repoName,
      mission: slug,
      classification: classification.value,
      implementer: implementerInfo.implementer,
      pr_fix_rounds: String(implementerInfo.prFixRounds),
      sources: { date: 'backlog-updated_date', classification: classification.source, implementer: implementerInfo.source },
    },
  };
}

/**
 * @param rootDir Repository root the historical missions are read from.
 * @param options Measurement-store selection. `dbPath`/`store` let fast
 *   isolated tests bind a temporary database instead of `<PARALLIX_HOME>`.
 * @param missionStore Operator Mission authority for the authoritative
 *   implementer/fix-round derivation (TASK-2378). Without it the derivation
 *   throws the invariant error and the historical git-history fallback below
 *   is the only source — which is what pre-cutover missions have always used.
 */
async function collectHistoricalStatsBackfill(
  rootDir = process.cwd(),
  options: { configuration?: ParallixConfiguration; dbPath?: string; store?: unknown } = {},
  missionStore?: unknown,
) {
  const s = getStats();
  // architecture migration: the already-recorded missions come from the measurement
  // database, not from a resolved stats.csv.
  const repoName = s.resolveStatsRepoName(rootDir);
  const existingMissions = new Set(
    s.loadMeasurementRows({ configuration: options.configuration, rootDir, dbPath: options.dbPath, store: options.store }).rows
      .filter((row: Record<string, string>) => String(row.repo || '').trim() === repoName)
      .map((row: Record<string, string>) => row.mission)
  );
  const rows = [];
  const unresolved = [];
  const skipped = [];

  for (const slug of listHistoricalMissionSlugs(rootDir)) {
    if (existingMissions.has(slug)) {continue;}
    const outcome = await collectHistoricalMission(slug, rootDir, repoName, missionStore, s, options.configuration);
    if (outcome.kind === 'row') { rows.push(outcome.row); }
    if (outcome.kind === 'unresolved') { unresolved.push(outcome.unresolved); }
    if (outcome.kind === 'skipped') { skipped.push(outcome.skipped); }
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.mission.localeCompare(b.mission));
  unresolved.sort((a, b) => a.slug.localeCompare(b.slug));
  skipped.sort((a, b) => a.slug.localeCompare(b.slug));

  return { rows, unresolved, skipped };
}

function renderBackfillSummary(report: { rows: readonly any[]; unresolved: readonly any[]; skipped: readonly any[] }) {
  const lines = [];
  lines.push(`Resolved rows: ${report.rows.length}`);
  lines.push(`Unresolved missions: ${report.unresolved.length}`);
  lines.push(`Skipped missions: ${report.skipped.length}`);
  lines.push('');

  pushSummarySection(lines, 'Resolved:', row => `- ${row.date} ${row.mission} ${row.classification} ${row.implementer} ${row.pr_fix_rounds} [${row.sources.classification}/${row.sources.implementer}]`, report.rows);
  pushSummarySection(lines, 'Unresolved:', item => {
    const missing = Array.isArray(item.missing) && item.missing.length > 0 ? ` missing=${item.missing.join(',')}` : '';
    const detail = item.detail ? ` detail=${item.detail}` : '';
    return `- ${item.slug} reason=${item.reason}${missing}${detail}`;
  }, report.unresolved);
  pushSummarySection(lines, 'Skipped:', item => `- ${item.slug} ${item.reason}`, report.skipped);

  return lines.join('\n');
}

/** Append a labeled section to `lines`: a header, one `- ` prefixed row per item, and a trailing blank line. Skips empty sections. */
function pushSummarySection(lines: string[], header: string, renderRow: (_item: any) => string, items: readonly any[]): void {
  if (items.length === 0) { return; }
  lines.push(header);
  for (const item of items) {
    lines.push(renderRow(item));
  }
  lines.push('');
}

function printUsage(log = fmt.log.plain) {
  log(`Usage: px stats-backfill [--apply] [--json]

Examples:
  px stats-backfill
  px stats-backfill --json
  px stats-backfill --apply

Notes:
  - This command is for historical stats recovery only.
  - It reads and writes the measurement database (<PARALLIX_HOME>/parallix.db),
    which is the authority for statistics. It never reads or writes a legacy CSV.
  - Classification comes only from stored px Mission labels.
  - Non-done missions are skipped and unresolved missions are reported without being written.`);
}

interface BackfillOptions {
  log?: (_msg: string) => string | null;
  error?: (_msg: string) => string | null;
  exit?: (_code?: number) => never;
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

  let apply = false;
  let json = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
    }
  }
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

  const report = {
    rows: outcome.value.rows,
    unresolved: outcome.value.unresolved || [],
    skipped: outcome.value.skipped || [],
  };
  const changed = outcome.durableEvidence.length;
  const payload = {
    resolved: report.rows.length,
    unresolved: report.unresolved.length,
    skipped: report.skipped.length,
    changed,
    rows: report.rows,
    unresolvedItems: report.unresolved,
    skippedItems: report.skipped,
  };

  if (json) {
    log(JSON.stringify(payload, null, 2));
  } else {
    log(renderBackfillSummary(report));
    if (apply) {
      log('');
      log(fmt.status('PASS', `Applied ${changed} stats rows to the measurement database`));
    }
  }

  if (apply && report.unresolved.length > 0) {
    error(fmt.status('INFO', `${report.unresolved.length} missions remain unresolved and were not written.`));
  }
}

(statsBackfill as any).collectHistoricalStatsBackfill = collectHistoricalStatsBackfill;
(statsBackfill as any).extractDateOnly = extractDateOnly;
export default statsBackfill;
export { statsBackfill, collectHistoricalStatsBackfill, extractDateOnly };
