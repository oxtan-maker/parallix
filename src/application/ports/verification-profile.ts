export interface VerificationProfileRun {
  readonly coverage: boolean; readonly profiled: boolean; readonly pair: number;
  readonly command: readonly string[]; readonly wallMs: number; readonly cpuUs: number;
  readonly profiles: readonly { readonly samples: number;
    readonly hotspots: readonly { readonly functionName: string; readonly url: string; readonly samples: number }[] }[];
}
export interface VerificationProfileReport {
  readonly revision: string; readonly dirty: boolean; readonly node: string;
  readonly platform: string; readonly arch: string; readonly tsx: string;
  readonly workload: readonly string[]; readonly runs: readonly VerificationProfileRun[];
}
export interface ControlledVerificationComparison {
  readonly experimentId: string; readonly coverage: boolean;
  readonly workloadFingerprint: string; readonly configurationFingerprint: string; readonly runtimeFingerprint: string;
  readonly workloadEquivalent: boolean; readonly configurationEquivalent: boolean; readonly runtimeEquivalent: boolean;
  readonly before: { readonly label: 'control'; readonly n: number; readonly meanWallMs: number; readonly meanCpuUs: number };
  readonly after: { readonly label: 'sampled'; readonly n: number; readonly meanWallMs: number; readonly meanCpuUs: number };
  readonly samples: number;
  readonly component: { readonly functionName: string; readonly url: string;
    readonly selfSamples: number; readonly contribution: number } | null;
  readonly optimizationBenefitBound: { readonly maximumRemovableCpuFraction: number;
    readonly maximumSpeedupRatio: number | null; readonly assumptions: readonly string[] } | null;
  readonly interpretation: string;
}
