/**
 * Legacy record source: discover the retired task files, parse them into
 * records, and resolve their Git provenance and historical closure dates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { git } from '../git/git.js';
import { parseTaskFrontmatterValue } from './task-file-io.js';
import { findFieldBlock, parseAssigneeFamilies, parseTaskLabels } from './task-metadata.js';
import { resolveTaskStorage } from '../config/product-config.js';
import { missionLabels, type MissionLabel } from '../../domain/mission.js';
import { REPRESENTED_KEYS, RETIRED_KEYS, type LegacyRecord } from './legacy-import-types.js';

export function legacyDirectories(rootDir: string): readonly string[] {
  const storage = resolveTaskStorage(rootDir);
  return [
    storage.tasksDir,
    storage.completedDir,
    // `archive/tasks` holds the archived records; the archive root also holds
    // loose ones in this repository, so both are scanned.
    storage.archiveTasksDir,
    path.dirname(storage.archiveTasksDir),
  ];
}

export function markdownFiles(directory: string): readonly string[] {
  if (!fs.existsSync(directory)) { return []; }
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => path.join(directory, entry.name));
}

/**
 * A frontmatter list in either form the legacy files wrote it: block style
 * (`dependencies:` then `  - TASK-1`) or inline (`dependencies: [TASK-1,
 * TASK-2]`). Both appear across the historical records, so reading only one of
 * them would silently drop the other's entries.
 */
