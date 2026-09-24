/**
 * `px import-legacy [--dry-run]` — the operator route into the explicit one-way
 * legacy Backlog import (TASK-2521.04).
 *
 * The command exists only to trigger and report the migration. It owns no task
 * catalog and no task operations: every record it materializes goes through the
 * existing Mission intake and lifecycle services, so this is not a second task
 * CLI. No other command invokes the importer.
 */
import * as fmt from '../../application/presentation/cli-format.js';

/**
 * The counts and refusal lines a legacy import reports back.
 *
 * Declared here rather than imported from the backlog adapter: the interfaces
 * layer owns the shape it renders, and composition supplies an implementation
 * that satisfies it. No record is merged by guesswork, so every refusal is a
 * line an operator reads.
 */
export interface LegacyImportReport {
  readonly discovered: number;
  readonly importable: number;
  readonly alreadyMaterialized: number;
  readonly conflicting: number;
  readonly deferred: number;
  readonly unrepresented: number;
  readonly dryRun: boolean;
  readonly conflicts: readonly string[];
  readonly deferredRecords: readonly string[];
  readonly unresolvedDependencies: readonly string[];
  readonly unrepresentedFields: readonly string[];
}

export function createImportLegacyCommand(
  importLegacy: (_options: { readonly dryRun: boolean }) => Promise<LegacyImportReport>,
  logFn: (_message: string) => void = fmt.log.plain,
  exitFn: (_code: number) => void = (code) => { process.exitCode = code; },
) {
  return async (args: readonly string[]): Promise<number> => {
    const unknown = args.filter(arg => arg !== '--dry-run');
    if (unknown.length > 0) {
      logFn(fmt.status('FAIL', `px import-legacy accepts only --dry-run; got ${unknown.join(' ')}`));
      exitFn(1);
      return 1;
    }
    const report = await importLegacy({ dryRun: args.includes('--dry-run') });
    logFn(fmt.status(
      'INFO',
      `Legacy Backlog import${report.dryRun ? ' (dry run — no Mission written)' : ''}: `
      + `discovered ${report.discovered}, importable ${report.importable}, `
      + `already materialized ${report.alreadyMaterialized}, deferred ${report.deferred}, `
      + `conflicting ${report.conflicting}, unrepresented ${report.unrepresented}`,
    ));
    for (const conflict of report.conflicts) { logFn(`  conflict: ${conflict}`); }
    // A deferred record is expected material, not a refusal: it keeps the exit
    // code clean so the operator can rerun the import while TASK-2521.06
    // decides what happens to the legacy lanes past `backlog`.
    for (const deferred of report.deferredRecords) { logFn(`  deferred: ${deferred}`); }
    // A legacy dependency the import could not resolve stays visible instead of
    // being dropped: the Mission it names may be imported by a later run.
    for (const unresolved of report.unresolvedDependencies) { logFn(`  unresolved dependency: ${unresolved}`); }
    for (const field of report.unrepresentedFields) { logFn(`  unrepresented: ${field}`); }
    const code = report.conflicting > 0 ? 1 : 0;
    exitFn(code);
    return code;
  };
}
