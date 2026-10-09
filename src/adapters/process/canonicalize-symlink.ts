import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve `p` to its real target when any component is a symlink, so bwrap
 * mounts the resolved destination instead of refusing with
 * 'Can''t mount on symlink destination'. Returns `p` unchanged when it holds no
 * symlink component, so a non-symlink argv stays byte-for-byte identical. A
 * non-existent leaf (created by bwrap at bind time) keeps its tail under the
 * resolved existing prefix; nothing is widened when no prefix exists.
 *
 * Only symlinked destinations are canonicalized, never to an unrelated host
 * path: the permitted host-path set and confinement policy are unchanged.
 */
export function canonicalizeSymlink(p: string): string {
  // Find the longest existing ancestor by walking up, collecting the missing
  // tail so a bind target created by bwrap at mount time still resolves its
  // existing symlinked prefix.
  let dir = p;
  const missing: string[] = [];
  while (true) {
    try {
      fs.statSync(dir);
      break;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) { return p; } // nothing exists; widen nothing
      missing.unshift(path.basename(dir));
      dir = parent;
    }
  }
  const realPrefix = fs.realpathSync(dir);
  if (missing.length === 0) { return realPrefix === p ? p : realPrefix; }
  return path.join(realPrefix, missing.join(path.sep));
}
