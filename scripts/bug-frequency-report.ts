// Read-only bug-frequency cohort report (ADR 0051 §"Reliability measurement",
// TASK-2289 acceptance criterion #8, TASK-2361).
//
// Thin IO shell over the pure classification module in
// src/application/projections/bug-frequency.ts: this script enumerates the
// cohort — either from a frozen ledger or directly from git history — reads
// the backlog task stores from the working tree, and feeds the module. It
// performs no write except an explicit `--output` file and mutates no task
// record, label, status, or git state.
//
// Usage:
//   tsx scripts/bug-frequency-report.ts --ledger missions/task-2361/cohort-ledger.json
//   tsx scripts/bug-frequency-report.ts --enumerate 1c9e40f41... --ref main
//   Options:
//     --series <name>        series label recorded in the output (default "cohort")
//     --stores <a,b,...>     backlog stores to scan at report time
//                            (default backlog/tasks,backlog/completed,
//                             backlog/archive,backlog/archive/tasks)
//     --repo <dir>           repository root to read from (default cwd)
//     --cohort-size <n>      cohort size for --enumerate (default 20)
//     --output <file>        write the JSON report here instead of stdout

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  measureBugFrequency,
  type BugFrequencyStore,
  type BugFrequencyTaskFile,
} from '../src/application/projections/bug-frequency.js';

interface RunnerOptions {
  readonly ledgerPath: string | null;
  readonly enumerateBoundary: string | null;
  readonly ref: string;
  readonly series: string;
  readonly stores: readonly string[];
  readonly repoRoot: string;
  readonly cohortSize: number;
  readonly outputPath: string | null;
}

function fail(message: string): never {
  process.stderr.write(`bug-frequency-report: ${message}\n`);
  process.exit(2);
}

function parseOptions(argv: readonly string[]): RunnerOptions {
  const options = {
    ledgerPath: null as string | null,
    enumerateBoundary: null as string | null,
    ref: 'main',
    series: 'cohort',
    stores: ['backlog/tasks', 'backlog/completed', 'backlog/archive', 'backlog/archive/tasks'],
    repoRoot: process.cwd(),
    cohortSize: 20,
    outputPath: null as string | null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) { fail(`missing value for ${arg}`); }
      i += 1;
      return value;
    };
    switch (arg) {
      case '--ledger': options.ledgerPath = next(); break;
      case '--enumerate': options.enumerateBoundary = next(); break;
      case '--ref': options.ref = next(); break;
      case '--series': options.series = next(); break;
      case '--stores': options.stores = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--repo': options.repoRoot = next(); break;
      case '--cohort-size': options.cohortSize = Number(next()); break;
      case '--output': options.outputPath = next(); break;
      default: fail(`unknown argument ${arg}`);
    }
  }
  if ((options.ledgerPath === null) === (options.enumerateBoundary === null)) {
    fail('provide exactly one of --ledger <path> or --enumerate <boundary-commit>');
  }
  if (!Number.isInteger(options.cohortSize) || options.cohortSize <= 0) {
    fail('--cohort-size must be a positive integer');
  }
  return options;
}

function storeOf(storePath: string): BugFrequencyStore {
  if (storePath === 'backlog/completed') { return 'completed'; }
  if (storePath.startsWith('backlog/archive')) { return 'archive'; }
  return 'tasks';
}

function readStoreFiles(repoRoot: string, stores: readonly string[]): BugFrequencyTaskFile[] {
  const files: BugFrequencyTaskFile[] = [];
  for (const store of stores) {
    const dir = path.join(repoRoot, store);
    if (!fs.existsSync(dir)) { continue; }
    for (const entry of fs.readdirSync(dir).sort()) {
      if (!entry.endsWith('.md')) { continue; }
      const absolute = path.join(dir, entry);
      if (!fs.statSync(absolute).isFile()) { continue; }
      files.push({
        path: `${store}/${entry}`,
        rawText: fs.readFileSync(absolute, 'utf8'),
        store: storeOf(store),
      });
    }
  }
  return files;
}

interface CohortSelection {
  readonly ids: readonly string[];
  readonly boundaryCommit: string;
  readonly enumerationCommand: string | null;
  readonly tieBreaker: readonly string[] | null;
  readonly eligibleUniqueTotal: number | null;
}

const FILENAME_ID_PATTERN = /^task-([0-9]+(?:\.[0-9]+)?) - .*\.md$/;

