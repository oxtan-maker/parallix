// Shared comparator for the SonarQube S2871 repairs. One helper replaces the
// same nested-ternary comparator pasted into 18 files. A plain if/if avoids the
// Sonar S3358 "nested ternary" smell the inline version triggered. UTF-16
// code-unit order (not localeCompare) so the explicit comparator reproduces the
// pre-repair default `.sort()` order exactly.
export function compareCodeUnits(left: string, right: string): number {
  if (left < right) { return -1; }
  if (left > right) { return 1; }
  return 0;
}
