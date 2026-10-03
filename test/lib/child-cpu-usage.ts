import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

/** Stable N-API counter; local timing checks already require a C toolchain. */
export function childCpuUsageModule(root: string, testNode: string): string {
  if (!['linux', 'darwin'].includes(process.platform)) {
    throw new Error(`child CPU accounting requires Linux or macOS, found ${process.platform}`);
  }
  const source = path.join(root, 'test', 'lib', 'child-cpu-usage.c');
  const hash = createHash('sha256').update(fs.readFileSync(source))
    .update(process.platform).update(process.arch).digest('hex').slice(0, 16);
  const directory = path.join(root, 'tmp', 'cpu-supervisor');
  const binary = path.join(directory, `child-cpu-${hash}.node`);
  if (fs.existsSync(binary)) return binary;
  const headers = [
    path.resolve(path.dirname(testNode), '../include/node'),
    path.resolve(path.dirname(process.execPath), '../include/node'),
    '/usr/include/node', '/usr/local/include/node',
  ].find(candidate => fs.existsSync(path.join(candidate, 'node_api.h')));
  if (!headers) throw new Error('child CPU accounting requires installed Node N-API headers (node_api.h)');
  fs.mkdirSync(directory, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(directory, 'child-cpu-compile-'));
  try {
    const candidate = path.join(temporary, 'usage.node');
    const flags = process.platform === 'darwin' ? ['-undefined', 'dynamic_lookup'] : [];
    const result = spawnSync(process.env.CC || 'cc', [
      '-O2', '-std=c11', '-shared', '-fPIC', ...flags, '-I', headers, source, '-o', candidate,
    ], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`child CPU counter compilation failed: ${result.stderr || result.error?.message}`);
    fs.renameSync(candidate, binary);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  return binary;
}
