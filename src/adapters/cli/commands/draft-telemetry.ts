

import type { ParallixConfiguration } from "../../../application/ports/configuration.js";
import { type DraftLog } from './draft-adapter-types.js';
import {
  recordDraftImplementerAssignment,
  type DraftImplementerRecordingPort,
} from '../../../application/draft-command-use-case.js';

import { providerResourceObservation, type ProviderResourceObservation } from '../../../application/run-history-types.js';

import * as fmt from '../../../application/presentation/cli-format.js';

import { resolveTaskFile, transitionTask, getTaskStatus } from '../../backlog/backlog.js';
import { resolveWorktree } from '../../filesystem/mission-utils.js';

import * as stats from './stats.js';
import { resolveAgentModel } from '../../config/product-config.js';

export async function recordDraftImplementer({
  selected,
  actual,
  taskResolution,
  log = fmt.log.plain,
  plumbingLog = log,
  transitionTaskFn = transitionTask,
  getTaskStatusFn = getTaskStatus,
  slug,
  worktree
}: { selected: string; actual: string; taskResolution?: Pick<ReturnType<typeof resolveTaskFile>, 'ok' | 'taskFile'> | null; slug: string; worktree: string; log?: DraftLog; plumbingLog?: DraftLog; transitionTaskFn?: typeof transitionTask; getTaskStatusFn?: typeof getTaskStatus }) {
  const port: DraftImplementerRecordingPort = {
    getTaskStatus: getTaskStatusFn,
    transitionTask: transitionTaskFn,
    resolveRoot: draftStatsRoot,
  };
  return recordDraftImplementerAssignment({ selected, actual, taskResolution, slug, worktree, log, plumbingLog }, port);
}

/**
 * Record a draft-stage stats row after the draft agent completes. Token/usage
 * columns come from the agent result's telemetry (currently Codex only); other
 * families record honest zeros with provider/model set to the family name.
 * Best-effort: a failure here must never fail the draft.
 */
export function recordDraftStats({ configuration, slug, rootDir, agentFamily, result, log = fmt.log.plain }: { configuration?: ParallixConfiguration; slug: string; rootDir: string; agentFamily: string; result?: { runId?: string; startedAt?: string; endedAt?: string; telemetry?: Record<string, unknown> | ProviderResourceObservation | null; providerResources?: ProviderResourceObservation | null } | null; log?: DraftLog; error?: DraftLog }) {
  if (!result) { return; }
  let durationMinutes = 0;
  if (result.startedAt && result.endedAt) {
    durationMinutes = (Date.parse(result.endedAt) - Date.parse(result.startedAt)) / 60000;
  }
  try {
    const { row } = stats.recordStageStats({
      configuration, slug,
      runId: result.runId,
      stage: 'draft',
      rootDir,
      implementer: agentFamily,
      model: resolveAgentModel(agentFamily, rootDir),
      telemetry: result.providerResources ?? providerResourceObservation(result.telemetry),
      durationMinutes,
    });
    log(fmt.status('INFO', `Draft stats recorded: ${slug} stage=draft provider=${row.provider} model=${row.model} input_tokens=${row.input_tokens} tool_calls=${row.tool_calls}`));
  } catch (err) {
    // Best-effort: never escalate to the fatal `error` channel.
    log(fmt.status('WARN', `Could not record draft stats for ${slug}: ${(err instanceof Error ? err.message : String(err))}`));
  }
}
function draftStatsRoot(worktree: string, slug: string): string { return worktree || resolveWorktree(slug) || process.cwd(); }
