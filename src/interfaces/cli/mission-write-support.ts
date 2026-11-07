import * as fmt from '../../application/presentation/cli-format.js';
import { missionVersion } from '../../application/domain-ports.js';
import { missionId } from '../../domain/mission.js';

export function flag(args: readonly string[], name: string): string | null {
  const index = args.lastIndexOf(name);
  return index < 0 ? null : args[index + 1] ?? null;
}

export function flags(args: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (const [index, arg] of args.entries()) {
    if (arg === name) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) { fail(`${name} needs a value`); }
      values.push(value);
    }
  }
  return values;
}

export function fail(message: string): never { throw new Error(message); }
export function requireOperator(direct: boolean, operation = 'Checkpoint correction'): void {
  if (!direct) { fail(`${operation} requires a direct operator invocation`); }
}
export function required(args: readonly string[], name: string): string {
  const value = flag(args, name);
  if (value === null || value.startsWith('--')) { fail(`${name} <value> is required`); }
  return value;
}
export function output(value: unknown): void { fmt.log.plain(JSON.stringify(value, null, 2)); }

export function request(
  args: readonly string[], operation: string, resolveSlug: (_explicit?: string) => string | null,
  capability: 'mission:context' | 'checkpoint:record' | 'checkpoint:correct' = 'mission:context',
) {
  const slug = resolveSlug(flag(args, '--slug') ?? undefined);
  if (!slug) { fail('no mission slug: run inside the mission worktree or pass --slug <slug>'); }
  const expectedVersion = (() => {
    if (!args.includes('--expected-version')) { return undefined; }
    const parsed = Number(flag(args, '--expected-version'));
    if (!Number.isSafeInteger(parsed) || parsed < 1) { fail('--expected-version must be a positive integer'); }
    return missionVersion(parsed);
  })();
  return { operationId: `px-${operation}-${slug}`, missionId: missionId(slug), expectedVersion, capabilities: new Set([capability]) };
}

export function unwrap<T>(outcome: { status: string; error?: { message?: string }; value?: T }, what: string): T {
  if (outcome.status !== 'completed') { fail(outcome.error?.message ?? `${what} failed`); }
  return outcome.value as T;
}

export function helped(args: readonly string[], help: string): boolean {
  if (args.includes('--help') || args.includes('-h')) { fmt.log.plain(help); return true; }
  return false;
}
