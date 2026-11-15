import type { VerificationStatistics } from '../projections/verification-statistics.js';

export interface VerificationStatisticsReadPort {
  read(_missions?: ReadonlySet<string>): Promise<VerificationStatistics>;
  /** Repository-wide verification totals; only the per-Mission FLOW retained runs are limited to the delivery population. */
  readRepository(_flowMissions: ReadonlySet<string>): Promise<VerificationStatistics>;
}
