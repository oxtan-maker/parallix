/**
 * The temporary directory a test run gives its workers.
 *
 * tsx keeps its transpile cache in `<tmpdir>/tsx-<uid>` and, at every process
 * start, lists that whole directory and scans it linearly per module lookup.
 * Shared by every checkout on a machine, the cache grows with each edited
 * version of every file across all worktrees; at 130k entries each test worker
 * spent more CPU listing it than running its tests. A stable directory per
 * checkout keeps the cache to that checkout's own modules while staying warm
 * between runs. It lives under the system temporary directory, outside any
 * repository, so fixture Git repositories created beneath it never nest.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function checkoutTestTmpdir(executionRoot: string, base: string = os.tmpdir()): string {
  const id = crypto.createHash('sha256').update(path.resolve(executionRoot)).digest('hex').slice(0, 12);
  // A child runner inherits either this checkout root or an owned coverage
  // scratch below it. Start at the original base rather than nesting again.
  const resolvedBase = path.resolve(base);
  const parts = resolvedBase.split(path.sep);
  const managed = /^(?:parallix-test-tmp-|px-tmp-)[a-f0-9]{12}$/;
  const managedRoot = parts.findIndex((part, index) => managed.test(part)
    && parts.slice(index + 1).every(child => managed.test(child) || /^coverage-scratch-[a-zA-Z0-9]+$/.test(child)));
  const root = managedRoot < 0 ? resolvedBase
    : parts.slice(0, managedRoot).join(path.sep) || path.parse(resolvedBase).root;
  const dir = path.join(root, `px-tmp-${id}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
