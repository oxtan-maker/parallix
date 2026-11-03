import { captureTerminalTranscript } from '../adapters/process/terminal-transcript.js';
import { selectDiskBackedDirectory } from '../adapters/process/bulk-storage.js';

/** Private pipe worker; shares the launch's placement and retention owner. */
export async function runTerminalTranscriptWriter(root: string, legacyRootsJson: string, dir: string, name: string): Promise<void> {
  const legacyRoots: unknown = JSON.parse(legacyRootsJson);
  if (!Array.isArray(legacyRoots) || !legacyRoots.every(value => typeof value === 'string')) { throw new Error('Invalid legacy terminal roots'); }
  const selected = selectDiskBackedDirectory({ purpose: 'Mission terminal transcripts', candidates: [root], remedy: 'Point PARALLIX_HOME at a disk-backed directory.' });
  await captureTerminalTranscript({
    stream: process.stdin, dir, name, root: selected, legacyRoots,
  });
}
