import * as path from 'node:path';
import type { GoalCheckRow } from '../domain/checkpoint.js';

/**
 * File-system shape the evidence helpers consume. Kept free of node:fs so this
 * module stays in the application layer (the boundary forbids node:fs here);
 * callers inject an fs-backed port instead.
 */
export interface EvidenceFileSystemPort {
  existsSync(_target: string): boolean;
  readText(_target: string): string;
  listEntries(_target: string): EvidenceDirent[];
  listNames(_target: string): string[];
}

/**
 * Minimal Dirent surface (name/isDirectory/isFile) without importing node:fs,
 * which the application layer forbids.
 */
export interface EvidenceDirent {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

function fsExistsSync(fileSystem: EvidenceFileSystemPort, target: string) {
  return fileSystem.existsSync(target);
}

function fsReadText(fileSystem: EvidenceFileSystemPort, target: string) {
  return fileSystem.readText(target);
}

function fsListEntries(fileSystem: EvidenceFileSystemPort, target: string) {
  return fileSystem.listEntries(target);
}

function fsListNames(fileSystem: EvidenceFileSystemPort, target: string) {
  return fileSystem.listNames(target);
}

export function collectGoalCheckEvidenceRows(afterHeader: string): string[] {
  const separatorPattern = /^\|(?:\s*:?-+:?\s*\|)+$/;
  const headerPattern = /^\| .+\| .+\| .+\|$/;
  const evidenceLinePattern = /^\| .+\| .+\| .+\|$/;
  const evidenceRows: string[] = [];
  let pastHeader = false;
  for (const line of afterHeader.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') { continue; }
    if (!pastHeader && headerPattern.test(trimmed)) { pastHeader = true; continue; }
    if (separatorPattern.test(trimmed)) { continue; }
    if (pastHeader && evidenceLinePattern.test(trimmed)) { evidenceRows.push(trimmed); continue; }
    break;
  }
  return evidenceRows;
}

export function collectRepoTestNames(fileSystem: EvidenceFileSystemPort, rootDir: string): Set<string> {
  const names = new Set<string>();
  const testRoot = path.join(rootDir, 'test');
  if (!fsExistsSync(fileSystem, testRoot)) { return names; }
  const queue: string[] = [testRoot];
  while (queue.length > 0) {
    const current = queue.pop()!;
    let entries: EvidenceDirent[] = [];
    try { entries = fsListEntries(fileSystem, current) as EvidenceDirent[]; } catch { continue; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) { queue.push(fullPath); continue; }
      // Case modules (`*.cases.ts`) own test cases that a suite file imports.
      if (!entry.isFile() || !/\.(?:test|spec|cases)\.[cm]?[jt]sx?$/i.test(entry.name)) { continue; }
      const testNamePattern = /\b(?:test|it)(?:\.\w+)?\s*\(\s*(['"`])([^'"`]+)\1/g;
      let match: RegExpExecArray | null;
      while ((match = testNamePattern.exec(fsReadText(fileSystem, fullPath) as string)) !== null) { names.add(match[2]); }
    }
  }
  return names;
}

export function canonicalSourceContainsFile(fileSystem: EvidenceFileSystemPort, rootDir: string, basename: string): boolean {
  const sourceRoot = path.join(rootDir, 'src');
  if (!fsExistsSync(fileSystem, sourceRoot)) { return false; }
  const queue = [sourceRoot];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const entry of fsListEntries(fileSystem, current)) {
      if (entry.isDirectory()) { queue.push(path.join(current, entry.name)); }
      else if (entry.isFile() && entry.name === basename) { return true; }
    }
  }
  return false;
}

export function evidenceCellHasVerifiableReference(fileSystem: EvidenceFileSystemPort, cell: string, rootDir: string, knownTestNames: Set<string>): boolean {
  const normalized = cell.replace(/\[[^\]]+\]\(([^)]+)\)/g, '$1');
  return hasFileLineReference(fileSystem, normalized, rootDir)
    || hasBarePathReference(fileSystem, normalized, rootDir)
    || hasAdrReference(fileSystem, normalized, rootDir)
    || hasQuotedTestReference(normalized, knownTestNames)
    || hasCommandReference(fileSystem, cell, rootDir);
}

