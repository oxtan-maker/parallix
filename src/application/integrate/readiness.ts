/**
 * The trust evidence a human needs to authorize landing, and nothing else.
 */
import * as fmt from '../presentation/cli-format.js';

/**
 * Every row is a claim Parallix can establish authoritatively: the Mission
 * store's own Review (ADR 0053), the integration gate result (ADR 0041), and
 * git. A claim that cannot be established is omitted rather than guessed —
 * notably, invoking `px integrate` *is* the human decision, so no row ever
 * asserts that a human inspected the diff.
 */
export function buildIntegrationReadiness(
  context: any,
  { verification }: { verification: string },
  primaryBranch: () => string,
): [string, string][] {
  const rounds: any[] = context.missionReview?.rounds ?? [];
  const approvedRound = [...rounds].reverse().find(round => round?.decision?.kind === 'approved') ?? null;
  const lastRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  const evidenceRound = approvedRound ?? lastRound;

  const rows: [string, string][] = [['Mission', context.slug]];

  if (approvedRound) {
    rows.push(['Review', `approved (round ${approvedRound.number})`]);
  } else if (context.approval?.ok && context.approval?.reviewState === 'APPROVED') {
    rows.push(['Review', 'approved']);
  }

  const reviewer = evidenceRound?.reviewer ?? null;
  const implementer = evidenceRound?.implementer ?? null;
  if (reviewer) {
    rows.push(['Reviewer', String(reviewer)]);
  }
  if (reviewer && implementer) {
    rows.push([
      'Independence',
      reviewer === implementer
        ? `same agent family as the implementer (${implementer})`
        : `different agent family from the implementer (${implementer})`,
    ]);
  }

  rows.push(['Verification', verification]);
  rows.push(['Target', String(context.baseBranch || primaryBranch())]);
  rows.push([
    'Workspace',
    context.mainDirty
      ? `${context.mainDirtyEntries.length} uncommitted change(s) in the integration checkout`
      : 'clean',
  ]);

  return rows;
}

export function printIntegrationReadiness(rows: [string, string][], { log = fmt.log.plain }: { log?: Function } = {}) {
  log('');
  log(fmt.bold('READY TO INTEGRATE'));
  log(fmt.table(rows.map(([label, value]) => [label, value])));
  log('');
}