/** Frozen-ledger mode: the cohort membership was already fixed by the mission. */
function cohortFromLedger(repoRoot: string, ledgerPath: string): CohortSelection {
  const ledger = JSON.parse(fs.readFileSync(path.join(repoRoot, ledgerPath), 'utf8')) as {
    boundary?: { commit?: string };
    enumeration_command?: string;
    tie_breaker?: string[];
    eligible_unique_total?: number;
    cohort?: Array<{ id: string }>;
  };
  if (!Array.isArray(ledger.cohort) || ledger.cohort.length === 0) {
    fail(`ledger ${ledgerPath} has no cohort array`);
  }
  return {
    ids: ledger.cohort.map((row) => row.id),
    boundaryCommit: ledger.boundary?.commit ?? 'unknown',
    enumerationCommand: ledger.enumeration_command ?? null,
    tieBreaker: ledger.tie_breaker ?? null,
    eligibleUniqueTotal: ledger.eligible_unique_total ?? null,
  };
}

/**
 * Git-enumeration mode: re-derive the first `cohortSize` unique completed
 * missions strictly after the boundary commit, applying the frozen tie-breaker
 * (committer date ascending, then ancestry order on the ref, then task ID
 * ascending within one commit).
 */
function cohortFromGit(repoRoot: string, boundary: string, ref: string, cohortSize: number): CohortSelection {
  const command = `git -c core.quotePath=false log --reverse --no-renames --diff-filter=A --format=C|%H|%cI|%s --name-only ${boundary}..${ref} -- backlog/completed/`;
  const result = spawnSync(
    'git',
    ['-c', 'core.quotePath=false', 'log', '--reverse', '--no-renames', '--diff-filter=A',
      '--format=C|%H|%cI|%s', '--name-only', `${boundary}..${ref}`, '--', 'backlog/completed/'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    fail(`enumeration failed (${result.status}): ${result.stderr.trim()}`);
  }

  interface Addition { readonly commit: string; readonly date: string; readonly order: number; readonly path: string; readonly id: string; }
  const additions: Addition[] = [];
  let current: { commit: string; date: string } | null = null;
  let order = 0;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('C|')) {
      const parts = line.split('|');
      current = { commit: parts[1] ?? '', date: parts[2] ?? '' };
    } else if (line.trim() !== '' && current !== null) {
      const match = line.split('/').pop()?.match(FILENAME_ID_PATTERN);
      if (match) {
        additions.push({ ...current, order: order += 1, path: line, id: `TASK-${match[1]}` });
      }
    }
  }

  additions.sort((left, right) => {
    const byDate = Date.parse(left.date) - Date.parse(right.date);
    if (byDate !== 0) { return byDate; }
    if (left.commit !== right.commit) { return left.order - right.order; }
    return left.id.localeCompare(right.id, 'en', { numeric: true });
  });

  const seen = new Set<string>();
  const unique: Addition[] = [];
  for (const addition of additions) {
    if (seen.has(addition.id)) { continue; }
    seen.add(addition.id);
    unique.push(addition);
  }

  return {
    ids: unique.slice(0, cohortSize).map((addition) => addition.id),
    boundaryCommit: boundary,
    enumerationCommand: command,
    tieBreaker: [
      'committer date ascending (%cI)',
      `then ancestry order on ${ref} (git log --reverse)`,
      'then task ID ascending within the same commit',
    ],
    eligibleUniqueTotal: unique.length,
  };
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const repoRoot = path.resolve(options.repoRoot);
  const selection = options.ledgerPath !== null
    ? cohortFromLedger(repoRoot, options.ledgerPath)
    : cohortFromGit(repoRoot, options.enumerateBoundary!, options.ref, options.cohortSize);

  const measurement = measureBugFrequency({
    cohortIds: selection.ids,
    files: readStoreFiles(repoRoot, options.stores),
  });

  const report: Record<string, unknown> = {
    series: options.series,
    read_time: new Date().toISOString(),
    boundary_commit: selection.boundaryCommit,
    ...(selection.enumerationCommand !== null
      ? { enumeration_command: selection.enumerationCommand }
      : {}),
    ...(selection.tieBreaker !== null ? { tie_breaker: selection.tieBreaker } : {}),
    ...(selection.eligibleUniqueTotal !== null
      ? { eligible_unique_total: selection.eligibleUniqueTotal }
      : {}),
    cohort_ids: selection.ids,
    total: measurement.total,
    bug: measurement.bug,
    nonBug: measurement.nonBug,
    bugOverTotal: measurement.bugOverTotal,
    bugPer100NonBug: measurement.bugPer100NonBug,
    bugIds: measurement.bugIds,
    nonBugIds: measurement.nonBugIds,
    warnings: measurement.warnings,
    aborts: measurement.aborts,
    rows: measurement.rows,
  };

  const rendered = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outputPath !== null) {
    fs.writeFileSync(path.resolve(options.outputPath), rendered, 'utf8');
    process.stderr.write(
      `bug-frequency-report: wrote ${options.series} measurement to ${options.outputPath} `
      + `(total ${measurement.total}, bug ${measurement.bug}, nonBug ${measurement.nonBug})\n`,
    );
  } else {
    process.stdout.write(rendered);
  }
}

main();
