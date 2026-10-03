import path from 'node:path';

/** Task identity is regression provenance, never executable test ownership. */
export function taskOwnedTestSources(files: readonly string[]): string[] {
  return files.filter(file => /(?:^|[-_.])task[-_]\d/i.test(path.basename(file))
    && /\.(?:[cm]?[jt]sx?|json)$/i.test(file)).sort();
}

export function taskOwnedSuiteTitles(source: string): string[] {
  return [...source.matchAll(/\bdescribe\(\s*(['"`])([^'"`\n]+)\1/g)]
    .map(match => match[2]).filter(title => /\btask[-_]\d/i.test(title));
}
