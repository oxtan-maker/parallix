import type { VerificationStatistics } from '../projections/verification-statistics.js';

export interface VerificationStatisticsReadPort {
  read(_missions?: ReadonlySet<string>): Promise<VerificationStatistics>;
}
