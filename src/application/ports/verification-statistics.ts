import type { ReportingWindow } from '../../domain/decision-window.js';
import type { VerificationStatistics } from '../projections/verification-statistics.js';

export interface VerificationStatisticsReadPort {
  /** Measurements of `missions`; with `windows`, the policy model statistics cover the decisions those reporting windows recorded. */
  read(_missions?: ReadonlySet<string>, _windows?: readonly ReportingWindow[]): Promise<VerificationStatistics>;
  /** Repository-wide verification totals; only the per-Mission FLOW retained runs are limited to the delivery population. */
  readRepository(_flowMissions: ReadonlySet<string>): Promise<VerificationStatistics>;
}
