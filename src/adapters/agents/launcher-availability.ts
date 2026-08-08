import { workflowLauncherStatus } from './launcher-selection.js';
import type { AgentFamily } from '../../domain/agents.js';

// ---------------------------------------------------------------------------
// Launcher availability probe for read-only consumers (board / TUI).
//
// `workflowLauncherStatus` shells out (`command -v` plus a `--help` health
// probe) for every family it is asked about. The board rebuilds its projection
// on every refresh, so the raw probe must never be called per render: this
// module wraps it in a small time-to-live cache keyed by agent family.
// ---------------------------------------------------------------------------

/**
 * Default probe cache lifetime. Each miss spawns `command -v` plus a `--help`
 * health probe per family from the board's build path, so the window is wide:
 * installing or removing an agent CLI is rare, a board refresh is not.
 */
export const DEFAULT_LAUNCHER_PROBE_TTL_MS = 300_000;

/** What a probe found for one family. */
export interface LauncherProbeResult {
  readonly available: boolean;
  /** Short operator-facing explanation when unavailable, else null. */
  readonly detail: string | null;
}

export interface LauncherProbeOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
  /** Injection seam for tests; defaults to the real launcher status probe. */
  readonly probe?: (_family: string) => { supported: boolean; health?: string; reason?: string; detail?: string };
}

interface CacheEntry {
  readonly result: LauncherProbeResult;
  readonly expiresAtMs: number;
}

function describeUnavailable(status: { health?: string; reason?: string }): string {
  if (status.health === 'missing') { return 'launcher missing'; }
  if (status.reason) { return `launcher ${status.health ?? 'probe-failed'}: ${status.reason}`; }
  return `launcher ${status.health ?? 'unavailable'}`;
}

/**
 * Create a cached launcher probe.
 *
 * The returned function reports whether the family's CLI is present and
 * answers its health probe, plus a short reason when it does not. A probe that
 * throws (unknown family, spawn failure) is reported as unavailable rather than
 * propagated — the board must render even on a workstation with no agents
 * installed.
 */
export function createLauncherProbe(options: LauncherProbeOptions = {}): (_family: AgentFamily) => LauncherProbeResult {
  const ttlMs = options.ttlMs ?? DEFAULT_LAUNCHER_PROBE_TTL_MS;
  const now = options.now ?? Date.now;
  const probe = options.probe ?? ((family: string) => workflowLauncherStatus(family));
  const cache = new Map<string, CacheEntry>();

  return (family: AgentFamily): LauncherProbeResult => {
    const cached = cache.get(family);
    const nowMs = now();
    if (cached && cached.expiresAtMs > nowMs) { return cached.result; }

    let result: LauncherProbeResult;
    try {
      const status = probe(family);
      result = status.supported
        ? { available: true, detail: null }
        : { available: false, detail: describeUnavailable(status) };
    } catch (error) {
      result = { available: false, detail: `launcher probe failed: ${(error as Error).message}` };
    }

    cache.set(family, { result, expiresAtMs: nowMs + ttlMs });
    return result;
  };
}
