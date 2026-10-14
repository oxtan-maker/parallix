// The 0007 SQL change only adds WHERE predicates that skip rows the UPDATEs
// would leave unchanged, and the 0018 change only renames the adhoc identity
// prefix in a comment. Old operator databases therefore retain a valid legacy
// checksum; never rewrite their shared ledger.
const LEGACY_CHECKSUMS: Readonly<Record<string, readonly string[]>> = {
  '0007-usage-statistics-identity': ['0bba52d7101501a2a2bc95d20abed97f52bae10670bdf15e55c5d09c391315b3'],
  '0018-adhoc-mission-counter': ['3560376d8e31e0b8fc527509211378a839ba24ef5e5e5fac9ee6dadc06c172c2'],
};

export function acceptsMigrationChecksum(id: string, actual: string, expected: string): boolean {
  if (actual === expected) { return true; }
  // TASK-2742: 0038 predicates skip only unchanged rows. Accept its original
  // ledger entry only for this exact equivalent SQL, never arbitrary drift.
  if (id === '0038-success-criterion-identity') {
    return actual === '674db493a344c3d3ffd5c0d9e4eca5f51672d442e9c591380a0ba0888ca9ed3c'
      && expected === 'd59c6e91e82e9cdd93fb2735209a396cfd9d68c73dbee18b55b4db68b00d44f1';
  }
  return actual !== expected && LEGACY_CHECKSUMS[id]?.includes(actual) === true;
}
