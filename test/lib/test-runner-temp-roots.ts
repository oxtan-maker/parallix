import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DISK_TEMP_FALLBACK } from '../../src/adapters/process/bulk-storage.js';
import type { TempRootRecoveryReport } from '../../src/adapters/verification/temp-root-registry.js';

function cleanupRunnerTempRoots(manifestDir: string) {
  try {
    if (!fs.existsSync(manifestDir)) { return; }
    const roots = new Set<string>();
    for (const entry of fs.readdirSync(manifestDir)) {
      if (!entry.endsWith('.json')) { continue; }
      try {
        const recorded = JSON.parse(fs.readFileSync(path.join(manifestDir, entry), 'utf8'));
        if (Array.isArray(recorded)) { recorded.forEach(root => roots.add(root)); }
      } catch (_) {}
    }
    for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {} }
    fs.rmSync(manifestDir, { recursive: true, force: true });
  } catch (_) {}
}

/**
 * Temporary bases where covered runners keep (or kept) their coverage scratch:
 * the system temporary directory and the disk-backed fallback (TASK-2816).
 */
function legacyCoverageBases(): string[] {
  return [...new Set([os.tmpdir(), ...(process.platform === 'win32' ? [] : [DISK_TEMP_FALLBACK])])];
}

/** Report what recovery kept instead of silently leaving it behind. */
function reportUnresolvedTempRoots(report: TempRootRecoveryReport, write: (_line: string) => void = line => { console.error(line); }): void {
  if (report.reclaimed.length > 0) { write(`[temp-root-recovery] reclaimed ${report.reclaimed.length} abandoned temporary root(s)`); }
  if (report.unresolved.length === 0) { return; }
  write(`[temp-root-recovery] kept ${report.unresolved.length} unresolved temporary root(s): ${report.unresolved.map(({ root, reason }) => `${root} (${reason})`).join('; ')}`);
}

function signalExitCode(signal: NodeJS.Signals) {
  return 128 + (os.constants.signals[signal] || 0);
}

export { cleanupRunnerTempRoots, legacyCoverageBases, reportUnresolvedTempRoots, signalExitCode };
