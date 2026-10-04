/**
 * test-layout-validation.ts — fail-closed test layout and registration check (TASK-2638).
 *
 * Paths declare a suite's level; test/lib/test-categories.ts declares where a
 * boundary suite may run; test/lib/shared-unit-files.json and
 * test/lib/test-cpu-budgets.json carry per-suite execution policy. This module
 * checks that the three agree with the tree, so a misplaced, unregistered, or
 * renamed suite fails loudly instead of vanishing from a lane or silently
 * inheriting one. `validateTestLayout` is pure; `assertValidTestLayout` gathers
 * its input from a checkout and is called by test/run-default-tests.ts before
 * every plan and by `./scripts/verify-local.sh static-analysis`.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  AGENT_E2E_TESTS, INTEGRATION_CI_TESTS, INTEGRATION_LOCAL_REASONS, INTEGRATION_LOCAL_TESTS,
} from './test-categories.js';
import { LEVEL_ROOTS, RUNNABLE_SUITE, levelOf } from './test-tier-selection.js';

/** Anything a test runner would plausibly treat as a suite. */
const TEST_LIKE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
/** Non-runnable support files a suite may keep beside it inside a level root. */
const SUPPORT_FILE = /\.(?:cases|fixture)\.ts$/;
/** test/ root entries that are runner infrastructure, not suites. */
const TEST_ROOT_FILES = /^(?:bootstrap-[a-z0-9-]+|run-[a-z0-9-]+)\.ts$/;
const TEST_SUPPORT_DIRECTORIES = ['lib', 'helpers', 'fixtures'];
/** Repository-wide checks with no single code owner (`test/unit/repository/`). */
const REPOSITORY_OWNER = 'repository';

/**
 * Intentional fixture test programs: test-named files that are inputs of a
 * tool, never repository suites. Each entry is a directory prefix plus why.
 */
export const FIXTURE_TEST_PROGRAMS: ReadonlyArray<{ readonly prefix: string; readonly reason: string }> = [
  {
    prefix: 'tools/coverage-comparison/bundle-attribution-probe/test/',
    reason: 'ADR 0062 bundle attribution probe; run.sh executes it against its own src/ copy',
  },
];

/** Directories never scanned: dependencies, VCS data, and generated output. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'build', 'coverage', 'tmp', 'graphify-out', 'dist']);

/** Calls that cross a process, socket, or network boundary (bare `fetch` only). */
const BOUNDARY_WORD = /\b(?:spawn|spawnSync|execSync|execFile|execFileSync|fork|createServer|fetch)\b/;
const BOUNDARY_CALL = /(?<!\bfunction\s+)(?:(?<![\w$.])(fetch)|\b(spawn|spawnSync|execSync|execFile|execFileSync|fork|createServer))\s*\(/g;

export interface LayoutRegistry {
  readonly ci: readonly string[];
  readonly local: readonly string[];
  readonly localReasons: Readonly<Record<string, string>>;
  readonly agentE2e: readonly string[];
}

export interface LayoutInput {
  /** Every repository file, as POSIX repository-relative paths. */
  readonly repoFiles: readonly string[];
  readonly registry: LayoutRegistry;
  /** Unit suites allowed to share one process (test-root-relative). */
  readonly sharedUnitFiles: readonly string[];
  /** Suites with an integration-case CPU budget (test-root-relative). */
  readonly cpuBudgetFiles: readonly string[];
  /** Source of a repository file, read lazily for the unit boundary screen. */
  readonly readSource: (repoFile: string) => string;
}

function directoriesOf(files: readonly string[]): Set<string> {
  const directories = new Set<string>();
  for (const file of files) {
    for (let dir = path.posix.dirname(file); dir !== '.'; dir = path.posix.dirname(dir)) { directories.add(dir); }
  }
  return directories;
}

/**
 * Blank out comments and string or template text, keeping `${}` expressions,
 * so only executable code remains. A lexical pass, not a parser: it screens
 * what a suite visibly calls and proves nothing about what its imports do.
 */
export function executableCode(source: string): string {
  let out = '';
  const templates: number[] = [];
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') { i++; }
      out += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) { out += source[i] === '\n' ? '\n' : ' '; i++; }
      i++;
    } else if (char === '\'' || char === '"') {
      i++;
      while (i < source.length && source[i] !== char && source[i] !== '\n') { if (source[i] === '\\') { i++; } i++; }
      out += '""';
    } else if (char === '`' || (char === '}' && templates.at(-1) === depth)) {
      if (char === '}') { templates.pop(); }
      i++;
      while (i < source.length && source[i] !== '`' && !(source[i] === '$' && source[i + 1] === '{')) { if (source[i] === '\\') { i++; } i++; }
      if (source[i] === '$') { templates.push(depth); i++; out += '`${'; } else { out += '``'; }
    } else {
      if (char === '{') { depth++; } else if (char === '}') { depth--; }
      out += char;
    }
  }
  return out;
}

