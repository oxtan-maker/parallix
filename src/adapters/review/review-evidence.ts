import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ReviewEvidencePort } from '../../application/ports/review-evidence.js';

const execute = promisify(execFile);
/** Git object reads only, with bounded output and a finite child deadline. */
export class GitReviewEvidence implements ReviewEvidencePort {
  constructor(private readonly _worktree: string) {}
  private async read(args: readonly string[]): Promise<string> {
    const result = await execute('git', ['-C', this._worktree, ...args], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 2_000_000,
    });
    return result.stdout;
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
}
