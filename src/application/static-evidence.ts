import * as path from 'node:path';

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
      if (!entry.isFile() || !/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)) { continue; }
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
  const fileLinePattern = /(?:^|[\s(`])((?:\/|\.\/)?[\w./-]+\.[\w-]+):(\d+)(?:-\d+)?/g;
  let fileLineMatch: RegExpExecArray | null;
  while ((fileLineMatch = fileLinePattern.exec(normalized)) !== null) {
    const candidatePath = fileLineMatch[1];
    const resolved = path.isAbsolute(candidatePath) ? candidatePath : path.join(rootDir, candidatePath.replace(/^\.\//, ''));
    const canonicalSourceExists = !path.isAbsolute(candidatePath) && candidatePath.startsWith('lib/')
      ? canonicalSourceContainsFile(fileSystem, rootDir, path.basename(candidatePath)) : false;
    if (fsExistsSync(fileSystem, resolved) || canonicalSourceExists) { return true; }
  }
  const barePathPattern = /(?:^|[\s(`])((?:\/|\.\/)?[\w ./-]+\.[\w-]+)/g;
  let barePathMatch: RegExpExecArray | null;
  while ((barePathMatch = barePathPattern.exec(normalized)) !== null) {
    const words = barePathMatch[1].trim().split(' ');
    for (let start = 0; start < words.length; start += 1) {
      const candidatePath = words.slice(start).join(' ');
      const resolved = path.isAbsolute(candidatePath) ? candidatePath : path.join(rootDir, candidatePath.replace(/^\.\//, ''));
      if (fsExistsSync(fileSystem, resolved)) { return true; }
    }
  }
  const adrPattern = /\bADR\s+(\d{4})\b/g;
  let adrMatch: RegExpExecArray | null;
  while ((adrMatch = adrPattern.exec(normalized)) !== null) {
    const adrDir = path.join(rootDir, 'docs', 'adr');
    if (fsExistsSync(fileSystem, adrDir) && fsListNames(fileSystem, adrDir).some(name => name.startsWith(`${adrMatch![1]}-`) && name.endsWith('.md'))) { return true; }
  }
  const quotedPattern = /(['"`])([^'"`]+)\1/g;
  let quotedMatch: RegExpExecArray | null;
  while ((quotedMatch = quotedPattern.exec(normalized)) !== null) { if (knownTestNames.has(quotedMatch[2])) { return true; } }
  if (/(?:^|[\s(`])((?:\/|\.\/)?[\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?)(?=$|[\s),`])/.test(normalized)) { return true; }
  const cellForCommands = cell.replace(/``/g, '  ');
  const inlineCommandPattern = /`([^`]+)`/g;
  let commandMatch: RegExpExecArray | null;
  while ((commandMatch = inlineCommandPattern.exec(cellForCommands)) !== null) {
    const command = commandMatch[1].trim();
    if (/^(npm|npx|node|git|px)\s+/i.test(command)) { return true; }
    if (/^(bash|sh|cat|head|tail|diff|grep|sed|awk|xxd|od|wc|sort|uniq|stat|ls)\s+/i.test(command)) {
      for (const arg of command.split(/\s+/).slice(1)) {
        if (!arg.startsWith('-') && fsExistsSync(fileSystem, path.join(rootDir, arg.replace(/^\.\//, '')))) { return true; }
      }
    }
    if (command.startsWith('./') && fsExistsSync(fileSystem, path.join(rootDir, command.split(/\s+/)[0].replace(/^\.\//, '')))) { return true; }
  }
  return false;
}

export function findUnverifiableGoalCheckRow(fileSystem: EvidenceFileSystemPort, evidenceRows: string[], rootDir: string): string | null {
  const knownTestNames = collectRepoTestNames(fileSystem, rootDir);
  for (const row of evidenceRows) {
    const columns = row.split('|').slice(1, -1).map(part => part.trim()).filter(Boolean);
    if (!columns.some(cell => evidenceCellHasVerifiableReference(fileSystem, cell, rootDir, knownTestNames))) { return row; }
  }
  return null;
}
