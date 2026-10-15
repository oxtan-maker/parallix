import type { Mission, MissionStatus } from '../../domain/mission.js';
import type { MissionStore, MissionVersion } from '../domain-ports.js';
import type { MissionLifecycleService } from '../mission-lifecycle-service.js';
import type { MissionIntegrationService } from '../mission-integration-service.js';
import type { OperationalHistoryService } from '../services/operational-history-service.js';
import type { StatsMissionFlow } from './cli-workflows.js';

/** Review-provider facts consumed by integration; lifecycle authority stays in Mission. */
export interface IntegrationPullRequest {
  exists: boolean;
  number?: number;
  title?: string;
  state?: string;
  merged?: boolean;
  url?: string;
  createdAt?: string | null;
  raw?: string;
  error?: string;
}

export interface IntegrationApproval {
  ok: boolean;
  error?: string;
  reviewState?: string | null;
  prNumber?: number;
  defaultUserApproved?: boolean;
  defaultUserApprovedAt?: string;
  operatorApproved?: boolean;
  operatorApprovedAt?: string;
  reviewerApproved?: boolean;
  reviewerApprovedAt?: string;
  raw?: string;
  source?: string;
  providerDisabled?: boolean;
}

export type IntegrationReviewSnapshot = {
  reviewer?: string;
  implementer?: string;
  round?: number;
  startedAt?: string;
  phase?: string;
  disposition?: string | null;
  metadata?: Record<string, unknown>;
};

export interface IntegrationMissionServices {
  store: MissionStore;
  lifecycle: Pick<MissionLifecycleService, 'transition'>;
  integration: Pick<MissionIntegrationService, 'decideIntegration' | 'close'>;
  operationalHistory?: Pick<OperationalHistoryService, 'loadLatestByTypeForMission' | 'recordIntegrationValidation'> | null;
  readStatsMissionFlow?: () => Promise<readonly StatsMissionFlow[] | null>;
}

/** Capabilities used to record landed delivery and administrative closure. */
export type IntegrationDecisionServices = Pick<IntegrationMissionServices, 'integration'> & {
  store: Pick<MissionStore, 'load'>;
};

export type IntegrationMissionServicesFactory = (rootDir: string) => Promise<IntegrationMissionServices>;

export type GithubIntegrationObservation =
  | { kind: 'pending' | 'closed-unmerged' | 'unexpected-tree'; number: number; base: string }
  | { kind: 'merged'; number: number; base: string; resultingSha: string }
  | { kind: 'target-changed'; expected: string; actual: string }
  | { kind: 'unavailable'; error: string };

export interface IntegrationMissionFacts {
  missionStatus?: MissionStatus;
  missionBrief?: Mission['brief'];
  missionLabels?: Mission['labels'];
  missionReview?: Mission['review'];
  missionVersion?: MissionVersion;
  missionHeadSha?: string | null;
  recordedContract?: boolean;
}

/** Repository gate values crossing the integration application port. */
export interface IntegrationGateDefinition {
  key: string; command: string; order: number; after?: string[]; reuse?: 'never' | 'clean-tree';
}

export interface IntegrationFailedGate {
  key: string; command: string; exitCode: number | null; stdout: string; stderr: string; durationMs?: number;
}

export type IntegrationStash = { created?: boolean; message?: string; rootDir?: string };
