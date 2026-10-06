/** Automatic mission terminal hosting, with explicit operator overrides. */

export type TerminalHostKind = 'auto' | 'pipe' | 'tmux';
export type TerminalUnavailablePolicy = 'fallback' | 'fail';

export interface TerminalHostConfig {
  readonly host: TerminalHostKind;
  readonly whenUnavailable: TerminalUnavailablePolicy;
}

export const DEFAULT_TERMINAL_HOST_CONFIG: TerminalHostConfig = Object.freeze({ host: 'auto', whenUnavailable: 'fallback' });

const HOSTS: readonly string[] = ['auto', 'pipe', 'tmux'];
const POLICIES: readonly string[] = ['fallback', 'fail'];
const KEYS: readonly string[] = ['host', 'whenUnavailable'];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Append one issue per invalid `adapters.terminal` field. */
export function validateTerminalSection(section: unknown, issues: string[]): void {
  if (section === undefined) { return; }
  if (!isObject(section)) { return; } // the generic adapter check reports non-objects
  for (const key of Object.keys(section)) {
    if (!KEYS.includes(key)) {
      issues.push(`adapters.terminal may only contain ${KEYS.map(k => `"${k}"`).join(', ')}`);
    }
  }
  if ('host' in section && !HOSTS.includes(section.host as string)) {
    issues.push('adapters.terminal.host must be one of "auto", "pipe", "tmux"');
  }
  if ('whenUnavailable' in section && !POLICIES.includes(section.whenUnavailable as string)) {
    issues.push('adapters.terminal.whenUnavailable must be one of "fallback", "fail"');
  }
}

/** Resolve the terminal host from a loaded `adapters` object; invalid values fall back to defaults. */
export function terminalHostConfig(adapters: Record<string, unknown> | null | undefined): TerminalHostConfig {
  const section = adapters && isObject(adapters.terminal) ? adapters.terminal : {};
  const host = HOSTS.includes(section.host as string) ? section.host as TerminalHostKind : DEFAULT_TERMINAL_HOST_CONFIG.host;
  const whenUnavailable = POLICIES.includes(section.whenUnavailable as string)
    ? section.whenUnavailable as TerminalUnavailablePolicy
    : DEFAULT_TERMINAL_HOST_CONFIG.whenUnavailable;
  return Object.freeze({ host, whenUnavailable });
}
