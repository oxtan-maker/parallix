import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { EvidenceReadError, type MissionInterdiff, type MissionRevision, type ReviewEvidencePort } from '../../application/ports/review-evidence.js';

const execute = promisify(execFile);
type Execute = (_file: string, _args: readonly string[], _options: { encoding: 'utf8'; timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;
const OVERSIZE = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

/**
 * Hunk positions move with every rebase and context follows main, so only the changed lines
 * identify a mission change. Each carries its file (`path<TAB>line`), which keeps the
 * interdiff attributable however far a hunk is from its file header.
 */
function stablePatch(patch: string): string {
  let file = '';
  return patch.split('\n').flatMap(line => {
    const header = line.match(/^diff --git a\/(\S+) b\//);
    if (header) { file = header[1]; }
    if (line.startsWith('index ') || line.startsWith('@@')) { return []; }
    return [/^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line) ? `${file}\t${line}` : line];
  }).join('\n');
}

/** Files whose mission changes differ between the two patches. */
function interdiffPaths(interdiff: string): string[] {
  const paths = new Set<string>();
  for (const line of interdiff.split('\n')) {
    const changed = /^[+-]([^\t]+)\t[+-]/.exec(line);
    if (changed) { paths.add(changed[1]); }
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

/** Git object reads only, with bounded output and a finite child deadline; a failed read is a typed error. */
export class GitReviewEvidence implements ReviewEvidencePort {
  constructor(private readonly _worktree: string, private readonly _execute: Execute = execute as Execute) {}
  private async read(args: readonly string[]): Promise<string> {
    try {
      return (await this._execute('git', ['-C', this._worktree, ...args], { encoding: 'utf8', timeout: 10_000, maxBuffer: 2_000_000 })).stdout;
    } catch (error) {
      const oversize = (error as { code?: string }).code === OVERSIZE;
      throw new EvidenceReadError(oversize ? `git ${args[0]} output exceeds the read limit` : `git ${args[0]} failed`, oversize);
    }
  }
  async tree(revision: string): Promise<readonly string[]> {
    return (await this.read(['ls-tree', '-r', '--name-only', revision])).trim().split('\n').filter(Boolean);
  }
  async source(revision: string, path: string): Promise<string> {
    return await this.read(['show', `${revision}:${path}`]);
  }
  async diff(prior: string, candidate: string, paths: readonly string[]): Promise<string> {
    return await this.read(['diff', '--no-ext-diff', '--no-textconv', '--unified=0', prior, candidate, '--', ...paths]);
  }
  async missionInterdiff(before: MissionRevision, after: MissionRevision): Promise<MissionInterdiff> {
    const patch = (side: MissionRevision) => this.read(['diff', '--no-ext-diff', '--no-textconv', '--unified=0', side.baseline, side.revision]);
    const [left, right] = await Promise.all([patch(before), patch(after)]);
    const scratch = await mkdtemp(join(tmpdir(), 'px-interdiff-'));
    try {
      await Promise.all([writeFile(join(scratch, 'approved.patch'), stablePatch(left)), writeFile(join(scratch, 'candidate.patch'), stablePatch(right))]);
      // --no-index exits 1 when the patches differ, which is the answer rather than a failure.
      const diff = await execute('git', ['diff', '--no-index', '--no-ext-diff', '--unified=3', 'approved.patch', 'candidate.patch'],
        { cwd: scratch, encoding: 'utf8', timeout: 10_000, maxBuffer: 2_000_000 }).then(result => result.stdout, (error: { code?: unknown; stdout?: string }) => {
        if (error.code === 1 && typeof error.stdout === 'string') { return error.stdout; }
        throw new EvidenceReadError('mission interdiff failed', error.code === OVERSIZE);
      });
      return { diff, paths: interdiffPaths(diff) };
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
}
