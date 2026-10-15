

import type { ParallixConfiguration } from "../../../application/ports/configuration.js";
import { type DraftLog } from './draft-adapter-types.js';

import type { StageStatsRequest } from '../../../application/stats-recording-use-case.js';

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
  if (!taskResolution || !taskResolution.ok || !taskResolution.taskFile || !actual) {
    return actual || selected;
  }

  if (selected && actual !== selected) {
    log(fmt.status('INFO', `Draft agent fell back from ${fmt.agent(selected)} to ${fmt.agent(actual)}; enforcing backlog assignee.`));
  } else {
    plumbingLog(fmt.status('INFO', `Enforcing draft agent ${fmt.agent(actual)} as assignee...`));
  }

  const currentStatus = getTaskStatusFn(taskResolution.taskFile);
  if (!currentStatus || !await transitionTaskFn(slug, currentStatus, {
    implementer: actual,
    rootDir: draftStatsRoot(worktree, slug),
    log: plumbingLog,
  })) {
    log(fmt.status('WARN', `Could not enforce draft agent ${fmt.agent(actual)} in backlog task.`));
  }
  return actual;
}

/**
 * Record a draft-stage stats row after the draft agent completes. Token/usage
 * columns come from the agent result's telemetry (currently Codex only); other
 * families record honest zeros with provider/model set to the family name.
 * Best-effort: a failure here must never fail the draft.
 */
export function recordDraftStats({ configuration, slug, rootDir, agentFamily, result, log = fmt.log.plain }: { configuration?: ParallixConfiguration; slug: string; rootDir: string; agentFamily: string; result?: { startedAt?: string; endedAt?: string; telemetry?: StageStatsRequest['telemetry'] } | null; log?: DraftLog; error?: DraftLog }) {
  if (!result) { return; }
  let durationMinutes = 0;
  if (result.startedAt && result.endedAt) {
    durationMinutes = (Date.parse(result.endedAt) - Date.parse(result.startedAt)) / 60000;
  }
  try {
    const { row } = stats.recordStageStats({
      configuration, slug,
      stage: 'draft',
      rootDir,
      implementer: agentFamily,
      model: resolveAgentModel(agentFamily, rootDir),
      telemetry: result.telemetry || null,
      durationMinutes,
    });
    log(fmt.status('INFO', `Draft stats recorded: ${slug} stage=draft provider=${row.provider} model=${row.model} input_tokens=${row.input_tokens} tool_calls=${row.tool_calls}`));
  } catch (err) {
    // Best-effort: never escalate to the fatal `error` channel.
    log(fmt.status('WARN', `Could not record draft stats for ${slug}: ${(err instanceof Error ? err.message : String(err))}`));
  }
}
function draftStatsRoot(worktree: string, slug: string): string { return worktree || resolveWorktree(slug) || process.cwd(); }
