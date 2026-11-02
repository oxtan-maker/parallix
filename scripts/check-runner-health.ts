import { assertRunnerHealth, defaultUserRuntimeDir, RUNNER_HEALTH_EXIT_STATUS } from '../src/adapters/process/test-memory-cgroup.ts';
import { MEMORY_BOUNDARY_ENV, MEMORY_LIMIT_ENV, resolveMemoryBoundaryPolicy } from '../src/adapters/process/test-memory-policy.ts';

try {
  if (!process.env.XDG_RUNTIME_DIR && !process.env.DBUS_SESSION_BUS_ADDRESS) {
    const directory = defaultUserRuntimeDir();
    if (directory) { process.env.XDG_RUNTIME_DIR = directory; }
  }
  const policy = resolveMemoryBoundaryPolicy({
    boundaryMode: process.env[MEMORY_BOUNDARY_ENV], limitMiB: process.env[MEMORY_LIMIT_ENV],
    workload: 'unit', hostedRunner: process.env.GITHUB_ACTIONS === 'true',
  });
  assertRunnerHealth(policy.mode === 'cgroup' ? policy.limitMiB : null, {
    runtimeDir: process.env.XDG_RUNTIME_DIR,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(RUNNER_HEALTH_EXIT_STATUS);
}
