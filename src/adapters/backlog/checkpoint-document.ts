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

function goalCheckLineKind(line: string, inGoalCheck: boolean): 'start' | 'skip' | 'end' | 'row' {
  if (GOAL_CHECK_HEADING.test(line)) { return 'start'; }
  if (!inGoalCheck || line === '' || SEPARATOR_ROW.test(line)) { return 'skip'; }
  return line.startsWith('##') ? 'end' : 'row';
}

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

  const goalCheck = parseGoalCheckTable(lines);

  let nextActionText = '';
  let nextHeading = false;
  const nextLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const match = NEXT_ACTION.exec(trimmed);
    if (match) {
      nextActionText = match[1].trim();
      nextHeading = false;
    } else if (/^##\s+Next action\s*$/i.test(trimmed)) {
      nextHeading = true;
      nextLines.length = 0;
    } else if (nextHeading && trimmed && !trimmed.startsWith('#')) {
      nextLines.push(trimmed);
      nextActionText = nextLines.join('\n');
    } else if (nextHeading && nextLines.length > 0) {
      nextHeading = false;
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

/** Keep whichever side has strictly more matching evidence; reject disagreement. */
export function reconcileLegacyCheckpoint(
  recorded: CheckpointData,
  source: CheckpointData,
): CheckpointData | null {
  if (recorded.name !== source.name) { return null; }
  const text = (left: string, right: string) => left && right && left !== right ? null : left || right;
  const firstLine = text(recorded.firstLine ?? '', source.firstLine ?? '');
  if (firstLine === null) { return null; }
  const contains = (outer: readonly GoalCheckRow[], inner: readonly GoalCheckRow[]) =>
    inner.every(row => outer.some(candidate => candidate.criterion === row.criterion && candidate.evidence === row.evidence));
  const goalCheck = contains(recorded.goalCheck, source.goalCheck)
    ? recorded.goalCheck
    : contains(source.goalCheck, recorded.goalCheck) ? source.goalCheck : null;
  if (goalCheck === null) { return null; }
  const sameEvidence = recorded.firstLine === source.firstLine
    && contains(recorded.goalCheck, source.goalCheck)
    && contains(source.goalCheck, recorded.goalCheck);
  // Old handoff used this synthetic action when it failed to parse the file.
  const syntheticAction = recorded.nextActionText === 'Review the handed-off change.'
    && sameEvidence && source.nextActionText.length > 0;
  // Earlier imports captured only the first line after a Next action heading.
  const nextActionText = syntheticAction || source.nextActionText.startsWith(`${recorded.nextActionText}\n`)
    ? source.nextActionText : text(recorded.nextActionText, source.nextActionText);
  if (nextActionText === null) { return null; }
  return { ...recorded, firstLine, nextActionText, goalCheck };
}

/**
 * Scan checkpoint lines for the `## Goal Check` table, returning the
 * criterion/evidence rows. Presentation only: the `Status` column and the
 * `| Criterion | Evidence | Status |` header are skipped.
 */
function parseGoalCheckTable(lines: string[]): GoalCheckRow[] {
  const goalCheck: GoalCheckRow[] = [];
  let inGoalCheck = false;
  let headerSeen = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const kind = goalCheckLineKind(trimmed, inGoalCheck);
    if (kind === 'start') {
      inGoalCheck = true;
      headerSeen = false;
      continue;
    }
    if (kind === 'end') {
      inGoalCheck = false;
      continue;
    }
    if (kind === 'skip') { continue; }
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
  return goalCheck;
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
