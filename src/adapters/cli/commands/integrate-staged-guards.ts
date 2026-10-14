import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from '../../process/process-runner.js';

/**
 * Verify the tree `commit --only` will read: HEAD plus the named worktree
 * paths, excluding ambient staged board changes. Never alter the real index.
 */
export function runStagedTierGuards(rootDir: string, paths: ReadonlySet<string>): { ok: boolean; error?: string; tree?: string } {
  const guard = 'scripts/verify-landing-tree.sh';
  const packageFile = path.join(rootDir, 'package.json');
  const selfHosted = fs.existsSync(packageFile)
    && JSON.parse(fs.readFileSync(packageFile, 'utf8')).name === '@magnusekdahl/parallix';
  // Other products and minimal Git fixtures have no self-hosted contracts.
  if (!selfHosted) { return { ok: true }; }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-landing-tree-'));
  try {
    const snapshot = path.join(temporary, 'tree');
    fs.mkdirSync(snapshot);
    const env = { ...process.env, GIT_INDEX_FILE: path.join(temporary, 'index'), GIT_LITERAL_PATHSPECS: '1' };
    const git = (args: string[]) => {
      const result = spawnSync('git', ['-C', rootDir, ...args], { env, encoding: 'utf8' });
      if (result.status !== 0) { throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n').trim() || `git ${args[0]} failed`); }
      return result.stdout.trim();
    };
    const project = () => {
      git(['read-tree', 'HEAD']);
      if (paths.size > 0) { git(['add', '-A', '--', ...paths]); }
      return git(['write-tree']);
    };
    const head = git(['rev-parse', 'HEAD']);
    const tree = project();
    git(['checkout-index', '-a', '--force', `--prefix=${snapshot}${path.sep}`]);
    if (!fs.existsSync(path.join(snapshot, guard))) { return { ok: false, error: `Final landing tree is missing ${guard}.` }; }
    fs.symlinkSync(path.join(rootDir, 'node_modules'), path.join(snapshot, 'node_modules'), 'dir');
    const result = spawnSync('bash', [guard], { cwd: snapshot, env: { ...process.env, PARALLIX_EXECUTION_ROOT: snapshot, PARALLIX_TEST_COVERAGE: '0' }, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) { return { ok: false, error: [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n').trim() }; }
    if (git(['rev-parse', 'HEAD']) !== head || project() !== tree) {
      return { ok: false, error: 'Landing tree changed while its guards ran; retry integration.' };
    }
    return { ok: true, tree };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