/**
 * Boundary calls in executable code. Comments and string contents never count,
 * so a suite that merely mentions `spawn` or `git` keeps its level; a unit
 * suite that actually calls one must move to test/integration.
 */
export function boundaryCallsIn(source: string): string[] {
  if (!BOUNDARY_WORD.test(source)) { return []; }
  const calls = [...executableCode(source).matchAll(BOUNDARY_CALL)].map(match => match[1] ?? match[2]);
  return [...new Set(calls)];
}

function validatePlacement(input: LayoutInput, errors: string[]): void {
  const directories = directoriesOf(input.repoFiles);
  for (const file of input.repoFiles) {
    const name = path.posix.basename(file);
    if (!file.startsWith('test/')) {
      if (TEST_LIKE.test(name) && !FIXTURE_TEST_PROGRAMS.some(program => file.startsWith(program.prefix))) {
        errors.push(`${file}: test source outside test/{${LEVEL_ROOTS.join(',')}}/; move it below a level root`);
      }
      continue;
    }
    const relative = file.slice('test/'.length);
    const [top, ...rest] = relative.split('/');
    if (rest.length === 0) {
      if (!TEST_ROOT_FILES.test(top)) { errors.push(`${file}: unexpected file in test/; suites belong below a level root, support code in test/lib, test/helpers, or test/fixtures`); }
      continue;
    }
    if (TEST_SUPPORT_DIRECTORIES.includes(top)) {
      if (TEST_LIKE.test(name)) { errors.push(`${file}: runnable test source inside support directory test/${top}/`); }
      continue;
    }
    if (!(LEVEL_ROOTS as readonly string[]).includes(top)) {
      errors.push(`${file}: test/${top}/ is not an approved level root (${LEVEL_ROOTS.join(', ')})`);
      continue;
    }
    if (!RUNNABLE_SUITE.test(name)) {
      if (!SUPPORT_FILE.test(name)) { errors.push(`${file}: level roots hold *.test.ts suites and *.cases.ts/*.fixture.ts support only`); }
      continue;
    }
    if (top === 'unit') { validateUnitMirror(file, rest.slice(0, -1), directories, errors); }
  }
}

function validateUnitMirror(file: string, ownerSegments: string[], directories: Set<string>, errors: string[]): void {
  const owner = ownerSegments.join('/');
  if (ownerSegments[0] === 'src') {
    errors.push(`${file}: drop the extra src/ level; test/unit/<dir> mirrors src/<dir>`);
  } else if (['scripts', 'test', 'web', REPOSITORY_OWNER].includes(ownerSegments[0])) {
    if (directories.has(`src/${ownerSegments[0]}`)) {
      errors.push(`${file}: owner root ${ownerSegments[0]} collides with src/${ownerSegments[0]}/; resolve ownership explicitly`);
    } else if (ownerSegments[0] === 'test' && ownerSegments[1] !== 'lib') {
      errors.push(`${file}: test-owned unit suites mirror test/lib/, never runnable suite directories`);
    } else if (owner !== REPOSITORY_OWNER && !directories.has(owner)) {
      errors.push(`${file}: test/unit/${owner} mirrors no repository directory ${owner}/`);
    }
  } else if (owner !== '' && !directories.has(`src/${owner}`)) {
    errors.push(`${file}: test/unit/${owner} mirrors no source directory src/${owner}/`);
  }
}

function validateRegistrations(input: LayoutInput, suites: readonly string[], errors: string[]): void {
  const known = new Set(suites);
  const lanes: Array<[string, readonly string[]]> = [
    ['INTEGRATION_CI_TESTS', input.registry.ci],
    ['INTEGRATION_LOCAL_TESTS', input.registry.local],
    ['AGENT_E2E_TESTS', input.registry.agentE2e],
  ];
  const owners = new Map<string, string>();
  for (const [lane, entries] of lanes) {
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry)) { errors.push(`${lane}: duplicate entry ${entry}`); }
      seen.add(entry);
      if (path.posix.normalize(entry) !== entry || entry.startsWith('/') || entry.includes('\\')) {
        errors.push(`${lane}: ${entry} is not a normalized test-root-relative path`);
      } else if (!known.has(entry)) {
        errors.push(`${lane}: ${entry} matches no discovered suite`);
      } else if (levelOf(entry) === 'unit') {
        errors.push(`${lane}: ${entry} is a unit suite; unit membership comes from its test/unit/ path`);
      } else if (lane === 'AGENT_E2E_TESTS' && levelOf(entry) !== 'e2e') {
        errors.push(`${lane}: ${entry} must live below test/e2e/`);
      }
      const previous = owners.get(entry);
      if (previous && previous !== lane) { errors.push(`${entry}: registered in both ${previous} and ${lane}`); }
      owners.set(entry, lane);
    }
  }
  for (const suite of suites) {
    if (levelOf(suite) !== 'unit' && !owners.has(suite)) {
      errors.push(`${suite}: unclassified ${levelOf(suite)} suite; register it in INTEGRATION_CI_TESTS, INTEGRATION_LOCAL_TESTS (with a reason), or AGENT_E2E_TESTS`);
    }
  }
  for (const entry of input.registry.local) {
    if (!input.registry.localReasons[entry]?.trim()) { errors.push(`INTEGRATION_LOCAL_REASONS: ${entry} records no missing GitHub-runner dependency`); }
  }
  for (const entry of Object.keys(input.registry.localReasons)) {
    if (!input.registry.local.includes(entry)) { errors.push(`INTEGRATION_LOCAL_REASONS: ${entry} is not an INTEGRATION_LOCAL_TESTS entry`); }
  }
  const populations: Array<[string, (suite: string) => boolean]> = [
    ['unit', suite => levelOf(suite) === 'unit'],
    ['integration-ci', suite => input.registry.ci.includes(suite)],
    ['integration-local', suite => input.registry.local.includes(suite)],
    ['agent-e2e', suite => input.registry.agentE2e.includes(suite)],
  ];
  for (const [lane, member] of populations) {
    if (!suites.some(member)) { errors.push(`${lane}: required population is empty`); }
  }
}

