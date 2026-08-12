import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

function signalExitCode(signal: NodeJS.Signals) {
  return 128 + (os.constants.signals[signal] || 0);
}

export { cleanupRunnerTempRoots, signalExitCode };
