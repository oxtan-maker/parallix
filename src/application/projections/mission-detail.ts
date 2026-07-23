import { isClosedMission, type Mission, type MissionId } from '../../domain/mission.js';
import {
  currentReviewRound,
  reviewStatus,
  type ReviewFinding,
  type ReviewStatus,
} from '../../domain/review.js';
import type { CompletedMissionStatistics } from '../../domain/usage.js';

export interface MissionDetail {
  readonly id: MissionId;
  readonly checkpoints: readonly { readonly name: string; readonly nextActionText: string }[];
  readonly review: {
    readonly round: number;
    readonly status: ReviewStatus;
    readonly findings: readonly ReviewFinding[];
  } | null;
  readonly netEngineeringLines: number | null;
  readonly completedStatistics: CompletedMissionStatistics | null;
}

export function projectMissionDetail(
  mission: Mission,
  completedStatistics: CompletedMissionStatistics | null,
): MissionDetail {
  if (completedStatistics && completedStatistics.missionId !== mission.id) {
    throw new Error('Completed statistics belong to another mission');
  }
  if (completedStatistics && !isClosedMission(mission)) {
    throw new Error('Open missions cannot have completed statistics');
  }
  const reviewRound = mission.review ? currentReviewRound(mission.review) : null;
  const findings = reviewRound?.decision?.kind === 'changes-requested'
    ? reviewRound.decision.findings
    : [];
  return {
    id: mission.id,
    checkpoints: mission.checkpoints.map(({ name, nextActionText }) => ({ name, nextActionText })),
    review: mission.review
      ? { round: reviewRound?.number ?? 1, status: reviewStatus(mission.review), findings }
      : null,
    netEngineeringLines: mission.netEngineeringLines,
    completedStatistics,
  };
}
