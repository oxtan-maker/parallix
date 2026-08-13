export {
  checkBacklogIntegrity,
  commitTaskFileUpdate,
  findTaskFile,
  findTaskFiles,
  getAcceptanceCriteria,
  getTaskFrontmatterValue,
  getTaskStorage,
  pruneStaleBacklogDuplicates,
  reportTaskResolution,
  resolveStableRepositoryId,
  resolveTaskFile,
} from './task-file-io.js';

export {
  clearTaskAgentAssignee,
  enforceTaskAssignee,
  getTaskAssignee,
  getTaskClassification,
  getTaskImplementer,
  getTaskLabels,
  hasBugLabel,
  parseAssigneeFamilies,
  setTaskAssignee,
  setTaskImplementer,
  setTaskLabels,
  syncTaskLabelsToBaseWorktree,
} from './task-metadata.js';

export {
  completeTask,
  getTaskStatus,
  recordLifecycleOperation,
  resolveBacklogStateRoot,
  setTaskStatus,
  transitionTask,
  transitionTaskOnIntegrationBranch,
} from './task-transitions.js';

