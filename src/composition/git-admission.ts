import { configureGitProcess, type BootstrapGitSpawn } from '../application/ports/git-process-context.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import { spawnAdmittedGit } from '../adapters/git/git-mutation-admission.js';
import { ensureStandaloneGitRepo, ensureStandaloneMissionBaseline } from '../adapters/config/product-config.js';

export const admittedBootstrapGitSpawn: BootstrapGitSpawn = (_command, args, options) => {
  const result = spawnAdmittedGit([...args], options);
  return { status: result.status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
};

/** Bootstrap adapters stay standalone; composition supplies production admission. */
export function createBootstrapGitBindings(configuration?: ParallixConfiguration) {
  return {
    ensureStandaloneGitRepo: (rootDir = process.cwd()) => ensureStandaloneGitRepo(rootDir, { spawnSyncFn: admittedBootstrapGitSpawn }),
    ensureStandaloneMissionBaseline: (rootDir = process.cwd()) => ensureStandaloneMissionBaseline(rootDir, { spawnSyncFn: admittedBootstrapGitSpawn, configuration }),
  };
}

export function bindGitAdmission(configuration: ParallixConfiguration): void {
  configureGitProcess({ inheritedMarkers: configuration.runtime.gitAdmissionMarkers ?? {} });
}
