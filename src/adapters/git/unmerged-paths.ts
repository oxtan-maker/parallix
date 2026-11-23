/**
 * Paths from `git ls-files -u`. NUL-delimited (`-z`) output carries raw paths; without `-z` Git
 * C-quotes unusual names, so only NUL output round-trips a path with a tab or newline.
 */
export function parseUnmergedFiles(output: string = ''): string[] {
  const nulDelimited = output.includes('\0');
  return Array.from(new Set(
    output
      .split(nulDelimited ? '\0' : '\n')
      .map(line => nulDelimited ? line : line.trim())
      .filter(line => line.includes('\t'))
      .map(line => line.slice(line.indexOf('\t') + 1))
      .filter(Boolean)
  ));
}
