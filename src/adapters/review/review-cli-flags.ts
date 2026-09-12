import * as fs from 'fs';
import * as fmt from '../../application/presentation/cli-format.js';

export const REVIEW_FLAGS = new Set([
  '--actor', '--backfill-review', '--branch', '--close', '--comment', '--comment-file', '--comments', '--consume-artifacts', '--continue', '--create-event', '--disposition', '--dry-run', '--eligible-reviewer', '--focus', '--force', '--implementer', '--import-legacy', '--input-file', '--max-attempts', '--message', '--message-file', '--mission', '--no-gate', '--phase', '--poll-timeout-seconds', '--push', '--reconcile-review', '--resume', '--revision', '--reset', '--reviewer', '--round', '--target', '--start', '--status', '--submit', '--submit-review', '--tmp-dir', '--type', '--verbose', '--verdict', '--verify'
]);

export const REVIEW_VALUE_FLAGS = new Set([
  '--actor', '--branch', '--comment', '--comment-file', '--disposition', '--eligible-reviewer', '--focus', '--implementer', '--input-file', '--max-attempts', '--message', '--message-file', '--mission', '--phase', '--poll-timeout-seconds', '--reviewer', '--round', '--revision', '--submit-review', '--target', '--tmp-dir', '--type', '--verdict'
]);

export function unknownReviewFlags(args: string[]): string[] {
  const unknown: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) { continue; }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (REVIEW_FLAGS.has(name)) {
      if (eq === -1 && REVIEW_VALUE_FLAGS.has(name) && args[i + 1] !== undefined) { i += 1; }
      continue;
    }
    unknown.push(name);
  }
  return unknown;
}

export function flagValue(args: string[], flag: string): string | null {
  const inline = args.find(a => a.startsWith(`${flag}=`));
  if (inline) { return inline.slice(flag.length + 1) || null; }
  const idx = args.indexOf(flag);
  if (idx === -1) { return null; }
  const val = args[idx + 1];
  return !val || val.startsWith('--') ? null : val;
}

export function repeatedFlagValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === flag && args[index + 1] && !args[index + 1].startsWith('--')) { values.push(args[index + 1]); }
    if (value.startsWith(`${flag}=`) && value.slice(flag.length + 1)) { values.push(value.slice(flag.length + 1)); }
  }
  return values;
}

export function readTextFlag(args: string[], inlineFlag: string, fileFlag: string, label: string, options: { readFileSync?: typeof fs.readFileSync; error?: (_msg: string) => void; exit?: (_code: number) => never } = {}): string | null {
  const filePath = flagValue(args, fileFlag);
  if (filePath) {
    try { return ((options.readFileSync || fs.readFileSync)(filePath, 'utf8') as string).trimEnd(); }
    catch (err) { (options.error || fmt.log.plainError)(`Could not read ${label} from ${fmt.path(filePath)}: ${(err as Error).message}`); (options.exit || process.exit)(1); return null; }
  }
  return flagValue(args, inlineFlag);
}
