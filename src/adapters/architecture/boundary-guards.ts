import * as fs from 'node:fs';
import * as path from 'node:path';

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

function rootsFor(layer: DependencyLayer): readonly string[] {
  return layerRoots[layer];
}

/**
 * The complete permitted dependency graph.
 *
 * `adapters` deliberately has **no** self-edge: a blanket adapters-to-adapters
 * permission lets any adapter reach any other adapter, which is what allowed a
 * relabeled monolith to pass by directory placement alone. Cross-adapter edges
 * are governed by the named package rules in `adapterPackageDependencies`
 * instead; adapters that need behaviour they may not import directly depend on
 * an application-owned port under `src/application/ports/`.
 */
export const allowedDependencyGraph: Readonly<Record<DependencyLayer, readonly DependencyLayer[]>> = {
  domain: ['domain'],
  application: ['domain', 'application'],
  adapters: ['domain', 'application'],
  interfaces: ['domain', 'application', 'interfaces'],
  composition: ['domain', 'application', 'adapters', 'interfaces', 'composition'],
  entry: ['composition', 'interfaces'],
};

/**
 * Named package-level cross-adapter dependency rules.
 *
 * Each key is an adapter package directly beneath `src/adapters/`; the value is
 * the exhaustive set of sibling packages it may import. A package may always
 * import itself. An edge that is absent from this table is a violation — there
 * is no wildcard, no per-file exception, and no path-based bypass.
 */
export const adapterPackageDependencies: Readonly<Record<string, readonly string[]>> = {
  // mechanism: packaged assets, configuration, filesystem, Git, processes, SQLite, and durable storage.
  agents: ['assets', 'config', 'filesystem', 'git', 'process', 'sqlite', 'storage'],
  // mechanism: boundary guard has no sibling mechanism dependency.
  architecture: [],
  // mechanism: packaged-asset discovery reads the host filesystem.
  assets: ['filesystem'],
  // mechanism: configuration, filesystem, Git, and SQLite task storage.
  backlog: ['config', 'filesystem', 'git', 'sqlite'],
  // mechanism: assets, configuration, filesystem, Git, GitHub, and process execution.
  cli: ['assets', 'config', 'filesystem', 'git', 'github', 'process'],
  // mechanism: state-map configuration reads packaged runtime assets; the
  // sandbox state-home catalog resolves Parallix state via durable storage paths.
  config: ['assets', 'storage'],
  // mechanism: mission-path resolution needs configuration and Git repository facts.
  filesystem: ['config', 'git'],
  // mechanism: Forgejo transport resolves task, configuration, filesystem, Git, and verification facts.
  forgejo: ['backlog', 'config', 'filesystem', 'git', 'verification'],
  // mechanism: Git worktree and merge helpers use configuration and filesystem mechanisms.
  git: ['config', 'filesystem'],
  // mechanism: GitHub CLI transport owns no sibling mechanism dependency.
  github: [],
  // mechanism: configuration, filesystem, and SQLite mission persistence.
  mission: ['config', 'filesystem', 'sqlite'],
  // mechanism: post-integrate hook reads product configuration.
  process: ['config'],
  // mechanism: configuration, filesystem, Forgejo, Git, and verification tooling.
  rebase: ['config', 'filesystem', 'forgejo', 'git', 'verification'],
  // mechanism: packaged assets, configuration, filesystem, Forgejo, Git, and verification tooling.
  review: ['assets', 'config', 'filesystem', 'forgejo', 'git', 'verification'],
  // mechanism: durable storage path resolution and process-liveness facts for stale lease reaping.
  sqlite: ['process', 'storage'],
  // mechanism: storage owns no sibling mechanism dependency.
  storage: [],
  // mechanism: packaged browser-asset loading (the package root is passed in by composition).
  web: [],
  // mechanism: backlog, config, filesystem, forgejo, git, storage provide verification facts and durable proofs.
  verification: ['backlog', 'config', 'filesystem', 'forgejo', 'git', 'storage'],
};

/**
 * Behaviour routes are application-owned ports, not adapter mechanism rules.
 * The concrete modules remain temporarily co-located with their legacy command
 * facades; composition binds the named port implementations. Keeping this
 * declaration separate prevents behaviour from widening the mechanism design.
 */