/**
 * True when a candidate path walks above the repository root. A `..` segment
 * that drops below the root escapes even if later segments re-enter the
 * repository, so both the escape and the re-entrant escape are rejected.
 */
function pathEscapesRoot(candidatePath: string): boolean {
  let depth = 0;
  for (const segment of candidatePath.split(/[\\/]/)) {
    if (segment === '..') { depth -= 1; if (depth < 0) { return true; } }
    else if (segment !== '.' && segment !== '') { depth += 1; }
  }
  return false;
}

/**
 * The repository file a cited path names, or null when it is absolute or
 * escapes the repository: evidence must be reproducible from the checkout.
 */
function repositoryPath(rootDir: string, candidatePath: string): string | null {
  if (path.isAbsolute(candidatePath) || pathEscapesRoot(candidatePath)) { return null; }
  return path.resolve(rootDir, candidatePath);
}

function existsInRepository(fileSystem: EvidenceFileSystemPort, rootDir: string, candidatePath: string): boolean {
  const resolved = repositoryPath(rootDir, candidatePath);
  return resolved !== null && fsExistsSync(fileSystem, resolved);
}

function hasFileLineReference(fileSystem: EvidenceFileSystemPort, normalized: string, rootDir: string): boolean {
  const fileLinePattern = /(?:^|[\s(`])((?:\/|\.\/)?[\w./-]+\.[\w-]+):(\d+)(?:-\d+)?/g;
  let fileLineMatch: RegExpExecArray | null;
  while ((fileLineMatch = fileLinePattern.exec(normalized)) !== null) {
    const candidatePath = fileLineMatch[1];
    // The legacy lib/ alias maps a compiled path to its src/ basename, but it
    // must still stay inside the checkout: apply the root-escape predicate
    // before the fallback so lib/../../static-evidence.ts:1 cannot resolve.
    const canonicalSourceExists = !path.isAbsolute(candidatePath) && !pathEscapesRoot(candidatePath)
      && candidatePath.startsWith('lib/')
      ? canonicalSourceContainsFile(fileSystem, rootDir, path.basename(candidatePath)) : false;
    if (existsInRepository(fileSystem, rootDir, candidatePath) || canonicalSourceExists) { return true; }
  }
  return false;
}

function hasBarePathReference(fileSystem: EvidenceFileSystemPort, normalized: string, rootDir: string): boolean {
  const barePathPattern = /(?:^|[\s(`])((?:\/|\.\/)?[\w ./-]+\.[\w-]+)/g;
  let barePathMatch: RegExpExecArray | null;
  while ((barePathMatch = barePathPattern.exec(normalized)) !== null) {
    const words = barePathMatch[1].trim().split(' ');
    for (let start = 0; start < words.length; start += 1) {
      const candidatePath = words.slice(start).join(' ');
      if (existsInRepository(fileSystem, rootDir, candidatePath)) { return true; }
    }
  }
  return false;
}

function hasAdrReference(fileSystem: EvidenceFileSystemPort, normalized: string, rootDir: string): boolean {
  const adrPattern = /\bADR\s+(\d{4})\b/g;
  let adrMatch: RegExpExecArray | null;
  while ((adrMatch = adrPattern.exec(normalized)) !== null) {
    const adrDir = path.join(rootDir, 'docs', 'adr');
    if (fsExistsSync(fileSystem, adrDir) && fsListNames(fileSystem, adrDir).some(name => name.startsWith(`${adrMatch![1]}-`) && name.endsWith('.md'))) { return true; }
  }
  return false;
}

function hasQuotedTestReference(normalized: string, knownTestNames: Set<string>): boolean {
  const quotedPattern = /(['"`])([^'"`]+)\1/g;
  let quotedMatch: RegExpExecArray | null;
  while ((quotedMatch = quotedPattern.exec(normalized)) !== null) { if (knownTestNames.has(quotedMatch[2])) { return true; } }
  return false;
}

function hasCommandReference(fileSystem: EvidenceFileSystemPort, cell: string, rootDir: string): boolean {
  const inlineCommandPattern = /`([^`]+)`/g;
  let commandMatch: RegExpExecArray | null;
  while ((commandMatch = inlineCommandPattern.exec(cell.replace(/``/g, '  '))) !== null) {
    if (isVerifiableCommand(fileSystem, commandMatch[1].trim(), rootDir)) { return true; }
  }
  return false;
}

function isVerifiableCommand(fileSystem: EvidenceFileSystemPort, command: string, rootDir: string): boolean {
  if (/^(npm|npx|node|git|px)\s+/i.test(command)) { return true; }
  if (command.startsWith('./')) { return commandReferencesFile(fileSystem, command.split(/\s+/)[0], rootDir); }
  return /^(bash|sh|cat|head|tail|diff|grep|sed|awk|xxd|od|wc|sort|uniq|stat|ls)\s+/i.test(command)
    && command.split(/\s+/).slice(1).some(arg => !arg.startsWith('-') && commandReferencesFile(fileSystem, arg, rootDir));
}

function commandReferencesFile(fileSystem: EvidenceFileSystemPort, value: string, rootDir: string): boolean {
  return existsInRepository(fileSystem, rootDir, value);
}

/** A recorded Goal Check row in the table form handoff reads: either cell may carry the reference. */
export function goalCheckTableRow(row: GoalCheckRow): string {
  return `| ${row.criterion} | ${row.evidence} |`;
}

/**
 * Path-like tokens in a row that do not resolve from the repository root, such
 * as a basename (`web-board-interaction.cases.ts`) cited without its directory.
 */
export function unresolvedPathReferences(fileSystem: EvidenceFileSystemPort, row: string, rootDir: string): string[] {
  const tokens = row.replace(/\[[^\]]+\]\(([^)]+)\)/g, '$1').match(/(?:\.\/)?[\w./-]*[\w-]\.[A-Za-z][\w-]*(?::\d+(?:-\d+)?)?/g) ?? [];
  const unresolved = tokens.map(token => token.replace(/:\d+(?:-\d+)?$/, ''))
    .filter(token => /[\w-]\.(?:[cm]?[jt]sx?|md|json|sh|ya?ml)$/i.test(token))
    .filter(token => !existsInRepository(fileSystem, rootDir, token));
  return [...new Set(unresolved)];
}

/**
 * The actionable diagnostic recording and handoff both report for a Goal Check
 * row that cites no verifiable reference.
 */
export function describeUnverifiableGoalCheckRow(fileSystem: EvidenceFileSystemPort, row: string, rootDir: string): string {
  const unresolved = unresolvedPathReferences(fileSystem, row, rootDir);
  const hint = unresolved.length > 0
    ? ` ${unresolved.map(token => `\`${token}\``).join(', ')} does not exist relative to the repository root; cite the repository-relative path (for example \`test/unit/example.test.ts\`).`
    : '';
  return `Goal Check row cites no verifiable reference: an existing repository-relative path, a quoted exact test name from a test/ .test, .spec or .cases module, a recognized command such as \`npm test\`, or an ADR reference.${hint} Offending row: ${row}`;
}

/** The first recorded row that cites no verifiable reference, with its diagnostic. */
export function findUnverifiableRecordedRow(
  fileSystem: EvidenceFileSystemPort, rows: readonly GoalCheckRow[], rootDir: string,
): { row: string; message: string } | null {
  const row = findUnverifiableGoalCheckRow(fileSystem, rows.map(goalCheckTableRow), rootDir);
  return row === null ? null : { row, message: describeUnverifiableGoalCheckRow(fileSystem, row, rootDir) };
}

export function findUnverifiableGoalCheckRow(fileSystem: EvidenceFileSystemPort, evidenceRows: string[], rootDir: string): string | null {
  let knownTestNames: Set<string> | undefined;
  for (const row of evidenceRows) {
    const columns = row.split('|').slice(1, -1).map(part => part.trim()).filter(Boolean);
    if (columns.some(cell => evidenceCellHasVerifiableReference(fileSystem, cell, rootDir, knownTestNames ?? new Set()))) { continue; }
    const testNames = knownTestNames ??= collectRepoTestNames(fileSystem, rootDir);
    if (!columns.some(cell => evidenceCellHasVerifiableReference(fileSystem, cell, rootDir, testNames))) { return row; }
  }
  return null;
}
