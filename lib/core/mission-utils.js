"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWorkflowGeneratedArtifact = exports.isMissionArtifact = exports.findMissionDocInBranches = exports.softResetTrailingBacklogNoise = exports.squashTrailingBacklogNoiseIntoPreviousMission = exports.findLastNonNoiseCommit = exports.getConflictFiles = exports.parseConflictFilesFromMergeOutput = exports.updateGraphifyKnowledgeGraph = exports.probeGraphifyAvailability = exports.graphifyCommandCandidates = exports.graphifyAvailable = exports.resolveWorktree = exports.resolveBaseWorktree = exports.resolveMissionBaseBranch = exports.readRecordedBaseBranch = exports.parseBaseBranchLine = exports.detectLaunchBaseBranch = exports.conventionalBaseWorktreePath = exports.conventionalWorktreePath = exports.getPrimaryWorktree = exports.resolveMainRepo = exports.getPrimaryBranch = exports.findMissionArea = exports.detectMissionAreaFromContent = exports.normalizeVerifyArea = exports.SUPPORTED_VERIFY_AREAS = exports.missionTitle = exports.getFirstLine = exports.checkpointOrder = exports.compareCheckpointFiles = exports.findCheckpoints = exports.inferSlug = exports.findMissionDir = exports.missionPathForSlug = exports.missionDirForSlug = exports.getMissionYear = exports.extractSlugFromBranch = exports.isMissionSlugCandidate = exports.missionBranchRef = exports.missionBranchName = exports.missionBranchPrefix = exports.missionUsesYearTier = exports.missionBaseDir = exports.resolveMissionAdapter = exports.missionAdapterDefaults = void 0;
/**
 * Stable facade for mission utility helpers.
 *
 * Implementation lives in focused internal modules under `lib/core/mission-utils/`;
 * this file re-exports the combined public surface as plain data properties (not
 * accessor re-exports) so existing callers can keep importing
 * `./core/mission-utils.js` / `../core/mission-utils.js` unchanged, and so tests
 * that mock this module with `node:test`'s `mock.method()` keep working — accessor
 * (getter-only) re-exports are not mockable.
 */
const paths = __importStar(require("./mission-utils/paths.js"));
const worktree = __importStar(require("./mission-utils/worktree.js"));
const graphify = __importStar(require("./mission-utils/graphify.js"));
const mergeNoise = __importStar(require("./mission-utils/merge-noise.js"));
exports.missionAdapterDefaults = paths.missionAdapterDefaults;
exports.resolveMissionAdapter = paths.resolveMissionAdapter;
exports.missionBaseDir = paths.missionBaseDir;
exports.missionUsesYearTier = paths.missionUsesYearTier;
exports.missionBranchPrefix = paths.missionBranchPrefix;
exports.missionBranchName = paths.missionBranchName;
exports.missionBranchRef = paths.missionBranchRef;
exports.isMissionSlugCandidate = paths.isMissionSlugCandidate;
exports.extractSlugFromBranch = paths.extractSlugFromBranch;
exports.getMissionYear = paths.getMissionYear;
exports.missionDirForSlug = paths.missionDirForSlug;
exports.missionPathForSlug = paths.missionPathForSlug;
exports.findMissionDir = paths.findMissionDir;
exports.inferSlug = paths.inferSlug;
exports.findCheckpoints = paths.findCheckpoints;
exports.compareCheckpointFiles = paths.compareCheckpointFiles;
exports.checkpointOrder = paths.checkpointOrder;
exports.getFirstLine = paths.getFirstLine;
exports.missionTitle = paths.missionTitle;
exports.SUPPORTED_VERIFY_AREAS = paths.SUPPORTED_VERIFY_AREAS;
exports.normalizeVerifyArea = paths.normalizeVerifyArea;
exports.detectMissionAreaFromContent = paths.detectMissionAreaFromContent;
exports.findMissionArea = paths.findMissionArea;
exports.getPrimaryBranch = worktree.getPrimaryBranch;
exports.resolveMainRepo = worktree.resolveMainRepo;
exports.getPrimaryWorktree = worktree.getPrimaryWorktree;
exports.conventionalWorktreePath = worktree.conventionalWorktreePath;
exports.conventionalBaseWorktreePath = worktree.conventionalBaseWorktreePath;
exports.detectLaunchBaseBranch = worktree.detectLaunchBaseBranch;
exports.parseBaseBranchLine = worktree.parseBaseBranchLine;
exports.readRecordedBaseBranch = worktree.readRecordedBaseBranch;
exports.resolveMissionBaseBranch = worktree.resolveMissionBaseBranch;
exports.resolveBaseWorktree = worktree.resolveBaseWorktree;
exports.resolveWorktree = worktree.resolveWorktree;
exports.graphifyAvailable = graphify.graphifyAvailable;
exports.graphifyCommandCandidates = graphify.graphifyCommandCandidates;
exports.probeGraphifyAvailability = graphify.probeGraphifyAvailability;
exports.updateGraphifyKnowledgeGraph = graphify.updateGraphifyKnowledgeGraph;
exports.parseConflictFilesFromMergeOutput = mergeNoise.parseConflictFilesFromMergeOutput;
exports.getConflictFiles = mergeNoise.getConflictFiles;
exports.findLastNonNoiseCommit = mergeNoise.findLastNonNoiseCommit;
exports.squashTrailingBacklogNoiseIntoPreviousMission = mergeNoise.squashTrailingBacklogNoiseIntoPreviousMission;
exports.softResetTrailingBacklogNoise = mergeNoise.softResetTrailingBacklogNoise;
exports.findMissionDocInBranches = mergeNoise.findMissionDocInBranches;
exports.isMissionArtifact = mergeNoise.isMissionArtifact;
exports.isWorkflowGeneratedArtifact = mergeNoise.isWorkflowGeneratedArtifact;
