import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MissionRevision } from '../../application/ports/review-evidence.js';
import { isBookkeepingPath } from '../../domain/integration-validation-policy.js';

interface JsonManifest { version: unknown; packages?: Record<string, { version: unknown }>; [key: string]: unknown }
const manifest = (raw: string): JsonManifest => JSON.parse(raw) as JsonManifest;
const execute = promisify(execFile);
type Execute = (_file: string, _args: readonly string[], _options: { encoding: 'utf8'; timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;

/** Object-only reads; NUL paths and literal pathspecs preserve spaces and arbitrary filenames. */
export class GitMissionPatchComparison {
  constructor(private readonly _root: string, private readonly _execute: Execute = execute as Execute) {}
  private async read(args: readonly string[]): Promise<string> {
    return (await this._execute('git', ['--literal-pathspecs', '-C', this._root, ...args],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 4_000_000 })).stdout;
  }
  async samePatch(before: MissionRevision, after: MissionRevision): Promise<boolean> {
    const [left, right] = await Promise.all([this.patch(before), this.patch(after)]);
    return left === right;
  }
  private async patch(side: MissionRevision): Promise<string> {
    // Fail even for empty patches when a recorded subject is missing or not a commit.
    for (const ref of [side.baseline, side.revision]) {
      if (!/^[a-f0-9]{40,64}$/.test(ref)) { throw new Error('recorded revision must be a commit SHA'); }
      await this.read(['cat-file', '-e', `${ref}^{commit}`]);
    }
    const paths = (await this.read(['diff', '--no-renames', '--name-only', '-z', side.baseline, side.revision]))
      .split('\0').filter(p => p && !isBookkeepingPath(p)).sort((left, right) => left.localeCompare(right));
    const patches = [];
    for (const path of paths) {
      let diff = await this.read(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--full-index',
        '--unified=3', side.baseline, side.revision, '--', path]);
      diff = await this.withoutReleaseBumps(side, path, diff);
      if (!diff) { continue; }
      // Retain mode/type changes, binary payloads and every changed line; discard blob ids and hunk offsets.
      patches.push(JSON.stringify([path, diff.split('\n').filter(line => !/^(index |--- |\+\+\+ )/.test(line)).map(line => line.startsWith('@@') ? '@@' : line).join('\n')]));
    }
    return patches.join('\n');
  }
  private async withoutReleaseBumps(side: MissionRevision, path: string, diff: string): Promise<string> {
    if (!canNormalizeRelease(path, diff)) { return diff; }
    const commits = (await this.read(['rev-list', '--reverse', `${side.baseline}..${side.revision}`, '--', path])).trim().split('\n').filter(Boolean);
    const baselineText = await this.read(['show', `${side.baseline}:${path}`]);
    let normalizedVersion: unknown;
    try { normalizedVersion = manifest(baselineText).version; } catch { return diff; }
    let removed = false;
    for (const commit of commits) {
      const parents = (await this.read(['show', '-s', '--format=%P', commit])).trim().split(' ');
      if (parents.length !== 1) { return diff; }
      const [oldText, newText, message] = await Promise.all([this.read(['show', `${parents[0]}:${path}`]),
        this.read(['show', `${commit}:${path}`]), this.read(['show', '-s', '--format=%B', commit])]);
      if (/^Parallix-Bookkeeping: pre-commit-hook$/m.test(message) && releaseVersionOnly(oldText, newText, path)) {
        removed = true;
      } else {
        try {
          const before = manifest(oldText), after = manifest(newText);
          if (before.version !== after.version) { normalizedVersion = after.version; }
        } catch { return diff; }
      }
    }
    if (!removed) { return diff; }
    const tipText = await this.read(['show', `${side.revision}:${path}`]);
    const tip = manifest(tipText);
    if (tipText !== `${JSON.stringify(tip, null, 2)}\n`) { return diff; }
    const version = tip.version;
    tip.version = normalizedVersion;
    if (path === 'package-lock.json' && tip.packages?.['']) {
      if (tip.packages[''].version !== version) { return diff; }
      tip.packages[''].version = normalizedVersion;
    }
    return this.normalizedDiff(baselineText, `${JSON.stringify(tip, null, 2)}\n`, diff);
  }
  private async normalizedDiff(baselineText: string, tipText: string, diff: string): Promise<string> {
    const scratch = await mkdtemp(join(tmpdir(), 'px-release-patch-'));
    try {
      const left = join(scratch, 'before'), right = join(scratch, 'after');
      await Promise.all([writeFile(left, baselineText), writeFile(right, tipText)]);
      const normalized = await this._execute('git', ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--unified=3', left, right],
        { encoding: 'utf8', timeout: 10_000, maxBuffer: 4_000_000 }).then(r => r.stdout, (error: { code?: unknown; stdout?: string }) => {
        if (error.code === 1 && typeof error.stdout === 'string') { return error.stdout; }
        throw error;
      });
      if (!normalized) { return ''; }
      // Use the actual repository headers; temporary file names never enter patch identity.
      const headers = diff.split('\n').filter(l => /^(diff --git |--- |\+\+\+ )/.test(l));
      return [...headers, ...normalized.split('\n').filter(l => !/^(diff --git |index |--- |\+\+\+ )/.test(l))].join('\n');
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
}

/** Exactly the hook's root version fields; formatting, dependencies and every other byte stay substantive. */
export function releaseVersionOnly(before: string, after: string, path: string): boolean {
  try {
    const old = manifest(before), next = manifest(after);
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(old.version));
    if (!match || next.version !== `${match[1]}.${match[2]}.${Number(match[3]) + 1}`) { return false; }
    const version = next.version;
    next.version = old.version;
    if (path === 'package-lock.json' && next.packages?.['']) {
      if (next.packages[''].version !== version || old.packages?.['']?.version !== old.version) { return false; }
      next.packages[''].version = old.version;
    }
    return JSON.stringify(next) === JSON.stringify(old)
      && after === `${JSON.stringify(manifest(after), null, 2)}\n`
      && before === `${JSON.stringify(old, null, 2)}\n`;
  } catch { return false; }
}

function canNormalizeRelease(path: string, diff: string): boolean {
  return ['package.json', 'package-lock.json'].includes(path) && !/^(?:old mode|new mode|new file|deleted file)/m.test(diff);
}
