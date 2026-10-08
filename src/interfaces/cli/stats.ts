import { renderClassifierStatistics } from '../../application/presentation/classifier-statistics.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { createRangeWindow } from '../../application/services/statistics-row.js';
import type { StatsRow } from '../../application/services/statistics-row.js';
import type { StatsReportSelection } from '../../application/services/statistics-report-selection.js';
import type { StatsCommandUseCase } from '../../application/stats-command-use-case.js';

export interface StatsCommandOptions {
  readonly rootDir?: string;
  readonly log?: (_message: string) => unknown;
  readonly error?: (_message: string) => unknown;
  readonly exit?: (_code?: number) => unknown;
}

export interface StatsPresentation {
  renderWeekly(_rows: readonly StatsRow[], _options: { rootDir: string; selection: StatsReportSelection<StatsRow> }): string;
  renderRange(_rows: readonly StatsRow[], _options: { rootDir: string; selection: StatsReportSelection<StatsRow> }): string;
  renderMission(_rows: readonly StatsRow[], _mission: string, _options: { rootDir: string }): string;
  writeReport(_file: string, _report: string): void;
  cohorts(_args: string[], _options: StatsCommandOptions): Promise<void>;
}

export function printStatsUsage(log: (_message: string) => unknown = fmt.log.plain): void {
  log(`Usage: px stats [--today YYYY-MM-DD] [--from YYYY-MM-DD --to YYYY-MM-DD] [--output <file>]
       px stats cohorts [--by label|implementer|model|provider] [--min-sample <n>]

Examples:
  px stats
  px stats --today 2026-05-18
  px stats --from 2026-05-01 --to 2026-05-31
  px stats architecture migration
  px stats --mission architecture migration
  px stats cohorts
  px stats cohorts --by implementer --min-sample 8

Notes:
  - The measurement DATABASE is the authority for statistics:
    <PARALLIX_HOME>/parallix.db. The command reads the database, and an
    unavailable database fails the command.
  - Pass a mission slug (e.g. architecture migration) or --mission <slug> to print a single
    mission broken down by phase (draft, execute, review, follow-up).
  - "px stats cohorts" compares completed missions along one experiment
    dimension. Every cohort figure is printed beside its sample size n, and a
    cohort with too few completed missions is marked low-sample rather than
    presented as a comparable result. Run "px stats cohorts --help" for detail.
  - Workflow-owned stats datasets print the current/previous-week summary tables by default.
  - Weekly and range reports include full UTC ISO weeks of bug-labeled Mission
    counts and shares, a 3-week trailing average, and falling/rising/flat direction.
    Empty weeks show no completions. Labels come from Mission state.
  - Use --from and --to together to print one inclusive arbitrary-range report.`);
}

export function createStatsCommand(useCase: Pick<StatsCommandUseCase<StatsRow>, 'execute'>, presentation: StatsPresentation) {
  return async (args: string[], options: StatsCommandOptions = {}): Promise<void> => {
    const log = options.log ?? fmt.log.plain;
    const error = options.error ?? fmt.log.plainError;
    const exit = options.exit ?? process.exit;
    const rootDir = options.rootDir ?? process.cwd();
    if (args[0] === 'cohorts') { await presentation.cohorts(args.slice(1), options); return; }
    if (args.includes('--help') || args.includes('-h')) { printStatsUsage(log); return; }
    const { outputFile, today, from, to, mission } = parseStatsArgs(args);
    const range = from !== null || to !== null;
    let report: string;
    try {
      if (!mission && range) { createRangeWindow({ from: from || undefined, to: to || undefined }); }
      const result = await useCase.execute({
        mode: mission ? 'mission' : range ? 'range' : 'weekly',
        mission: mission ?? undefined, today, from: from || undefined, to: to || undefined,
      });
      if (mission) {
        report = presentation.renderMission(result.rows, mission, { rootDir });
      } else {
        log(fmt.status('INFO', `Loaded ${result.rows.length} measurements from the statistics database`));
        if (!result.selection) { throw new Error('Statistics report selection is missing.'); }
        report = range
          ? presentation.renderRange(result.rows, { rootDir, selection: result.selection })
          : presentation.renderWeekly(result.rows, { rootDir, selection: result.selection });
        if (result.selection.previous) {
          report += `\n\n${renderClassifierStatistics(result.classifierStatistics ?? null, [result.selection.current.window, result.selection.previous.window])}`;
        }
      }
    } catch (failure) {
      error(fmt.status('FAIL', failure instanceof Error ? failure.message : String(failure)));
      exit(1);
      return;
    }
    if (outputFile) {
      presentation.writeReport(outputFile, `${report}\n`);
      log(fmt.status('PASS', `Report written to ${outputFile}`));
    } else { log(report); }
  };
}

const STATS_VALUE_FLAGS: Readonly<Record<string, 'mission' | 'outputFile' | 'today' | 'from' | 'to'>> = {
  '--mission': 'mission', '--output': 'outputFile', '--today': 'today', '--from': 'from', '--to': 'to',
};
const MISSION_SLUG_RE = /^[a-z][a-z0-9]*-\d+$/i;

export function parseStatsArgs(args: string[]) {
  const parsed: { outputFile: string | null; today: string | Date; from: string | null; to: string | null; mission: string | null } = {
    outputFile: null, today: new Date(), from: null, to: null, mission: null,
  };
  const positional: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const field = STATS_VALUE_FLAGS[arg];
    if (field) {
      if (i + 1 < args.length) { parsed[field] = args[i + 1]; i += 1; }
      else if (field === 'from' || field === 'to') { parsed[field] = ''; i += 1; }
      continue;
    }
    if (!arg.startsWith('--')) { positional.push(arg); }
  }
  if (!parsed.mission && positional.length && MISSION_SLUG_RE.test(positional[0])) { parsed.mission = positional[0]; }
  return parsed;
}
