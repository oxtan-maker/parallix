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
import {
  collectGoalCheckEvidenceRows,
  collectRepoTestNames,
  canonicalSourceContainsFile,
  evidenceCellHasVerifiableReference,
  findUnverifiableGoalCheckRow,
  type EvidenceFileSystemPort,
  type EvidenceDirent,
} from '../../application/static-evidence.js';

export {
  collectGoalCheckEvidenceRows,
  collectRepoTestNames,
  canonicalSourceContainsFile,
  evidenceCellHasVerifiableReference,
  findUnverifiableGoalCheckRow,
};

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
  // static-evidence.ts lives in the application layer, which forbids node:fs;
  // build an fs-backed port here so its helpers can read real files.
  const evidenceFileSystem: EvidenceFileSystemPort = {
    existsSync: (target) => fs.existsSync(target),
    readText: (target) => (readFileSyncFn as typeof fs.readFileSync)(target, 'utf8'),
    listEntries: (target) =>
      fs.readdirSync(target, { withFileTypes: true }) as unknown as EvidenceDirent[],
    listNames: (target) => fs.readdirSync(target),
  };
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
        const unverifiableRow = findUnverifiableGoalCheckRow(evidenceFileSystem, evidenceRows, rootDir);
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
