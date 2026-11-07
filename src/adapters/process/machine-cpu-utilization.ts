import os from 'node:os';

interface CpuSnapshot { readonly idle: number; readonly total: number }

function snapshot(cpus: ReturnType<typeof os.cpus>): CpuSnapshot | null {
  if (!cpus.length) { return null; }
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }
  return Number.isFinite(idle) && Number.isFinite(total) ? { idle, total } : null;
}

/** Measure whole-machine CPU over an interval; unavailable data fails closed. */
export async function observeMachineCpuUtilization(options: {
  read?: typeof os.cpus;
  wait?: () => Promise<void>;
} = {}): Promise<number | null> {
  const read = options.read ?? os.cpus;
  const wait = options.wait ?? (() => new Promise(resolve => setTimeout(resolve, 100)));
  try {
    const before = snapshot(read());
    await wait();
    const after = snapshot(read());
    if (!before || !after) { return null; }
    const total = after.total - before.total;
    const idle = after.idle - before.idle;
    if (total <= 0 || idle < 0 || idle > total) { return null; }
    return (total - idle) / total;
  } catch { return null; }
}
