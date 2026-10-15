/** Public contract of the dependency-free installer bootstrap glue. */
export const IDENTITY_SCHEMA: 1;
export const IDENTITY_RELATIVE_PATH: string;
export const INSTALL_ARGS: string[];
export const INSTALL_COMMAND: 'pnpm';
export const INSTALL_STATE_DIRECTORY: 'node_modules';
export interface DependencyInputs {
  manifests: Record<string, Record<string, unknown>>;
  lockfiles: Record<string, unknown>;
  installPolicy: Record<string, string>;
  toolchain: { node: string; packageManager: string };
}
export interface InputOptions { readFileFn?: (path: string) => string; existsFn?: (path: string) => boolean; nodeVersion?: string }
export interface InstalledStateOptions { inputs?: DependencyInputs; statFn?: (path: string) => { isDirectory(): boolean } | null; readdirFn?: (path: string) => string[] | null }
export interface IdentityRecord { identity?: unknown; pendingReconciliation?: unknown; inputs?: unknown; publishedAt?: unknown; schema?: unknown }
export function identityFile(worktree: string): string;
export function normalizeYamlLockfile(text: string): string;
export function dependencyInputs(worktree: string, options?: InputOptions): DependencyInputs;
export function computeDependencyIdentity(worktree: string, options?: InputOptions): { identity: string; inputs: DependencyInputs };
export function readIdentityRecord(worktree: string): IdentityRecord | null;
export function readInstalledIdentity(worktree: string): { identity: string; inputs?: unknown; publishedAt?: string } | null;
export function markReconciliationPending(worktree: string, params: { targetIdentity: string; nowFn?: () => Date }): void;
export function declaresDependencies(inputs: DependencyInputs): boolean;
export function installedStatePresent(worktree: string, options?: InstalledStateOptions): boolean;
export function publishInstalledIdentity(worktree: string, record: { identity: string; inputs?: unknown }): string;
export function ensureDependencies(params: { worktree: string; force?: boolean; command?: string; args?: string[]; nodeVersion?: string; nowFn?: () => Date; logFn?: (line: string) => void; spawnFn?: (command: string, args: string[]) => { status: number | null }; installedStatePresentFn?: (worktree: string, options: InstalledStateOptions) => boolean }): { action: 'skipped' | 'installed' | 'failed'; identity: string; exitCode: number | null; reason: string };
