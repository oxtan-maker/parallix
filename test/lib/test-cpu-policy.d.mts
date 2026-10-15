/** The native runner and TypeScript test planner share this budget boundary. */
export interface CpuBudgetPolicy {
  unitSuites: { plain: number; fastPlain: number; covered: number; fastCovered: number };
  integrationSuites: { plainCi: number; coveredCi: number; local: number; all: number };
  integrationCases: { defaultMs: number; plain: Record<string, number>; covered: Record<string, number> };
}
export function positiveCpuBudget(value: unknown, name: string): number;
export function readCpuBudgetPolicy(root: string): CpuBudgetPolicy;
export function suiteCpuBudget(policy: CpuBudgetPolicy, options: { integration?: boolean; ci?: boolean; local?: boolean; fast?: boolean; covered?: boolean; env?: NodeJS.ProcessEnv }): number;