function validatePolicies(input: LayoutInput, suites: readonly string[], errors: string[]): void {
  const shared = new Set<string>();
  for (const entry of input.sharedUnitFiles) {
    if (shared.has(entry)) { errors.push(`shared-unit-files.json: duplicate entry ${entry}`); }
    shared.add(entry);
    if (!suites.includes(entry) || levelOf(entry) !== 'unit') { errors.push(`shared-unit-files.json: ${entry} is not a discovered unit suite`); }
  }
  const integration = new Set([...input.registry.ci, ...input.registry.local]);
  for (const entry of new Set(input.cpuBudgetFiles)) {
    if (!integration.has(entry)) { errors.push(`test-cpu-budgets.json: ${entry} is not a registered integration suite`); }
  }
}

/** Every layout, registration, and policy violation, in a stable order. */
export function validateTestLayout(input: LayoutInput): string[] {
  const errors: string[] = [];
  validatePlacement(input, errors);
  const suites = input.repoFiles
    .filter(file => file.startsWith('test/') && RUNNABLE_SUITE.test(file))
    .map(file => file.slice('test/'.length))
    .filter(suite => levelOf(suite) !== null && suite.split('/').length > 1)
    .sort();
  validateRegistrations(input, suites, errors);
  validatePolicies(input, suites, errors);
  for (const suite of suites.filter(file => levelOf(file) === 'unit')) {
    const calls = boundaryCallsIn(input.readSource(`test/${suite}`));
    if (calls.length > 0) {
      errors.push(`test/${suite}: unit suite calls ${calls.join(', ')}(); real process, socket, or network boundaries belong in test/integration/`);
    }
  }
  return errors;
}

/** List repository files without spawning Git, skipping generated and dot directories. */
export function listRepositoryFiles(root: string): string[] {
  const files: string[] = [];
  function walk(relativeDir: string): void {
    for (const entry of fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) { continue; }
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) { walk(relative); }
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }
  walk('');
  return files.sort();
}

/** Gather the checkout's layout input from its registries and tree. */
export function collectLayoutInput(root: string): LayoutInput {
  const shared = JSON.parse(fs.readFileSync(path.join(root, 'test/lib/shared-unit-files.json'), 'utf8')) as { files: string[] };
  const budgets = JSON.parse(fs.readFileSync(path.join(root, 'test/lib/test-cpu-budgets.json'), 'utf8')) as {
    integrationCases: Record<string, Record<string, number> | number>;
  };
  const cpuBudgetFiles = Object.values(budgets.integrationCases)
    .flatMap(profile => typeof profile === 'object' ? Object.keys(profile) : []);
  return {
    repoFiles: listRepositoryFiles(root),
    registry: {
      ci: INTEGRATION_CI_TESTS,
      local: INTEGRATION_LOCAL_TESTS,
      localReasons: INTEGRATION_LOCAL_REASONS,
      agentE2e: AGENT_E2E_TESTS,
    },
    sharedUnitFiles: shared.files,
    cpuBudgetFiles,
    readSource: file => fs.readFileSync(path.join(root, file), 'utf8'),
  };
}

export function assertValidTestLayout(root: string): void {
  const errors = validateTestLayout(collectLayoutInput(root));
  if (errors.length > 0) {
    throw new Error(`test layout validation failed (${errors.length}):\n  ${errors.join('\n  ')}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const root = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..', '..'));
  try {
    assertValidTestLayout(root);
    console.log('PASS: test layout and registrations are consistent');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
