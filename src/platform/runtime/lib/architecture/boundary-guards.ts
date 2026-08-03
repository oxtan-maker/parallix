import * as fs from 'node:fs';
import * as path from 'node:path';
import { legacyDependencyAllowlist } from './dependency-graph-allowlist.js';

export const dependencyLayers = ['domain', 'application', 'adapters', 'interfaces', 'composition', 'entry'] as const;
export type DependencyLayer = typeof dependencyLayers[number];

/** The six ADR 0051 canonical layer roots, relative to the repository root. */
export const layerRoots: Readonly<Record<DependencyLayer, readonly string[]>> = {
  domain: ['src/domain'],
  application: ['src/application'],
  adapters: ['src/adapters'],
  interfaces: ['src/interfaces'],
  composition: ['src/composition'],
  entry: ['src/entry'],
};

/** Migration-only roots that remain classified and scanned until their owning cleanup mission moves them. */
export const legacyLayerRoots: Readonly<Partial<Record<DependencyLayer, readonly string[]>>> = {
  composition: ['src/platform/runtime', 'src/platform/assets'],
};

function rootsFor(layer: DependencyLayer): readonly string[] {
  return [...layerRoots[layer], ...(legacyLayerRoots[layer] ?? [])];
}

/** The complete permitted dependency graph. Local edges are intentionally explicit. */
export const allowedDependencyGraph: Readonly<Record<DependencyLayer, readonly DependencyLayer[]>> = {
  domain: ['domain'],
  application: ['domain', 'application'],
  adapters: ['domain', 'application', 'adapters'],
  interfaces: ['domain', 'application', 'interfaces'],
  composition: ['domain', 'application', 'adapters', 'interfaces', 'composition'],
  entry: ['composition', 'interfaces'],
};

export interface DependencyViolation {
  readonly source: string;
  readonly target: string;
  readonly sourceLayer: DependencyLayer;
  readonly targetLayer: DependencyLayer;
  readonly specifier: string;
}

export interface LegacyDependencyException {
  readonly source: string;
  readonly target: string;
  readonly ownerTaskId: string;
  readonly removalMission: string;
}

function importsFrom(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);
}

function resolveLocal(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) {return null;}
  const base = path.resolve(path.dirname(file), specifier.replace(/\.(?:[cm]?js|tsx?)$/, ''));
  return ['.ts', '.tsx', '.js', '/index.ts', '/index.tsx', '/index.js']
    .map(suffix => `${base}${suffix}`)
    .find(fs.existsSync) ?? null;
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) {return [];}
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory() && !['node_modules', 'dist', '.git'].includes(entry.name)) {return walk(file);}
    return entry.isFile() && /\.(?:ts|tsx|js)$/.test(entry.name) ? [file] : [];
  });
}

export function classifyDependencyLayer(file: string, repoRoot = process.cwd()): DependencyLayer | null {
  const absoluteFile = path.resolve(file);
  const candidates = dependencyLayers
    .flatMap(layer => rootsFor(layer).map(root => [layer, path.resolve(repoRoot, root)] as const))
    .filter(([, root]) => absoluteFile === root || absoluteFile.startsWith(`${root}${path.sep}`))
    .sort((a, b) => b[1].length - a[1].length);
  return candidates[0]?.[0] ?? null;
}

export function findDependencyViolations(repoRoot = process.cwd(), allowlist: readonly LegacyDependencyException[] = []): DependencyViolation[] {
  const root = path.resolve(repoRoot);
  const exceptions = new Set(allowlist.map(entry => `${entry.source}\0${entry.target}`));
  const violations: DependencyViolation[] = [];
  for (const source of dependencyLayers.flatMap(layer => rootsFor(layer).flatMap(layerRoot => walk(path.join(root, layerRoot))))) {
    const sourceLayer = classifyDependencyLayer(source, root);
    if (!sourceLayer) {continue;}
    for (const specifier of importsFrom(fs.readFileSync(source, 'utf8'))) {
      const target = resolveLocal(source, specifier);
      const targetLayer = target && classifyDependencyLayer(target, root);
      if (!target || !targetLayer || allowedDependencyGraph[sourceLayer].includes(targetLayer)) {continue;}
      const sourceName = path.relative(root, source);
      const targetName = path.relative(root, target);
      if (!exceptions.has(`${sourceName}\0${targetName}`)) {
        violations.push({ source: sourceName, target: targetName, sourceLayer, targetLayer, specifier });
      }
    }
  }
  return violations;
}

/** Production guard: only the explicitly owned legacy migration edges are exempt. */
export function findProductionDependencyViolations(repoRoot = process.cwd()): DependencyViolation[] {
  return findDependencyViolations(repoRoot, legacyDependencyAllowlist);
}

/** Compatibility wrapper retained for the existing application-boundary assertions. */
export function findForbiddenApplicationDependencies(entryFiles: readonly string[], scopeDir?: string): string[] {
  const scope = scopeDir ? path.resolve(scopeDir) : null;
  const visited = new Set<string>();
  const violations: string[] = [];
  const visit = (file: string) => {
    if (visited.has(file)) {return;}
    visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of importsFrom(source)) {
      const target = resolveLocal(file, specifier);
      if (target && (!scope || target.startsWith(`${scope}${path.sep}`))) {visit(target);}
      if (!target && ['@oclif', 'ink', 'react', 'http', 'node:sqlite', 'sqlite3', 'node:fs', '../core/git', '../tools/forgejo', 'node:child_process', '../core/fmt'].some(item => specifier.includes(item))) {
        violations.push(`${file}: ${specifier}`);
      }
    }
    if (source.includes('process.exit')) {violations.push(`${file}: process.exit`);}
  };
  entryFiles.forEach(visit);
  return violations;
}

export function findCompositionViolations(rootDir: string): string[] {
  return walk(path.resolve(rootDir)).flatMap(file => {
    const source = fs.readFileSync(file, 'utf8');
    const makesCompleteGraph = /new\s+LegacyActiveAdapter\s*\(/.test(source) && /new\s+LegacyStatsBackfillAdapter\s*\(/.test(source);
    const usesLocator = /(?:serviceLocator|services)\s*\[/.test(source);
    return (makesCompleteGraph && !file.endsWith(path.join('lib', 'composition', 'application-services.ts'))) || usesLocator ? [file] : [];
  });
}
