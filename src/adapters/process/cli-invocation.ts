import path from 'node:path';
import { isSea } from 'node:sea';

export interface CliInvocation {
  command: string;
  args: readonly string[];
}

/** Re-enter this CLI directly, including its source loader or native binary. */
export function cliInvocation(entry: string): CliInvocation {
  return {
    command: process.execPath,
    args: isSea() ? [] : [...process.execArgv, path.resolve(entry)],
  };
}
