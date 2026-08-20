/**
 * Static Review Evidence Helpers
 *
 * Adapter-side goal-check evidence collection, validation, and formatting.
 * Extracted from review-commands.ts to reduce coupling and line count.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as fmt from '../../application/presentation/cli-format.js';
import { run } from '../git/git.js';
import { findMissionDir, findCheckpoints, resolveWorktree, missionBaseDir, getPrimaryBranch } from '../filesystem/mission-utils.js';

// ============================================================================
// Optional fileSystem helpers (handoff callers pass a port; review callers omit)
// ============================================================================

interface FileSystemPort {
  existsSync(_target: string): boolean;
  readText(_target: string): string;
  listEntries(_target: string): fs.Dirent[];
  listNames(_target: string): string[];
}

function _fsExistsSync(fileSystem: FileSystemPort | undefined, target: string) {
  return fileSystem?.existsSync(target) ?? fs.existsSync(target);
}

function _fsReadText(fileSystem: FileSystemPort | undefined, target: string) {
  return fileSystem?.readText(target) ?? fs.readFileSync(target, 'utf8');
}

function _fsListEntries(fileSystem: FileSystemPort | undefined, target: string) {
  return fileSystem?.listEntries(target) ?? fs.readdirSync(target, { withFileTypes: true });
}

function _fsListNames(fileSystem: FileSystemPort | undefined, target: string) {
  return fileSystem?.listNames(target) ?? fs.readdirSync(target);
}

// ============================================================================
// Formatting helpers
// ============================================================================

export function formatStaticReviewFindings(findings: string[]): string {
  const lines = [
    'Static review found the following issue(s) before autonomous review:',
    ''
  ];
  findings.forEach((finding, index) => {
    lines.push(`${index + 1}. ${finding}`);
  });
  lines.push('', 'Auto-launching the act-on-review loop for follow-up.');
  return lines.join('\n');
}

export function formatStaticReviewSuccess(slug: string): string {
  return [
    `Static review for ${slug} found zero issues.`,
    '',
    'Checked:',
    '- mission diff against the primary branch',
    '- checkpoint presence',
    '- final checkpoint Goal Check evidence',
    '',
    'Mission remains in `review` status awaiting an actual autonomous or peer review verdict.'
  ].join('\n');
}

// ============================================================================
// Evidence row collection
// ============================================================================

export function collectGoalCheckEvidenceRows(afterHeader: string): string[] {
  const separatorPattern = /^\|(?:\s*:?-+:?\s*\|)+$/;
  const headerPattern = /^\| .+\| .+\| .+\|$/;
  const evidenceLinePattern = /^\| .+\| .+\| .+\|$/;
  const linesAfterHeader = afterHeader.split('\n');
  const evidenceRows: string[] = [];
  let pastHeader = false;

  for (const line of linesAfterHeader) {
    const trimmed = line.trim();
    if (trimmed === '') { continue; }
    if (!pastHeader && headerPattern.test(trimmed)) {
      pastHeader = true;
      continue;
    }
    if (separatorPattern.test(trimmed)) { continue; }
    if (pastHeader && evidenceLinePattern.test(trimmed)) {
      evidenceRows.push(trimmed);
      continue;
    }
    break;
  }

  return evidenceRows;
}

// ============================================================================
// Test name collection
// ============================================================================

export function collectRepoTestNames(fileSystem: FileSystemPort | undefined, rootDir: string): Set<string> {
  const names = new Set<string>();
  const testRoot = path.join(rootDir, 'test');
  if (!_fsExistsSync(fileSystem, testRoot)) {
    return names;
  }

  const queue: string[] = [testRoot];
  while (queue.length > 0) {
    const current = queue.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = _fsListEntries(fileSystem, current) as fs.Dirent[];
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)) {
        continue;
      }
      const content = _fsReadText(fileSystem, fullPath) as string;
      const testNamePattern = /\b(?:test|it)(?:\.\w+)?\s*\(\s*(['"`])([^'"`]+)\1/g;
      let match: RegExpExecArray | null;
      while ((match = testNamePattern.exec(content)) !== null) {
        names.add(match[2]);
      }
    }
  }

  return names;
}

// ============================================================================
// Canonical source file check
// ============================================================================

export function canonicalSourceContainsFile(fileSystem: FileSystemPort | undefined, rootDir: string, basename: string): boolean {
  const sourceRoot = path.join(rootDir, 'src');
  if (!_fsExistsSync(fileSystem, sourceRoot)) { return false; }
  const queue = [sourceRoot];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const entry of _fsListEntries(fileSystem, current)) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile() && entry.name === basename) {
        return true;
      }
    }
  }
  return false;
}

// ============================================================================
// Verifiable reference check
// ============================================================================

export function evidenceCellHasVerifiableReference(fileSystem: FileSystemPort | undefined, cell: string, rootDir: string, knownTestNames: Set<string>): boolean {
  const normalized = cell.replace(/\[[^\]]+\]\(([^)]+)\)/g, '$1');
  const fileLinePattern = /(?:^|[\s(`])((?:\/|\.\/)?[\w./-]+\.[\w-]+):(\d+)(?:-\d+)?/g;
  let fileLineMatch: RegExpExecArray | null;
  while ((fileLineMatch = fileLinePattern.exec(normalized)) !== null) {
    const candidatePath = fileLineMatch[1];
    const resolved = path.isAbsolute(candidatePath)
      ? candidatePath
      : path.join(rootDir, candidatePath.replace(/^\.\//, ''));
    // Historical checkpoints may cite the former `lib/...` layout. Validate
    // that the cited source file still exists somewhere in the canonical tree.
    const canonicalSourceExists = !path.isAbsolute(candidatePath) && candidatePath.startsWith('lib/')
      ? canonicalSourceContainsFile(fileSystem, rootDir, path.basename(candidatePath))
      : false;
    if (_fsExistsSync(fileSystem, resolved) || canonicalSourceExists) {
      return true;
    }
  }

  const adrPattern = /\bADR\s+(\d{4})\b/g;
  let adrMatch: RegExpExecArray | null;
  while ((adrMatch = adrPattern.exec(normalized)) !== null) {
    const prefix = `${adrMatch[1]}-`;
    const adrDir = path.join(rootDir, 'docs', 'adr');
    if (_fsExistsSync(fileSystem, adrDir) && _fsListNames(fileSystem, adrDir).some((name: string) => name.startsWith(prefix) && name.endsWith('.md'))) {
      return true;
    }
  }

  const quotedPattern = /(['"`])([^'"`]+)\1/g;
  let quotedMatch: RegExpExecArray | null;
  while ((quotedMatch = quotedPattern.exec(normalized)) !== null) {
    if (knownTestNames.has(quotedMatch[2])) {
      return true;
    }
  }

  const testFilePattern = /(?:^|[\s(`])((?:\/|\.\/)?[\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?)(?=$|[\s),`])/g;
  while (testFilePattern.exec(normalized) !== null) {
    return true;
  }

  // Normalize escaped backticks (`` `` ``) so the inline-command regex does not
  // span across them. A markdown cell like `` `git diff --name-only` `` would
  // otherwise match from the first ` to the third, capturing a leading backtick
  // that breaks the `git` prefix check.
  const cellForCommands = cell.replace(/``/g, '  ');
  const inlineCommandPattern = /`([^`]+)`/g;
  let commandMatch: RegExpExecArray | null;
  while ((commandMatch = inlineCommandPattern.exec(cellForCommands)) !== null) {
    const command = commandMatch[1].trim();
    if (/^(npm|npx|node|git|px)\s+/i.test(command)) {
      return true;
    }
    // Shell commands are evidence only when they name a repository file.
    // This keeps raw environment output out while allowing `bash hello.sh`.
    if (/^(bash|sh|cat|head|tail|diff|grep|sed|awk|xxd|od|wc|sort|uniq|stat|ls)\s+/i.test(command)) {
      const args = command.split(/\s+/).slice(1);
      for (const arg of args) {
        if (arg.startsWith('-')) { continue; }
        const candidatePath = arg.replace(/^\.\//, '');
        if (_fsExistsSync(fileSystem, path.join(rootDir, candidatePath))) {
          return true;
        }
      }
    }
    if (command.startsWith('./')) {
      const commandPath = command.split(/\s+/)[0];
      if (_fsExistsSync(fileSystem, path.join(rootDir, commandPath.replace(/^\.\//, '')))) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================================
// Unverifiable row detection
// ============================================================================

export function findUnverifiableGoalCheckRow(fileSystem: FileSystemPort | undefined, evidenceRows: string[], rootDir: string): string | null {
  const knownTestNames = collectRepoTestNames(fileSystem, rootDir);
  for (const row of evidenceRows) {
    const columns = row.split('|').slice(1, -1).map(part => part.trim()).filter(Boolean);
    if (columns.some(cell => evidenceCellHasVerifiableReference(fileSystem, cell, rootDir, knownTestNames))) {
      continue;
    }
    return row;
  }
  return null;
}

// ============================================================================
// Static Review Command
// ============================================================================

export function performStaticReview(
  slug: string,
  options: {
    log?: (_msg: string) => void;
    findMissionDir?: typeof findMissionDir;
    findCheckpoints?: typeof findCheckpoints;
    readFileSync?: typeof fs.readFileSync;
    run?: typeof run;
    resolveWorktree?: typeof resolveWorktree;
    getPrimaryBranch?: typeof getPrimaryBranch;
    missionPath?: string;
    rootDir?: string;
  } = {}
): { ok: boolean; findings: string[] } {
  const log = options.log || fmt.log.plain;
  const findMissionDirFn = options.findMissionDir || findMissionDir;
  const findCheckpointsFn = options.findCheckpoints || findCheckpoints;
  const readFileSyncFn = options.readFileSync || fs.readFileSync;
  const runFn = options.run || run;
  const resolveWorktreeFn = options.resolveWorktree || resolveWorktree;
  const getPrimaryBranchFn = options.getPrimaryBranch || getPrimaryBranch;
  const findings: string[] = [];

  log(`Performing static review for mission: ${fmt.slug(slug)}`);

  // Resolve the worktree root early so mission dir and checkpoint lookups use the same base
  const worktreeRoot = resolveWorktreeFn(slug);
  const rootDir = worktreeRoot || process.cwd();

  // Check if mission directory exists (with optional --mission path override)
  const missionDir = findMissionDirFn(slug, rootDir, { missionPath: options.missionPath });
  if (!missionDir) {
    findings.push(`Mission directory not found for slug: ${slug}`);
    return { ok: false, findings };
  }
  log(fmt.status('PASS', `Mission directory found: ${fmt.path(missionDir)}`));

  // Check if checkpoint documents exist
  const checkpoints = findCheckpointsFn(missionDir);
  if (checkpoints.length === 0) {
    findings.push('No checkpoint documents found. Implementation evidence is required.');
    return { ok: false, findings };
  }
  log(fmt.status('PASS', `Found ${checkpoints.length} checkpoint document(s).`));

  // Check the final checkpoint for a Goal Check table
  const finalCheckpoint = checkpoints[checkpoints.length - 1];
  try {
    const checkpointContent = readFileSyncFn(finalCheckpoint, 'utf8') as string;
    const goalCheckMatch = checkpointContent.match(/^## Goal Check(?: Table)?\s*$/m);
    if (!goalCheckMatch) {
      findings.push(`Final checkpoint ${path.basename(finalCheckpoint)} is missing a "## Goal Check" section.`);
    } else {
      log(fmt.status('PASS', 'Final checkpoint contains "## Goal Check" section.'));

      // Verify goal-check table has at least one evidence row
      const afterHeader = checkpointContent.slice(goalCheckMatch.index! + goalCheckMatch[0].length);
      const evidenceRows = collectGoalCheckEvidenceRows(afterHeader);
      if (evidenceRows.length === 0) {
        findings.push(`Final checkpoint ${path.basename(finalCheckpoint)} has "## Goal Check" section but no evidence rows.`);
      } else {
        log(fmt.status('PASS', 'Goal Check table contains evidence rows.'));
        const unverifiableRow = findUnverifiableGoalCheckRow(undefined, evidenceRows, rootDir);
        if (unverifiableRow) {
          findings.push(`Final checkpoint ${path.basename(finalCheckpoint)} has a "## Goal Check" section but no evidence rows that cite a verifiable reference such as a recognized repo command/path, exact test name, test-file path, or ADR reference (or, when necessary, file:line). A goal-check table with real evidence is required before handoff. Offending row: ${unverifiableRow}`);
        }
      }
    }
  } catch (err) {
    findings.push(`Could not read final checkpoint ${path.basename(finalCheckpoint)}: ${(err as Error).message}`);
  }

  // Inspect git diff for changed files
  const baseBranch = getPrimaryBranchFn(rootDir);
  const diffResult = runFn('git', ['diff', `${baseBranch}..HEAD`, '--name-only'], { cwd: rootDir });
  if (diffResult.status === 0 && diffResult.stdout) {
    const changedFiles = (diffResult.stdout as string).trim().split('\n').filter((f: string) => f.trim());
    const missionDirPrefix = path.relative(rootDir, missionBaseDir(rootDir)).split(path.sep).join('/') + '/';
    log(`Changed files in branch: ${changedFiles.join(', ')}`);
    // Check for unexpected areas — missions may legitimately touch many surfaces.
    // Derive allowed set from known workflow areas plus common repo structures,
    // plus any file with a recognized extension or inside the mission directory.
    const knownAreas = [
      'parallix/', 'docs/', 'scripts/', 'config/', 'backlog/', 'forgejo/',
      '.agents/', '.github/', '.vscode/', '.graphifyignore',
    ];
    const knownExtensions = ['.sh', '.csv', '.json', '.yaml', '.yml', '.toml', '.lock', '.cfg', '.ini', '.env', '.txt', '.properties', '.sql', '.css', '.html', '.xml', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.pdf', '.tar', '.gz', '.zip'];
    const unexpectedFiles = changedFiles.filter((f: string) =>
      !knownAreas.some((area: string) => f.startsWith(area)) &&
      !f.startsWith(missionDirPrefix) &&
      !f.endsWith('.md') &&
      !knownExtensions.some((ext: string) => f.toLowerCase().endsWith(ext))
    );
    if (unexpectedFiles.length > 0) {
      log(fmt.status('WARN', `Changed files outside known areas (may be intentional): ${unexpectedFiles.join(', ')}`));
    } else {
      log(fmt.status('PASS', 'All changed files are within expected areas.'));
    }
  } else {
    log(fmt.status('WARN', `git diff ${baseBranch}..HEAD returned no output or failed — branch may be up to date with ${baseBranch}.`));
  }

  return { ok: findings.length === 0, findings };
}
