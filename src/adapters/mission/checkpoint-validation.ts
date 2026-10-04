import * as path from 'node:path';
import { git } from '../git/git.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { findMissionDir, findCheckpoints, readMissionFile } from '../filesystem/mission-utils.js';
import type { CheckpointValidationVerdict } from '../../application/ports/execute-mission.js';

function parseDeclaredCheckpointNames(missionText: string): { names: string[]; error?: string } {
  const section = /^## Checkpoints\s*$/m.exec(missionText);
  if (!section || section.index === undefined) {return { names: [], error: 'MISSION.md must contain a ## Checkpoints section with declarations such as "- CP 1: <name>".' };}
  const body = missionText.slice(section.index + section[0].length).split(/^#{2,3}\s/m, 1)[0];
  const lines = body.split('\n').filter(line => /^\s*-\s*(?:\*\*|__|\*)?CP(?:\s*-\s*|\s*)\d/i.test(line));
  const names: string[] = [];
  for (const line of lines) {
    const match = /^\s*-\s*(?:\*\*|__|\*)?CP(?:\s*-\s*|\s*)(\d+)(?:\s*\([^)]*\))?(?:\*\*|__|\*)?\s*(?::|—|–|-)\s*\S/i.exec(line);
    if (!match) {return { names: [], error: `Malformed checkpoint declaration in MISSION.md: ${line.trim()}. Use a CP number followed by :, —, –, or -.` };}
    names.push(`CP-${match[1]}`);
  }
  return names.length ? { names: [...new Set(names)] } : { names: [], error: 'MISSION.md ## Checkpoints section contains no checkpoint declarations. Use "- CP N: <name>" or "- CP-N: <name>".' };
}

/** Filesystem/Git checkpoint evidence mechanism; it makes no workflow decision. */
export async function validateCheckpointsBeforeHandoff(
  slug: string,
  worktree: string,
  options: { loadRecordedCheckpointsFn?: (_slug: string) => Promise<{ planned: string[]; recorded: string[] } | null>; log?: (_message: string) => void; error?: (_message: string) => void; findMissionDirFn?: typeof findMissionDir; findCheckpointsFn?: typeof findCheckpoints; readMissionFileFn?: typeof readMissionFile; runFn?: (..._args: any[]) => any } = {},
): Promise<CheckpointValidationVerdict> {
  const fail = (message: string, extra: Partial<CheckpointValidationVerdict> = {}) => { options.error?.(message); return { ok: false, error: message, ...extra }; };
  const recorded = await (options.loadRecordedCheckpointsFn ?? (async (_slug: string) => null))(slug);
  if (recorded) {
    const missing = recorded.planned.filter(name => !recorded.recorded.includes(name));
    if (missing.length) {return fail(`Planned checkpoint evidence is missing before handoff: ${missing.join(', ')}. Record each with \`px checkpoint record --name <CP-N>\` before handoff.`, { missingCheckpoints: missing, nextCheckpoint: missing[0] });}
    options.log?.(fmt.status('PASS', `All ${recorded.planned.length} planned checkpoint(s) have recorded evidence.`));
    return { ok: true, declaredCheckpoints: recorded.planned };
  }
  const rootDir = worktree || process.cwd();
  const missionDir = (options.findMissionDirFn ?? findMissionDir)(slug, rootDir);
  if (!missionDir) {return fail(`Mission directory not found for slug: ${fmt.slug(slug)}. Cannot validate checkpoints.`);}
  let declared: { names: string[]; error?: string };
  try { declared = parseDeclaredCheckpointNames((options.readMissionFileFn ?? readMissionFile)(missionDir)); }
  catch (error) { return fail(`Could not read ${fmt.path(path.join(missionDir, 'MISSION.md'))} to validate declared checkpoints: ${(error as Error).message}`); }
  if (declared.error) {return fail(declared.error);}
  const checkpoints = (options.findCheckpointsFn ?? findCheckpoints)(missionDir);
  const names = new Set(checkpoints.map(checkpoint => /(?:CP-|CHECKPOINT_)(\d+)/i.exec(path.basename(checkpoint))?.[1]).filter(Boolean).map(number => `CP-${number}`));
  const missing = declared.names.filter(name => !names.has(name));
  if (missing.length) {return fail(`Declared checkpoint documents are missing before handoff: ${missing.join(', ')}. Create and commit ${missing.map(name => `${name}.md`).join(', ')} in ${fmt.path(missionDir)} before handoff.`, { missingCheckpoints: missing, nextCheckpoint: missing[0] });}
  if (!checkpoints.length) {return fail(`No checkpoint documents found in ${fmt.path(missionDir)}. The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before handoff. Create at least CP-1 documenting your implementation, including a Goal Check table with real evidence such as a backticked command, test name, ADR reference, or test file path.`);}
  const args = checkpoints.map(checkpoint => path.relative(rootDir, checkpoint) || checkpoint);
  const status = (options.runFn ?? git)(['status', '--porcelain', '--', ...args], { cwd: rootDir });
  if (status.status !== 0) {return fail(`Could not verify checkpoint commit state for ${fmt.slug(slug)}: ${(status.stderr || status.stdout || '').trim() || 'git status failed'}`);}
  const dirty = String(status.stdout || '').split('\n').map((line: string) => line.trimEnd()).filter(Boolean).map((line: string) => line.slice(3).trim()).filter(Boolean);
  if (dirty.length) {return fail(`Checkpoint documents must be committed before handoff. Uncommitted checkpoint files: ${dirty.map((file: string) => fmt.path(file)).join(', ')}. Commit the checkpoint update and re-run the handoff.`);}
  options.log?.(fmt.status('PASS', `Found all ${declared.names.length} declared checkpoint document(s) in ${fmt.path(missionDir)}.`));
  return { ok: true, declaredCheckpoints: declared.names };
}