const adapterPortDependencies: Readonly<Record<string, readonly string[]>> = {
  agents: ['backlog'], // `src/application/ports/execute-mission.ts`
  backlog: ['agents', 'review'], // `src/application/ports/cli-workflows.ts`
  cli: ['agents', 'backlog', 'forgejo', 'rebase', 'review', 'sqlite', 'storage', 'verification'], // `cli-workflows.ts`, `handoff-workflow.ts`, `rebase-workflow.ts`, `review-workflow.ts`
  mission: ['agents', 'backlog', 'cli', 'git', 'review'], // `src/application/ports/execute-mission.ts`
  rebase: ['agents', 'backlog', 'cli', 'review'], // `src/application/ports/rebase-workflow.ts`
  review: ['agents', 'backlog', 'cli', 'rebase'], // `review-workflow.ts`, `rebase-workflow.ts` (pre-review rebase runs in-process)
  sqlite: ['backlog'], // `src/application/ports/mission-store.ts`
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

/**
 * Finds the retired platform root even when it contains no TypeScript files.
 * The final production check uses this alongside dependency scanning so a new
 * legacy path cannot be hidden by an empty directory or non-code asset.
 */
export function findPlatformPaths(repoRoot = process.cwd()): string[] {
  const retiredRoot = ['src', 'platform'];
  const platformRoot = path.resolve(repoRoot, ...retiredRoot);
  if (!fs.existsSync(platformRoot)) {return [];}
  const entries = walk(platformRoot).map(file => path.relative(repoRoot, file));
  return entries.length > 0 ? entries : [retiredRoot.join('/')];
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

/**
 * The adapter package a file belongs to, i.e. the first directory beneath
 * `src/adapters/`. Returns `null` for files outside the adapter root and for
 * loose files directly inside it, which own no package.
 */
export function adapterPackageOf(file: string, repoRoot = process.cwd()): string | null {
  const relative = path.relative(path.resolve(repoRoot, 'src', 'adapters'), path.resolve(file));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {return null;}
  const segments = relative.split(path.sep);
  return segments.length > 1 ? segments[0] : null;
}

function crossAdapterEdgeIsNamed(source: string, target: string, repoRoot: string): boolean {
  const sourcePackage = adapterPackageOf(source, repoRoot);
  const targetPackage = adapterPackageOf(target, repoRoot);
  if (sourcePackage === null || targetPackage === null) {return false;}
  if (sourcePackage === targetPackage) {return true;}
  return (adapterPackageDependencies[sourcePackage] ?? []).includes(targetPackage)
    || (adapterPortDependencies[sourcePackage] ?? []).includes(targetPackage);
}

export function findDependencyViolations(repoRoot = process.cwd(), allowlist: readonly LegacyDependencyException[] = []): DependencyViolation[] {
  const root = path.resolve(repoRoot);
  const exceptions = new Set(allowlist.map(entry => `${entry.source}\0${entry.target}`));
  const violations: DependencyViolation[] = [];
  for (const source of dependencyLayers.flatMap(layer => rootsFor(layer).flatMap(layerRoot => walk(path.join(root, layerRoot))))) {
    const sourceLayer = classifyDependencyLayer(source, root);
    if (!sourceLayer) {continue;}
    violations.push(...violationsFromSource(source, sourceLayer, root, exceptions));
  }
  return violations;
}

/** Collect dependency violations for one source file given its classified layer, skipping permitted edges and the owned allowlist. */
function violationsFromSource(source: string, sourceLayer: DependencyLayer, root: string, exceptions: Set<string>): DependencyViolation[] {
  const result: DependencyViolation[] = [];
  for (const specifier of importsFrom(fs.readFileSync(source, 'utf8'))) {
    const target = resolveLocal(source, specifier);
    const targetLayer = target && classifyDependencyLayer(target, root);
    if (!target || !targetLayer) {continue;}
    const permitted = sourceLayer === 'adapters' && targetLayer === 'adapters'
      ? crossAdapterEdgeIsNamed(source, target, root)
      : allowedDependencyGraph[sourceLayer].includes(targetLayer);
    if (permitted) {continue;}
    const sourceName = path.relative(root, source);
    const targetName = path.relative(root, target);
    if (!exceptions.has(`${sourceName}\0${targetName}`)) {
      result.push({ source: sourceName, target: targetName, sourceLayer, targetLayer, specifier });
    }
  }
  return result;
}

/**
 * Owned production exceptions: application→adapter edges with explicit removal owners.
 *
 * Exported so the guard suite can assert every entry stays attributed and live:
 * an unattributed or stale entry is an exception nobody owns, which is how a
 * temporary allowlist becomes permanent architecture.
 */
export const productionDependencyExceptions: readonly LegacyDependencyException[] = [];

/** Production guard: the canonical graph has no exceptions outside the owned allowlist. */
export function findProductionDependencyViolations(repoRoot = process.cwd()): DependencyViolation[] {
  return findDependencyViolations(repoRoot, productionDependencyExceptions);
}

/* ------------------------------------------------------------------ *
 * Responsibility ownership
 * ------------------------------------------------------------------ */

/**
 * A responsibility is a layer. `layerRoots` is the only classification table and
 * `classifyDependencyLayer` the only classifier; the rules below add *what a
 * module does* on top of *where it sits* rather than re-deriving the layer model.
 */
export type Responsibility = DependencyLayer;

/**
 * The rules below are the complete set the guard enforces. Workflow ownership is
 * judged by responsibility, never by how many sibling packages an adapter
 * imports: a count cannot tell a host mechanism that uses three siblings from a
 * module that sequences a workflow, so no count or fan-out threshold exists.
 */
export type ResponsibilityRule =
  | 'unclassified-production-module'
  | 'cross-adapter-dependency-not-named'
  | 'hidden-service-location'
  | 'complete-graph-outside-composition'
  | 'adapter-owned-workflow-control';

export interface ResponsibilityViolation {
  /** Repository-relative path of the offending module. */
  readonly file: string;
  /** The responsibility rule that failed. */
  readonly rule: ResponsibilityRule;
  /** The responsibility that must own this code. */
  readonly expectedOwner: Responsibility;
  /** The responsibility the module currently claims by its location. */
  readonly actualOwner: Responsibility | 'unclassified';
  /** Human-readable statement of what was detected. */
  readonly detail: string;
}

/** Renders a violation as a single actionable diagnostic line. */
export function formatResponsibilityViolation(violation: ResponsibilityViolation): string {
  return `${violation.file}: rule ${violation.rule} failed — ${violation.detail}; expected owner: ${violation.expectedOwner}, actual owner: ${violation.actualOwner}`;
}

/** Renders a whole scan as a multi-line diagnostic, newest rule first. */
export function formatResponsibilityViolations(violations: readonly ResponsibilityViolation[]): string {
  return violations.map(formatResponsibilityViolation).join('\n');
}

function productionModules(repoRoot: string): string[] {
  const src = path.resolve(repoRoot, 'src');
  if (!fs.existsSync(src)) {return [];}
  return walk(src).filter(file => !file.endsWith('.d.ts'));
}

/** The responsibility a module claims by its location, for diagnostics. */
function ownerOf(file: string, repoRoot: string): Responsibility | 'unclassified' {
  return classifyDependencyLayer(file, repoRoot) ?? 'unclassified';
}

/**
 * SC1: every production module under `src/` must be owned by one of the six
 * responsibilities. A module in a new top-level directory, or loose at the `src/`
 * root, is reported with its path and the owners it could have declared.
 */
export function findUnclassifiedProductionModules(repoRoot = process.cwd()): ResponsibilityViolation[] {
  const root = path.resolve(repoRoot);
  const roots = dependencyLayers.flatMap(layer => rootsFor(layer)).join(', ');
  return productionModules(root)
    .filter(file => classifyDependencyLayer(file, root) === null)
    .map(file => ({
      file: path.relative(root, file),
      rule: 'unclassified-production-module' as const,
      expectedOwner: 'application' as const,
      actualOwner: 'unclassified' as const,
      detail: `module is outside every canonical responsibility root (${roots})`,
    }));
}

/**
 * SC2: cross-adapter edges must match a named package rule. Reported per module
 * so the diagnostic names the importing file rather than only the package pair.
 */
export function findCrossAdapterViolations(repoRoot = process.cwd()): ResponsibilityViolation[] {
  const root = path.resolve(repoRoot);
  return findDependencyViolations(root)
    .filter(violation => violation.sourceLayer === 'adapters' && violation.targetLayer === 'adapters')
    .map(violation => ({
      file: violation.source,
      rule: 'cross-adapter-dependency-not-named' as const,
      expectedOwner: 'application' as const,
      actualOwner: 'adapters' as const,
      detail: `imports "${violation.specifier}" (${violation.target}) but package "${adapterPackageOf(path.join(root, violation.source), root)}" declares no named dependency on "${adapterPackageOf(path.join(root, violation.target), root)}"; route it through an application-owned port under src/application/ports/`,
    }));
}

/**
 * Hidden service location and complete-graph construction: only the composition
 * root may assemble the object graph, and no module may resolve collaborators by
 * dynamic key lookup.
 *
 * This is the sole implementation of both rules; `findServiceLocationViolations`
 * and `findCompositionViolations` differ only in the file set they scan and the
 * shape they report.
 */
function compositionOwnershipViolations(files: readonly string[], root: string): ResponsibilityViolation[] {
  return files.flatMap(file => {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(root, file);
    const actualOwner = ownerOf(file, root);
    const found: ResponsibilityViolation[] = [];
    // The execute mechanism set is built by a factory rather than a single
    // adapter constructor; detecting that factory keeps the
    // "only the composition root builds the complete graph" rule enforced.
    const makesCompleteGraph = /createExecuteMissionPorts\s*\(/.test(source) && /new\s+LegacyStatsBackfillAdapter\s*\(/.test(source);
    if (makesCompleteGraph && !file.endsWith(path.join('src', 'composition', 'application-services.ts'))) {
      found.push({
        file: relative,
        rule: 'complete-graph-outside-composition',
        expectedOwner: 'composition',
        actualOwner,
        detail: 'assembles the complete execute-mission object graph outside src/composition/application-services.ts',
      });
    }
    if (/(?:serviceLocator|services)\s*\[/.test(source)) {
      found.push({
        file: relative,
        rule: 'hidden-service-location',
        expectedOwner: 'composition',
        actualOwner,
        detail: 'resolves collaborators by dynamic key lookup instead of receiving them as explicit constructor or function arguments',
      });
    }
    return found;
  });
}

/** The composition-ownership rules applied to the whole production tree. */
export function findServiceLocationViolations(repoRoot = process.cwd()): ResponsibilityViolation[] {
  const root = path.resolve(repoRoot);
  return compositionOwnershipViolations(productionModules(root), root);
}

export type WorkflowControl = 'lifecycle' | 'retry' | 'recovery' | 'phase-gate' | 'agent-launch' | 'review-round';

/**
 * Workflow-control operations, keyed by the adapter module a caller imports them
 * from. Invoking one decides what the product workflow does next, which is an
 * application responsibility once an adapter has an application entry.
 */
export const workflowControlOperations: Readonly<Record<string, Readonly<Record<string, WorkflowControl>>>> = {
  'src/adapters/agents/agents.ts': { startAgent: 'agent-launch' },
  'src/adapters/backlog/backlog.ts': { transitionTask: 'lifecycle' },
  'src/adapters/config/repository-gates.ts': { runPhaseGates: 'phase-gate' },
  'src/adapters/review/review-commands.ts': { submitForReview: 'lifecycle', resumeIntervenedReview: 'recovery' },
  'src/adapters/review/review-gate-handling.ts': { runPreReviewGate: 'phase-gate', reboundPreReviewFailure: 'retry' },
  'src/adapters/review/review-loop.ts': { startReviewLoop: 'review-round' },
  'src/adapters/review/review-state.ts': { reconcileInterruptedHandoff: 'recovery' },
};

/** Blanks comments and string contents, preserving offsets, so braces and calls are code. */
const codeOnly = (source: string): string => source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, token => token.replace(/[^\n]/g, ' '));

/** Import clauses with extensionless local targets, resolved lexically so the scan reads no other file. */
function importClauses(file: string, source: string): { clause: string; target: string | null; typeOnly: boolean }[] {
  return [...source.matchAll(/import\s+(type\s+)?([^'";]*?)\s+from\s+['"]([^'"]+)['"]/g)].map(match => ({ clause: match[2], typeOnly: Boolean(match[1]),
    target: match[3].startsWith('.') ? path.resolve(path.dirname(file), match[3].replace(/\.(?:[cm]?js|tsx?)$/, '')) : null }));
}

/** How a brace block is entered: a branch, a typed application-port binding, or neither. */
function blockKind(code: string, open: number, ports: ReadonlySet<string>): 'branch' | 'port' | 'plain' {
  const before = code.slice(Math.max(0, open - 300), open);
  const port = /(?::\s*(?:Promise<)?|satisfies\s+)([A-Za-z_$][\w$]*)(?:<[^>]*>)?>?\s*=?\s*$/.exec(before);
  if (port && ports.has(port[1])) {return 'port';}
  if (!/(?:\belse|\))\s*$/.test(before)) {return 'plain';}
  if (/\belse\s*$/.test(before)) {return 'branch';}
  let depth = 0;
  for (let index = code.lastIndexOf(')', open); index >= 0; index -= 1) {
    depth += code[index] === ')' ? 1 : code[index] === '(' ? -1 : 0;
    if (depth === 0) {return /\b(?:if|for|while|switch|catch)\s*$/.test(code.slice(Math.max(0, index - 10), index)) ? 'branch' : 'plain';}
  }
  return 'plain';
}

/** Whether a control call at `at` is selected by a branch rather than bound into a typed port. */
function branchSelected(code: string, at: number, ports: ReadonlySet<string>): boolean {
  const statement = code.slice(Math.max(code.lastIndexOf(';', at), code.lastIndexOf('{', at), code.lastIndexOf('}', at)) + 1, at);
  const inlineBranch = /\b(?:if|else|while|for)\b|&&|\?/.test(statement.replace(/\?\?|\?\./g, ''));
  const enclosing: number[] = [];
  for (let index = 0; index < at; index += 1) { if (code[index] === '{') {enclosing.push(index);} else if (code[index] === '}') {enclosing.pop();} }
  const kinds = enclosing.map(open => blockKind(code, open, ports));
  return !kinds.includes('port') && (inlineBranch || kinds.includes('branch'));
}

/**
 * Workflow ownership: an adapter with an application entry (a value import from
 * `src/application/` other than ports and presentation) may bind typed ports and
 * delegate. Inside a typed port binding it may invoke any control operation —
 * the application decides when — but elsewhere it may invoke a control operation
 * only unconditionally. Choosing one under a branch selects the follow-on
 * workflow action, which belongs to the application entry.
 */
export function findWorkflowOwnershipViolations(repoRoot = process.cwd()): ResponsibilityViolation[] {
  const root = path.resolve(repoRoot);
  const application = path.join(root, 'src', 'application');
  const inside = (target: string | null, dir: string) => Boolean(target?.startsWith(`${dir}${path.sep}`));
  const controlNames = Object.values(workflowControlOperations).flatMap(Object.keys);
  return walk(path.join(root, 'src', 'adapters')).flatMap(file => {
    const source = fs.readFileSync(file, 'utf8');
    const clauses = source.includes('/application/') && controlNames.some(name => source.includes(name)) ? importClauses(file, source) : [];
    const hasEntry = clauses.some(({ target, typeOnly }) => !typeOnly && inside(target, application) && !inside(target, path.join(application, 'ports')) && !inside(target, path.join(application, 'presentation')));
    if (!hasEntry) {return [];}
    const ports = new Set(clauses.filter(({ target }) => inside(target, path.join(application, 'ports')))
      .flatMap(({ clause }) => [...clause.matchAll(/(?:\bas\s+)?([A-Za-z_$][\w$]*)\s*(?=,|}|$)/g)].map(match => match[1])));
    let code: string | undefined;
    return clauses.flatMap(({ clause, target, typeOnly }) => {
      const operations = !typeOnly && target ? workflowControlOperations[`${path.relative(root, target).split(path.sep).join('/')}.ts`] : undefined;
      if (!operations) {return [];}
      const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause)?.[1];
      return Object.entries(operations).flatMap(([name, control]) => {
        const local = namespace || !clause.includes(name) ? null : new RegExp(`(?:^|[{,\\s])${name}(?:\\s+as\\s+([A-Za-z_$][\\w$]*))?\\s*(?=,|}|$)`).exec(clause);
        const callee = namespace ? `${namespace}\\s*\\.\\s*${name}` : local ? (local[1] ?? name) : null;
        if (!callee) {return [];}
        const masked = (code ??= codeOnly(source));
        return [...masked.matchAll(new RegExp(`(?<![\\w$.])${callee}\\s*\\)?\\s*\\(`, 'g'))]
          .filter(call => branchSelected(masked, call.index ?? 0, ports))
          .map(call => ({ file: path.relative(root, file), rule: 'adapter-owned-workflow-control' as const, expectedOwner: 'application' as const, actualOwner: 'adapters' as const,
            detail: `line ${masked.slice(0, call.index).split('\n').length} selects ${control} operation "${name}" under a branch outside a typed port binding; move that follow-on decision into the application entry` }));
      });
    });
  });
}

/** The complete responsibility-ownership scan, in rule order. */
export function findResponsibilityViolations(repoRoot = process.cwd()): ResponsibilityViolation[] {
  return [
    ...findUnclassifiedProductionModules(repoRoot),
    ...findCrossAdapterViolations(repoRoot),
    ...findServiceLocationViolations(repoRoot),
    ...findWorkflowOwnershipViolations(repoRoot),
  ];
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

/**
 * The same composition-ownership rules scoped to one directory, reported as
 * absolute paths for the existing application-boundary assertions.
 */
export function findCompositionViolations(rootDir: string): string[] {
  const root = path.resolve(rootDir);
  const offending = compositionOwnershipViolations(walk(root), root).map(violation => violation.file);
  return [...new Set(offending)].map(relative => path.join(root, relative));
}
