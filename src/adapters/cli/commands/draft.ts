// @ts-nocheck
import { DraftCommandUseCase } from '../../../application/draft-command-use-case.js';
import { ensureMissionBranch, ensureMissionBaseBranchRecorded, ensureWorktree, ensureGraphifyWorkspace, ensureGraphifyIgnore, ensureMissionFile, ensureDraftRepoConfigCommitted, ensureRepoExists, bootstrapBacklogTask } from './draft-setup.js';
import { buildDraftPrompt, buildRestartPrompt, fallbackDraftCommitMessage, validateDraftClassification, normalizeDraftClassification } from './draft-prompts.js';
import { classifyDraftEntries, isUnmergedStatus, isDeletedStatus, isMissionTaskPath, isExpectedDraftPath, enforceDraftCommitSafety } from './draft-conflicts.js';
import { recordDraftStats, recordDraftImplementer, restartDraftAgent, createDraftWorkflowAdapter } from './draft-stats.js';

async function runDraftCommand(args: string[], deps = {}) {
  const adapter = createDraftWorkflowAdapter(deps);
  return new DraftCommandUseCase(adapter).execute(args, deps);
}

async function draft(args, deps) {
  return runDraftCommand(args, deps);
}

const _draftExport = Object.assign(draft, { draft, runDraftCommand, recordDraftStats, buildDraftPrompt, recordDraftImplementer, enforceDraftCommitSafety, fallbackDraftCommitMessage, bootstrapBacklogTask, ensureGraphifyWorkspace, ensureGraphifyIgnore, ensureMissionBranch, ensureMissionBaseBranchRecorded, ensureWorktree, ensureMissionFile, ensureDraftRepoConfigCommitted, ensureRepoExists, classifyDraftEntries, isUnmergedStatus, isDeletedStatus, isMissionTaskPath, isExpectedDraftPath, validateDraftClassification, normalizeDraftClassification, buildRestartPrompt, restartDraftAgent, createDraftWorkflowAdapter });
export default _draftExport;
export { _draftExport as draft, runDraftCommand, recordDraftStats, buildDraftPrompt, recordDraftImplementer, enforceDraftCommitSafety, fallbackDraftCommitMessage, bootstrapBacklogTask, ensureGraphifyWorkspace, ensureGraphifyIgnore, ensureMissionBranch, ensureMissionBaseBranchRecorded, ensureWorktree, ensureMissionFile, ensureDraftRepoConfigCommitted, ensureRepoExists, classifyDraftEntries, isUnmergedStatus, isDeletedStatus, isMissionTaskPath, isExpectedDraftPath, validateDraftClassification, normalizeDraftClassification, buildRestartPrompt, restartDraftAgent, createDraftWorkflowAdapter };
