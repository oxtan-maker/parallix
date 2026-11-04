/** Process capabilities are bound by composition, just like gate admission. */
export interface GitProcessContext { readonly inheritedMarkers: Readonly<Record<string, string>> }
export interface BootstrapGitOptions {
  readonly cwd?: string;
  readonly encoding: 'utf8';
  readonly env?: Readonly<Record<string, string | undefined>>;
}
export type BootstrapGitSpawn = (_command: string, _args: readonly string[], _options: BootstrapGitOptions) => { status: number | null; stdout: string; stderr: string };
let context: GitProcessContext = { inheritedMarkers: {} };
export function configureGitProcess(contextPort: GitProcessContext): void { context = contextPort; }
export function gitProcessContext(): GitProcessContext { return context; }