function parseListField(content: string, field: string): readonly string[] {
  const unquote = (value: string) => value.trim().replace(/^['"]|['"]$/g, '').trim();
  const block = findFieldBlock(content, field);
  if (block !== null) {
    return block.lines.slice(block.itemStart, block.end)
      .map(line => unquote(line.trim().replace(/^-[ \t]*/, '')))
      .filter(entry => entry.length > 0);
  }
  const inline = new RegExp(`^${field}:[ \\t]*\\[(.*?)\\]`, 'm').exec(content);
  if (inline === null) { return []; }
  return inline[1].split(',').map(unquote).filter(entry => entry.length > 0);
}

function frontmatterKeys(content: string): readonly string[] {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') { return []; }
  const keys: string[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') { break; }
    const match = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
    if (match) { keys.push(match[1].toLowerCase()); }
  }
  return keys;
}

export function parseLegacyRecord(filePath: string): LegacyRecord | null {
  const content = fs.readFileSync(filePath, 'utf8');
  const rawId = parseTaskFrontmatterValue(content, 'id');
  if (rawId === null) { return null; }
  const record = {
    sourceId: rawId.trim().toUpperCase(),
    sourcePath: filePath,
    title: parseTaskFrontmatterValue(content, 'title'),
    rawStatus: parseTaskFrontmatterValue(content, 'status'),
    assignees: parseAssigneeFamilies(content).families,
    labels: parseTaskLabels(content),
    unrepresentedKeys: frontmatterKeys(content).filter(key => !REPRESENTED_KEYS.includes(key) && !RETIRED_KEYS.includes(key)),
    dependencies: parseListField(content, 'dependencies'),
  };
  // Only Mission-owned material decides whether two historical copies of one id
  // disagree. A copy that differs solely in an unrepresented field (a bumped
  // `updated_date`, a `priority` edit) changes nothing this importer would
  // write, so it must not read as a conflict.
  const representedMaterial = JSON.stringify([
    record.sourceId,
    record.title,
    record.rawStatus,
    [...record.assignees].sort((a, b) => a.localeCompare(b)),
    [...record.labels].sort((a, b) => a.localeCompare(b)),
    [...record.dependencies].sort((a, b) => a.localeCompare(b)),
  ]);
  return { ...record, representedMaterial };
}

export function relative(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath);
}

/**
 * The commit the legacy files are read at. TASK-2521.07 removes those files, so
 * pinning it keeps the imported record's source text recoverable with
 * `git show <commit>:<path>`. Outside a checkout there is nothing to pin.
 */
export function headCommit(rootDir: string): string | null {
  const result = git(['rev-parse', 'HEAD'], { cwd: rootDir });
  const sha = result.stdout.trim();
  return result.status === 0 && sha.length > 0 ? sha : null;
}

/**
 * `<source path>@<commit>`: where the record was read and at which commit. It
 * is a locator, not an identity — the legacy id in the same `ExternalTaskRef`
 * is the identity, so a moved file or a newer commit is not a conflict.
 */
export function sourceLocator(sourcePath: string, commit: string | null): string {
  return commit === null ? sourcePath : `${sourcePath}@${commit}`;
}

export function sourceMatchesCommit(rootDir: string, filePath: string, commit: string | null): boolean {
  if (commit === null) { return false; }
  try {
    const pinned = git(['show', `${commit}:${relative(rootDir, filePath)}`], { cwd: rootDir, maxBuffer: 8 * 1024 * 1024 });
    if (pinned.status !== 0) { return false; }
    const digest = (content: string) => createHash('sha256').update(content).digest('hex');
    return digest(pinned.stdout) === digest(fs.readFileSync(filePath, 'utf8'));
  } catch { return false; }
}

export function latestSourceCommit(rootDir: string, filePath: string): string | null {
  const result = git(['log', '-1', '--format=%H', '--', relative(rootDir, filePath)], { cwd: rootDir });
  const commit = result.stdout.trim();
  return result.status === 0 && /^[a-f0-9]{40,64}$/.test(commit)
    && sourceMatchesCommit(rootDir, filePath, commit) ? commit : null;
}

/** A commit that recorded this completed artifact. */
export function historicalClosedAt(rootDir: string, filePath: string): string | null {
  const sourcePath = relative(rootDir, filePath);
  if (sourcePath.startsWith('backlog/tasks/')) {
    // Some completed wave tasks never moved out of `tasks/`. The commit that
    // first records each done transition supplies their closure date.
    const history = git(['log', '--reverse', '--format=%H', '--', sourcePath], { cwd: rootDir });
    if (history.status !== 0) { return null; }
    let previous: string | null = null;
    let closedAt: string | null = null;
    for (const commit of history.stdout.trim().split('\n').filter(Boolean)) {
      const snapshot = git(['show', `${commit}:${sourcePath}`], { cwd: rootDir });
      if (snapshot.status !== 0) { continue; }
      const status = parseTaskFrontmatterValue(snapshot.stdout, 'status')?.trim().toLowerCase() ?? null;
      if (status === 'done' && previous !== 'done') {
        const event = git(['show', '-s', '--format=%cI', commit], { cwd: rootDir });
        if (event.status === 0 && !Number.isNaN(Date.parse(event.stdout.trim()))) {
          closedAt = new Date(event.stdout.trim()).toISOString();
        }
      }
      previous = status;
    }
    return closedAt;
  }
  if (!sourcePath.startsWith('backlog/completed/') && !sourcePath.startsWith('backlog/archive/')) { return null; }
  const result = git(['log', '-1', '--format=%cI', '--', sourcePath], { cwd: rootDir });
  const value = result.stdout.trim();
  return result.status === 0 && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

/** Mission-owned labels compared as a set; import order carries no meaning. */
export function sameLabels(left: readonly MissionLabel[], right: readonly MissionLabel[]): boolean {
  if (left.length !== right.length) { return false; }
  const seen = new Set<string>(left);
  return right.every(label => seen.has(label));
}

/** Older intake stored an entire frontmatter list as one label string. */
export function normalizedLegacyLabels(labels: readonly MissionLabel[]): readonly MissionLabel[] {
  if (labels.length !== 1) { return labels; }
  const value = String(labels[0]);
  if (!value.startsWith('[') || !value.endsWith(']')) { return labels; }
  const contents = value.slice(1, -1).trim();
  try {
    return missionLabels(contents ? contents.split(',').map(label => label.trim().replace(/^['"]|['"]$/g, '')) : []);
  } catch { return labels; }
}

/**
 * Import the legacy repository task records as Missions.
 *
 * Idempotent: a second run over unchanged sources writes nothing and reports
 * every legacy id as already materialized.
 */
