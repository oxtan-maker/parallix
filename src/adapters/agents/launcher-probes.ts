import type { ParallixConfiguration } from '../../application/ports/configuration.js';
// Launcher availability probes and their injection seams stay independent of
// agent dispatch so the test bootstrap can install doubles without loading it.
import { spawnSync } from 'node:child_process';

let commandPathProbe: ((name: string) => string | null) | null = null;

function commandInPath(name: string, configuration?: ParallixConfiguration) {
  if (commandPathProbe) {
    return commandPathProbe(name) || false;
  }
  // Pass the allowlisted name as a positional argument ($1) rather than
  // interpolating it into the shell string, so shell metacharacters in the
  // name cannot be interpreted by bash (CodeQL js/shell-command-injection).
  const result = spawnSync('bash', ['-c', 'command -v "$1"', '_', name], {
    encoding: 'utf8', env: configuration?.forwardedEnvironment,
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return result.status === 0 && result.stdout.trim().length > 0;
}

// Injection seam for the `--help` health probe. The default shells out to the
// real launcher CLI, which is slow (node-based CLIs take hundreds of ms to
// answer --help) and environment-dependent; unit tests must never trigger it.
// Mirrors commandPathProbe above: null restores the real spawn-based probe.
let launcherHealthProbe: ((_command: string, _args: string[]) => { ok: boolean; reason?: string }) | null = null;

function probeLauncherHealth(command: string, args: string[], configuration?: ParallixConfiguration) {
  if (launcherHealthProbe) {
    return launcherHealthProbe(command, args);
  }
  const probe = spawnSync(command, args, {
    encoding: 'utf8', env: configuration?.forwardedEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 3000
  });
  if (probe.error || probe.status !== 0) {
    const pErr: Error & { code?: string } = probe.error || new Error('');
    return { ok: false, reason: probe.error ? (pErr.code || pErr.message) : `exit ${probe.status}` };
  }
  return { ok: true };
}

const setCommandPathProbe = (fn: ((name: string) => string | null) | null) => {
  commandPathProbe = typeof fn === 'function' ? fn : null;
};

const setLauncherHealthProbe = (fn: ((_command: string, _args: string[]) => { ok: boolean; reason?: string }) | null) => {
  launcherHealthProbe = typeof fn === 'function' ? fn : null;
};

export { commandInPath, probeLauncherHealth, setCommandPathProbe, setLauncherHealthProbe };
