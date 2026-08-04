/**
 * Stable facade for mission utility helpers.
 *
 * This module aggregates focused filesystem and Git helpers as plain data
 * properties instead of accessor re-exports. Tests replace these exports with
 * `node:test`'s `mock.method()`, which cannot replace getter-only ESM re-exports.
 */
import * as paths from './mission-paths.js';
import * as worktree from '../git/worktree.js';
import * as graphify from './mission-graphify.js';
import * as mergeNoise from '../git/merge-noise.js';

export const missionAdapterDefaults = paths.missionAdapterDefaults;
export const resolveMissionAdapter = paths.resolveMissionAdapter;
export const missionBaseDir = paths.missionBaseDir;
export const missionUsesYearTier = paths.missionUsesYearTier;
export const missionBranchPrefix = paths.missionBranchPrefix;
export const missionBranchName = paths.missionBranchName;
export const missionBranchRef = paths.missionBranchRef;
export const isMissionSlugCandidate = paths.isMissionSlugCandidate;
export const extractSlugFromBranch = paths.extractSlugFromBranch;
export const getMissionYear = paths.getMissionYear;
export const missionDirForSlug = paths.missionDirForSlug;
export const missionPathForSlug = paths.missionPathForSlug;
export const findMissionDir = paths.findMissionDir;
export const inferSlug = paths.inferSlug;
export const findCheckpoints = paths.findCheckpoints;
export const compareCheckpointFiles = paths.compareCheckpointFiles;
export const checkpointOrder = paths.checkpointOrder;
export const getFirstLine = paths.getFirstLine;
export const missionTitle = paths.missionTitle;
export const SUPPORTED_VERIFY_AREAS = paths.SUPPORTED_VERIFY_AREAS;
export const normalizeVerifyArea = paths.normalizeVerifyArea;
export const detectMissionAreaFromContent = paths.detectMissionAreaFromContent;
export const findMissionArea = paths.findMissionArea;

export const getPrimaryBranch = worktree.getPrimaryBranch;
export const resolveMainRepo = worktree.resolveMainRepo;
export const getPrimaryWorktree = worktree.getPrimaryWorktree;
export const conventionalWorktreePath = worktree.conventionalWorktreePath;
export const conventionalBaseWorktreePath = worktree.conventionalBaseWorktreePath;
export const detectLaunchBaseBranch = worktree.detectLaunchBaseBranch;
export const parseBaseBranchLine = worktree.parseBaseBranchLine;
export const readRecordedBaseBranch = worktree.readRecordedBaseBranch;
export const resolveMissionBaseBranch = worktree.resolveMissionBaseBranch;
export const resolveBaseWorktree = worktree.resolveBaseWorktree;
export const resolveWorktree = worktree.resolveWorktree;

export const graphifyAvailable = graphify.graphifyAvailable;
export const graphifyCommandCandidates = graphify.graphifyCommandCandidates;
export const probeGraphifyAvailability = graphify.probeGraphifyAvailability;
export const updateGraphifyKnowledgeGraph = graphify.updateGraphifyKnowledgeGraph;
export const resolveGraphPath = graphify.resolveGraphPath;
export const queryGraph = graphify.queryGraph;

export const parseConflictFilesFromMergeOutput = mergeNoise.parseConflictFilesFromMergeOutput;
export const getConflictFiles = mergeNoise.getConflictFiles;
export const findLastNonNoiseCommit = mergeNoise.findLastNonNoiseCommit;
export const squashTrailingBacklogNoiseIntoPreviousMission = mergeNoise.squashTrailingBacklogNoiseIntoPreviousMission;
export const softResetTrailingBacklogNoise = mergeNoise.softResetTrailingBacklogNoise;
export const findMissionDocInBranches = mergeNoise.findMissionDocInBranches;
export const isMissionArtifact = mergeNoise.isMissionArtifact;
export const isWorkflowGeneratedArtifact = mergeNoise.isWorkflowGeneratedArtifact;
