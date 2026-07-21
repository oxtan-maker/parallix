import * as fs from 'node:fs';
import * as path from 'node:path';

const forbidden = ['@oclif', 'ink', 'react', 'http', 'sqlite', 'node:fs', '../core/git', '../tools/forgejo', 'node:child_process', 'process.exit', '../core/fmt'];

function importsFrom(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)].map(match => match[1]);
}

function resolveLocal(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) {return null;}
  const base = path.resolve(path.dirname(file), specifier.replace(/\.js$/, ''));
  return ['.ts', '.js', '/index.ts'].map(suffix => `${base}${suffix}`).find(fs.existsSync) ?? null;
}

export function findForbiddenApplicationDependencies(entryFiles: readonly string[]): string[] {
  const visited = new Set<string>();
  const violations: string[] = [];
  const visit = (file: string) => {
    if (visited.has(file)) {return;}
    visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of importsFrom(source)) {
      if (forbidden.some(item => specifier.includes(item))) {violations.push(`${file}: ${specifier}`);}
      const local = resolveLocal(file, specifier);
      if (local) {visit(local);}
    }
    if (source.includes('process.exit')) {violations.push(`${file}: process.exit`);}
  };
  entryFiles.forEach(visit);
  return violations;
}

export function findCompositionViolations(rootDir: string): string[] {
  const root = path.resolve(rootDir);
  const files = walk(root);
  return files.flatMap(file => {
    const source = fs.readFileSync(file, 'utf8');
    const makesCompleteGraph = /new\s+LegacyActiveAdapter\s*\(/.test(source) && /new\s+LegacyStatsBackfillAdapter\s*\(/.test(source);
    const usesLocator = /(?:serviceLocator|services)\s*\[/.test(source);
    return (makesCompleteGraph && !file.endsWith(path.join('lib', 'composition', 'application-services.ts'))) || usesLocator ? [file] : [];
  });
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory() && !['node_modules', 'dist', '.git'].includes(entry.name)) {return walk(file);}
    return entry.isFile() && /\.(?:ts|js)$/.test(entry.name) ? [file] : [];
  });
}
