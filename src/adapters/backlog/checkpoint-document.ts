/**
 * Translation between the compatibility `CP-N.md` document and the checked
 * `CheckpointData` value.
 *
 * These functions are pure: the Markdown *shape* is a compatibility-adapter
 * concern, and the surrounding store owns the file access. The accepted shape is
 * the one handoff already enforces — an `# CP-N:` heading, a
 * `## Goal Check` (or `## Goal Check Table`) section, a 3-column pipe table, and
 * a `Next action:` line.
 */

import type { CheckpointData, GoalCheckRow } from '../../domain/checkpoint.js';
import { isCheckpointName } from '../../domain/checkpoint.js';
import type { MissionId } from '../../domain/mission.js';

const GOAL_CHECK_HEADING = /^##\s+Goal Check(?: Table)?\s*$/;
const SEPARATOR_ROW = /^\|(?:\s*:?-+:?\s*\|)+$/;
const TABLE_ROW = /^\|(.+)\|$/;
const NEXT_ACTION = /^Next action:\s*(.+)$/i;

/** Split a pipe table row into trimmed cells. */
function cells(line: string): string[] {
  const match = TABLE_ROW.exec(line.trim());
  if (!match) {
    return [];
  }
  return match[1].split('|').map((cell) => cell.trim());
}

/**
 * Read one checkpoint document.
 *
 * A row is Goal Check evidence when it has a criterion and an evidence cell;
 * the third `Status` column is presentation and is not part of `GoalCheckRow`.
 */
export function parseCheckpointDocument(
  missionId: MissionId,
  filename: string,
  content: string,
): CheckpointData {
  const name = filename.replace(/\.md$/i, '');
  if (!isCheckpointName(name)) {
    throw new Error(`Checkpoint document ${filename} is not named CP-<n>.md`);
  }

  const lines = content.split('\n');
  const firstLine = (lines[0] ?? '').replace(/^#+\s*/, '').trim();

  const goalCheck: GoalCheckRow[] = [];
  let inGoalCheck = false;
  let headerSeen = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (GOAL_CHECK_HEADING.test(trimmed)) {
      inGoalCheck = true;
      headerSeen = false;
      continue;
    }
    if (!inGoalCheck) {
      continue;
    }
    if (trimmed === '') {
      continue;
    }
    if (trimmed.startsWith('##')) {
      inGoalCheck = false;
      continue;
    }
    if (SEPARATOR_ROW.test(trimmed)) {
      continue;
    }
    const row = cells(trimmed);
    if (row.length < 2) {
      inGoalCheck = false;
      continue;
    }
    if (!headerSeen) {
      // The first table row is the `| Criterion | Evidence | Status |` header.
      headerSeen = true;
      continue;
    }
    if (row[0].length > 0 && row[1].length > 0) {
      goalCheck.push({ criterion: row[0], evidence: row[1] });
    }
  }

  let nextActionText = '';
  for (const line of lines) {
    const match = NEXT_ACTION.exec(line.trim());
    if (match) {
      nextActionText = match[1].trim();
    }
  }

  return {
    missionId,
    name,
    rawFilename: `${name}.md`,
    firstLine,
    goalCheck,
    nextActionText,
  };
}

/**
 * Render a checkpoint document from checked data.
 *
 * The output satisfies the same handoff integrity checks the hand-written
 * documents do, so a checkpoint recorded through the application boundary is
 * indistinguishable from one written by an agent.
 */
export function renderCheckpointDocument(checkpoint: CheckpointData): string {
  const heading = checkpoint.firstLine?.trim()
    ? checkpoint.firstLine.trim()
    : `${checkpoint.name}: recorded through the Mission application boundary`;
  return [
    `# ${heading.startsWith(checkpoint.name) ? heading : `${checkpoint.name}: ${heading}`}`,
    '',
    '## Goal Check',
    '',
    '| Criterion | Evidence | Status |',
    '|---|---|---|',
    ...checkpoint.goalCheck.map((row) => `| ${row.criterion} | ${row.evidence} | PASS |`),
    '',
    `Next action: ${checkpoint.nextActionText}`,
    '',
  ].join('\n');
}
