/**
 * `px migrate-legacy-adhoc-ids` — explicit, operator-triggered rewrite of
 * legacy `parallix-adhoc-<…>` mission ids to counter-owned `px-<NNNN>` ids
 * (task-2706).
 *
 * The command exists only to trigger and report the rewrite. It owns no task
 * catalog and no task operations: every reassignment goes through the Mission
 * store's own atomic, collision-safe, repository scoped migration, so this is
 * not a second task CLI. No other command invokes it.
 */
import * as fmt from '../../application/presentation/cli-format.js';
import type { MigrateLegacyAdhocIdsResult } from '../../application/domain-ports.js';

export function createMigrateLegacyAdhocIdsCommand(
  migrate: () => Promise<MigrateLegacyAdhocIdsResult>,
  logFn: (_message: string) => void = fmt.log.plain,
  exitFn: (_code: number) => void = (code) => { process.exitCode = code; },
) {
  return async (_args: readonly string[]): Promise<number> => {
    let report: MigrateLegacyAdhocIdsResult;
    try {
      report = await migrate();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logFn(fmt.status('FAIL', `Legacy adhoc id migration failed: ${message}`));
      exitFn(1);
      return 1;
    }
    logFn(fmt.status(
      'INFO',
      `Legacy adhoc id migration${report.migrated.length > 0 ? '' : ': '}`
        + `rewrote ${report.migrated.length} id(s).`,
    ));
    for (const { from, to, repositoryId } of report.migrated) {
      logFn(`  ${from} → ${to} (repository ${repositoryId})`);
    }
    return 0;
  };
}
