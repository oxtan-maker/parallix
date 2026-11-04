import type { RebaseWorkflowPort } from './ports/rebase-workflow.js';
import { missionId } from '../domain/mission.js';
import type { MissionStore } from './domain-ports.js';
import { agentFamily } from '../domain/agents.js';
import type { MissionLifecycleService } from './mission-lifecycle-service.js';

/** Database identity is authoritative, including absence and read failures. */
export async function rebaseImplementer(store: Pick<MissionStore, 'load'> | null, slug: string): Promise<string | null> {
  if (!store) { throw new Error(`Mission persistence is unavailable for ${slug}`); }
  const loaded = await store.load(missionId(slug));
  if (loaded.kind === 'unavailable') { throw new Error(`Cannot read Mission ${slug}: ${loaded.reason}`); }
  if (loaded.kind === 'missing') { return null; }
  return loaded.mission.assignee?.trim() || null;
}

/** Record the family returned by an actual implementer launch through the existing authority. */
export async function recordImplementerLaunch(slug: string, actual: string, store: Pick<MissionStore, 'load'> | null,
  lifecycle?: Pick<MissionLifecycleService, 'transition'> | null): Promise<void> {
  if (!store) { throw new Error(`Mission persistence is unavailable for ${slug}`); }
  const loaded = await store.load(missionId(slug));
  if (loaded.kind !== 'found') { throw new Error(`Cannot record actual implementer for Mission ${slug}`); }
  const round = loaded.mission.review?.rounds.at(-1);
  if (loaded.mission.assignee === actual && (!round || round.implementer === actual)) { return; }
  if (!lifecycle) { throw new Error(`Mission ${slug} has no lifecycle authority for actual implementer ${actual}`); }
  const result = await lifecycle.transition({
    operationId: `implementer-launch:${slug}:${loaded.version}`, missionId: missionId(slug), expectedVersion: loaded.version,
    capabilities: new Set(['mission:transition']), command: { type: 'record-implementer', agent: agentFamily(actual) },
    actor: actual, occurredAt: new Date().toISOString(),
  });
  if (result.status !== 'completed') { throw new Error(result.error?.message ?? `Cannot record actual implementer ${actual}`); }
}

/** Capture database identity before replay; uncomposed legacy seams support older callers. */
export async function resolveRecordedImplementer(slug: string, executionRoot: string, port: RebaseWorkflowPort): Promise<string | null> {
  if (port.missionServices) {
    const { store } = await port.missionServices(executionRoot);
    return rebaseImplementer(store, slug);
  }
  let missionRecord: { implementer?: string | null } | null = null;
  try {
    missionRecord = await Promise.resolve(port.readReviewState(slug, executionRoot)) as { implementer?: string | null } | null;
  } catch (_) {
    // An unreadable mission record is local metadata unavailability, not an
    // infrastructure failure: fall back to the Backlog task file below.
    missionRecord = null;
  }
  const taskResolution = port.resolveTaskFile(slug, executionRoot);
  return (missionRecord?.implementer || '').trim()
    || (taskResolution.ok && taskResolution.taskFile ? port.getTaskImplementer(taskResolution.taskFile) : null)
    || null;
}
