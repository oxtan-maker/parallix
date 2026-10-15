import * as fmt from '../../application/presentation/cli-format.js';
import type { RevokeReviewDecisionUseCase } from '../../application/revoke-review-decision-use-case.js';

export const REVOKE_REVIEW_HELP = `Usage: px revoke-review [--slug <slug>] --decision <round-number> --reason <text> --operator <name>

Withdraw the current effective approval after an operator's human judgement,
or because the branch moved away from the change it approved (px status reports
that as a stale approval). The approval remains in review history with the
operator, time, and reason; a stale approval's new round reviews the revision
that would land.`;

function value(args: readonly string[], name: string): string | null {
  const index = args.lastIndexOf(name);
  const result = index < 0 ? null : args[index + 1] ?? null;
  return result && !result.startsWith('--') ? result : null;
}

export function createRevokeReviewCommand(
  useCase: Pick<RevokeReviewDecisionUseCase, 'execute'>,
  inferSlug: (_explicit?: string) => string | null,
) {
  return async (args: string[], options: { logFn?: (_text: string) => void; errorFn?: (_text: string) => void; exitFn?: (_code?: number) => never } = {}) => {
    const log = options.logFn ?? fmt.log.plain;
    const error = options.errorFn ?? fmt.log.plainError;
    const exit = options.exitFn ?? process.exit;
    if (args.includes('--help') || args.includes('-h')) { log(REVOKE_REVIEW_HELP); return; }
    const slug = value(args, '--slug') ?? inferSlug();
    const rawRound = value(args, '--decision');
    // `--expected-version` is optional: omitting it resolves the current stored
    // version, and the use case's compare-and-swap save still refuses a stale
    // revocation. Supplying it keeps the earlier explicit guard. A present flag
    // with no value is a malformed pin and is refused.
    const expectedVersion = revocationExpectedVersion(args);
    if (!slug || !rawRound) {
      error(fmt.status('FAIL', REVOKE_REVIEW_HELP.trim())); exit(1); return;
    }
    const result = await useCase.execute({
      slug,
      round: Number(rawRound),
      reason: value(args, '--reason') ?? '',
      operator: value(args, '--operator') ?? '',
      expectedVersion,
      occurredAt: new Date().toISOString(),
    });
    reportRevocation(result, rawRound, slug, log, error, exit);
  };
}

function revocationExpectedVersion(args: readonly string[]): number | undefined {
  const versionPresent = args.includes('--expected-version');
  const rawVersion = value(args, '--expected-version');
  let expectedVersion: number | undefined;
  if (versionPresent) {
    if (rawVersion === null) { throw new Error('--expected-version must be a positive integer'); }
    const parsed = Number(rawVersion);
    if (!Number.isSafeInteger(parsed) || parsed < 1) { throw new Error('--expected-version must be a positive integer'); }
    expectedVersion = parsed;
  }
  return expectedVersion;
}

function reportRevocation(result: Awaited<ReturnType<RevokeReviewDecisionUseCase['execute']>>, rawRound: string, slug: string, log: (_text: string) => void, error: (_text: string) => void, exit: (_code?: number) => never): void {
  if (result.status !== 'completed') { error(fmt.status('FAIL', result.error?.message ?? 'Revocation refused')); exit(1); return; }
  log(fmt.status('PASS', `Review decision ${rawRound} revoked for ${slug}. ${result.value!.providerDiagnostic ?? 'Matching provider approval dismissed.'}`));
}
