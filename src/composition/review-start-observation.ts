import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { LiveMissionExecutionContext } from '../application/ports/mission-execution-context.js';
import type { ReviewStartPolicyPorts } from '../application/ports/verification-policy.js';
import type { ReviewOutcomeFacts } from '../application/ports/verification-policy.js';
import { missionId as toMissionId } from '../domain/mission.js';
import { createMissionTerminalCapability } from './mission-terminal-capability.js';
import { createVerificationPolicyReaders,
  type VerificationPolicyReaderServices } from './verification-policy-readers.js';

/** Existing composition services needed only when review-start policy is enabled. */
export type ReviewStartObservationServices = VerificationPolicyReaderServices;

/** The stored review rounds and retained run records an outcome is settled from; an unreadable source throws rather than reads empty. */
async function readOutcomeFacts(rootDir: string, configuration: ParallixConfiguration,
  services: ReviewStartObservationServices, slug: string): Promise<ReviewOutcomeFacts> {
  const loaded = await services.store.load(toMissionId(slug));
  if (loaded.kind !== 'found') { throw new Error(`mission ${slug} review rounds are unavailable (${loaded.kind})`); }
  const history = createMissionTerminalCapability(rootDir, configuration).history(slug);
  if (!history.ok) { throw new Error(`mission ${slug} run history is unavailable`); }
  return { review: 'review' in loaded.mission ? loaded.mission.review ?? null : null,
    runs: history.runs.map(run => ({ runId: run.record.runId, startedAt: run.record.startedAt ?? null, endedAt: run.record.endedAt ?? null })) };
}

function createVerificationActionPolicyPorts(
  rootDir: string,
  targetBranch: string,
  slug: string,
  configuration: ParallixConfiguration,
  services: ReviewStartObservationServices,
): Omit<ReviewStartPolicyPorts, 'diagnostic'> | undefined {
  const readers = createVerificationPolicyReaders(rootDir, configuration, services);
  if (!readers) { return undefined; }
  return {
    configuration: readers.configuration,
    repositoryId: services.repositoryId,
    targetBranch,
    operationId: configuration.runtime.workflowOperation ?? null,
    loadPolicy: readers.loadPolicy,
    identity: readers.identity,
    writer: services.history,
    readHistory: signal => readers.readHistoryFor(slug, signal),
    readOutcomeFacts: () => readOutcomeFacts(rootDir, configuration, services, slug),
  };
}

/** Off returns before constructing any artifact, history, Git, gate or operation reader. */
export function createReviewStartPolicyPorts(
  executionContext: Pick<LiveMissionExecutionContext, 'missionWorktree' | 'baseBranch'>,
  slug: string,
  configuration: ParallixConfiguration,
  services: ReviewStartObservationServices,
): Omit<ReviewStartPolicyPorts, 'diagnostic'> | undefined {
  return createVerificationActionPolicyPorts(executionContext.missionWorktree, executionContext.baseBranch,
    slug, configuration, services);
}

/** Integration-action factory reuses the same readers, identity and sole writer as review starts. */
export function createTestsActionPolicyFactory(configuration: ParallixConfiguration,
  services: ReviewStartObservationServices) {
  return ({ rootDir, targetBranch, slug }: { rootDir: string; targetBranch: string; slug: string }) =>
    createVerificationActionPolicyPorts(rootDir, targetBranch, slug, configuration, services);
}
