/** Only a confirmed dead owner permits reclaiming a published build lock. */
export function isBuildLockAbandoned(
  owner: string | undefined,
  ageMs: number,
  probe: (pid: number) => void,
): boolean {
  // mkdir precedes writing the owner file. Give that publication window time
  // to close; malformed/missing owners retain the legacy ten-minute fallback.
  if (!owner || !/^[1-9]\d*$/.test(owner.trim())) { return ageMs > 600_000; }
  const pid = Number(owner.trim());
  if (!Number.isSafeInteger(pid)) { return ageMs > 600_000; }
  try {
    probe(pid);
    return false;
  } catch (error) {
    // EPERM means the owner exists but is not ours to signal.
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}
