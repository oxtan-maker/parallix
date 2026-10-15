

import { draftMissionServices, type DraftLog } from './draft-adapter-types.js';

import type { DraftWorkflowContext } from '../../../application/ports/cli-workflows.js';
import * as fmt from '../../../application/presentation/cli-format.js';
import { formatElapsed } from '../../agents/agents.js';

import { missionBranchName } from '../../filesystem/mission-utils.js';

import { missionId } from '../../../domain/mission.js';

/**
 * Two-column detail rows for the draft header and summary. `fmt.table` pads its
 * final column, which leaves trailing whitespace on every line an operator
 * copies out of the terminal, so these rows pad only the label.
 */
export function detailRows(rows: string[][]): string {
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `  ${fmt.dim(label.padEnd(width))}  ${value}`).join('\n');
}

/**
 * Digest of the drafted contract for the closing summary: the goal, and how
 * many success criteria, planned checkpoints and gates the operator is about to hold an implementer
 * to, read from the recorded Mission. Presentation only — an unreadable Mission
 * yields an empty digest rather than a new failure mode (mission stop rule).
 */
export async function readMissionDigest(ctx: DraftWorkflowContext) {
  try {
    const services = await draftMissionServices(ctx);
    const loaded = await services.store.load(missionId(ctx.slug));
    if (loaded.kind !== 'found') { return { title: ctx.slug, goal: '', criteria: 0, checkpoints: 0, gates: 0, nel: '' }; }
    const { mission } = loaded;
    return {
      title: mission.title || ctx.slug,
      goal: mission.brief?.goal ?? '',
      criteria: (mission.successCriteria ?? []).length,
      checkpoints: mission.checkpoints.length,
      gates: (mission.declaredGates ?? []).length,
      nel: mission.predictedNelBucket ?? '',
    };
  } catch {
    return { title: ctx.slug, goal: '', criteria: 0, checkpoints: 0, gates: 0, nel: '' };
  }
}

export function digestCount(value: number, singular: string, plural: string) {
  return value ? `${value} ${value === 1 ? singular : plural}` : '';
}

export function logDraftDigest(digest: Awaited<ReturnType<typeof readMissionDigest>>, logFn: DraftLog) {
  if (digest.goal) {
    logFn('');
    logFn(fmt.bold('Goal'));
    const width = Math.max(40, Math.min((process.stdout.columns || 80) - 4, 96));
    for (const line of wrapIndented(digest.goal, width).slice(0, 6)) { logFn(line); }
    const counts = [
      digestCount(digest.criteria, 'success criterion', 'success criteria'),
      digestCount(digest.checkpoints, 'checkpoint', 'checkpoints'),
      digestCount(digest.gates, 'gate', 'gates'),
      digest.nel ? `NEL ${digest.nel}` : '',
    ].filter(Boolean);
    if (counts.length > 0) {
      logFn('');
      logFn(`  ${fmt.dim(counts.join(' · '))}`);
    }
  }
}

export async function logDraftCompletion(ctx: DraftWorkflowContext, startedAtMs: number, logFn: DraftLog) {
  const digest = await readMissionDigest(ctx);
  const missionTitle = digest.title;
  logFn('');
  logFn(fmt.status('PASS', `Drafted ${fmt.slug(ctx.slug)} in ${formatElapsed(Date.now() - startedAtMs)}: ${fmt.bold(missionTitle)}`));
  logFn(detailRows([
    ['contract', fmt.command(`px status ${ctx.slug}`)],
    ['branch', fmt.branch(ctx.branchName || missionBranchName(ctx.slug, ctx.mainRepo))],
    ['agent', fmt.agent(ctx.actualAgent || ctx.agent || 'unknown')],
  ]));
  logDraftDigest(digest, logFn);
  logFn('');
  // The worktree is emitted as `Working directory:` rather than a detail row on
  // purpose: the `px` shell function from `px shell-init`
  // (`src/composition/create-cli.ts`) greps `[INFO] Next: cd ` and, failing that,
  // `[INFO] Working directory: ` to cd the operator into the mission worktree.
  // Changing this string silently breaks that shell integration for `px draft`.
  logFn(fmt.status('INFO', `Working directory: ${ctx.targetWorktree}`));
  logFn(fmt.status('INFO', `Next: ${fmt.command('px active')}`));
}

/** Wrap plain text to `width` columns, indented by two spaces. */
export function wrapIndented(text: string, width: number) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > width) { lines.push(`  ${line}`); line = word; }
    else { line = line ? `${line} ${word}` : word; }
  }
  if (line) { lines.push(`  ${line}`); }
  return lines;
}