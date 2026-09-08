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
  CLASSIFICATION_LABELS,
  clearTaskAgentAssignee,
  enforceTaskAssignee,
  getTaskAssignee,
  classificationFromLabels,
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

