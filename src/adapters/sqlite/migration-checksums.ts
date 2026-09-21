// The 0007 SQL change only adds WHERE predicates that skip rows the UPDATEs
// would leave unchanged. Old operator databases therefore retain a valid
// legacy checksum; never rewrite their shared ledger.
const LEGACY_CHECKSUMS: Readonly<Record<string, readonly string[]>> = {
  '0007-usage-statistics-identity': ['0bba52d7101501a2a2bc95d20abed97f52bae10670bdf15e55c5d09c391315b3'],
};

export function acceptsMigrationChecksum(id: string, actual: string, expected: string): boolean {
  if (actual === expected) { return true; }
  return actual !== expected && LEGACY_CHECKSUMS[id]?.includes(actual) === true;
}
