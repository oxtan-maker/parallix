import * as fmt from '../../application/presentation/cli-format.js';
import type { RevokeReviewDecisionUseCase } from '../../application/revoke-review-decision-use-case.js';

export const REVOKE_REVIEW_HELP = `Usage: px revoke-review [--slug <slug>] --decision <round-number> --reason <text> --operator <name> --expected-version <n>

Withdraw the current effective approval after an operator's human judgement.
The approval remains in review history with the operator, time, and reason.`;

function value(args: readonly string[], name: string): string | null {
  const index = args.lastIndexOf(name);
  const result = index < 0 ? null : args[index + 1] ?? null;
  return result && !result.startsWith('--') ? result : null;
}

export function createRevokeReviewCommand(
  useCase: RevokeReviewDecisionUseCase,
  inferSlug: (_explicit?: string) => string | null,
) {
  return async (args: string[], options: { logFn?: (_text: string) => void; errorFn?: (_text: string) => void; exitFn?: (_code?: number) => never } = {}) => {
    const log = options.logFn ?? fmt.log.plain;
    const error = options.errorFn ?? fmt.log.plainError;
    const exit = options.exitFn ?? process.exit;
    if (args.includes('--help') || args.includes('-h')) { log(REVOKE_REVIEW_HELP); return; }
    const slug = value(args, '--slug') ?? inferSlug();
    const rawRound = value(args, '--decision');
    const rawVersion = value(args, '--expected-version');
    if (!slug || !rawRound || !rawVersion) {
      error(fmt.status('FAIL', REVOKE_REVIEW_HELP.trim())); exit(1); return;
    }
    const result = await useCase.execute({
      slug,
      round: Number(rawRound),
      reason: value(args, '--reason') ?? '',
      operator: value(args, '--operator') ?? '',
      expectedVersion: Number(rawVersion),
      occurredAt: new Date().toISOString(),
    });
    if (result.status !== 'completed') { error(fmt.status('FAIL', result.error?.message ?? 'Revocation refused')); exit(1); return; }
    log(fmt.status('PASS', `Review decision ${rawRound} revoked for ${slug}. ${result.value!.providerDiagnostic ?? 'Matching provider approval dismissed.'}`));
  };
}
