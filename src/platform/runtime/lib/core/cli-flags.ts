/** Small, dependency-free helpers shared by CLI command parsers. */
export function levenshteinDistance(left: string, right: string): number {
  if (left === right) { return 0; }
  if (!left.length) { return right.length; }
  if (!right.length) { return left.length; }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

/** Suggest the nearest known flag when the edit distance is at most two. */
export function suggestFlag(input: string, flags: Iterable<string>): string | null {
  if (!input) { return null; }
  const normalized = input.toLowerCase();
  let best: { flag: string; distance: number } | null = null;
  for (const flag of flags) {
    const distance = levenshteinDistance(normalized, flag.toLowerCase());
    if (distance > 2 || (best && distance >= best.distance)) { continue; }
    best = { flag, distance };
  }
  return best?.flag || null;
}
