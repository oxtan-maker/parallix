import { AsyncLocalStorage } from 'node:async_hooks';
import type { MissionStore } from '../application/domain-ports.js';
import type { ReviewOperatorResumePort } from '../application/ports/review-round.js';
import { MissionCheckpointService } from '../application/mission-checkpoint-service.js';
import { missionId } from '../domain/mission.js';

const cliInvocation = new AsyncLocalStorage<boolean>();

/** Reentrant public CLI calls are nested work, even without a publisher. */
export function withinCliInvocation<T>(requested: boolean, invoke: (_direct: boolean) => T): T {
  const direct = requested && !cliInvocation.getStore();
  return cliInvocation.run(true, () => invoke(direct));
}

/** Borrowed registries and automatic/nested work receive no acknowledgment port. */
export function bindReviewOperatorResume(
  store: MissionStore,
  direct: boolean,
  options: { readonly nestedWork?: unknown; readonly integrationOwnsReview?: unknown },
): ReviewOperatorResumePort | undefined {
  if (!direct || options.nestedWork || options.integrationOwnsReview) { return undefined; }
  return {
    acknowledge: async slug => {
      await new MissionCheckpointService(store).acknowledgeOperatorResume({
        operationId: `review-entry:${slug}`, missionId: missionId(slug),
        capabilities: new Set(['checkpoint:record']), actor: 'px review operator', occurredAt: new Date().toISOString(),
      });
    },
  };
}
