import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// This module is imported only by scripts/coverage-merge.ts. Resolve the compiler before
// node:test starts timing individual assertions, rather than making the first
// coverage normalization pay TypeScript's module-load cost.
const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');

interface CoverageSourceDependencies {
  readSource(_file: string): string | undefined;
  emitSource(_source: string, _file: string): string;
}

const defaultDependencies: CoverageSourceDependencies = {
  readSource: file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined,
  emitSource: (source, file) => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, removeComments: true },
    fileName: file,
  }).outputText,
};

/** Include-all coverage reports modules that compile to no runtime code. */
export function removeTypeOnlyCoverage(
  lcov: string,
  rootDir: string,
  dependencies: CoverageSourceDependencies = defaultDependencies,
): string {
  return lcov.split('end_of_record').filter(record => {
    const source = /^SF:(.+)$/m.exec(record)?.[1];
    if (!source?.endsWith('.ts')) { return true; }
    const file = path.resolve(rootDir, source);
    if (!file.startsWith(`${path.resolve(rootDir)}${path.sep}`)) { return true; }
    const contents = dependencies.readSource(file);
    if (contents === undefined) { return true; }
    const emitted = dependencies.emitSource(contents, file).trim();
    return emitted !== '' && emitted !== 'export {};';
  }).join('end_of_record');
}

/** Native include-all emits zero-hit records for comments and local export lists. */
export function removeNonExecutableCoverage(
  lcov: string,
  rootDir: string,
  readSource: CoverageSourceDependencies['readSource'] = defaultDependencies.readSource,
): string {
  return lcov.split('end_of_record').map(record => {
    const source = /^SF:(.+)$/m.exec(record)?.[1];
    if (!source?.endsWith('.ts')) { return record; }
    const file = path.resolve(rootDir, source);
    if (!file.startsWith(`${path.resolve(rootDir)}${path.sep}`)) { return record; }
    const contents = readSource(file);
    if (contents === undefined) { return record; }
    const ast = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true);
    const tokenLines = new Set<number>();
    function visit(node: import('typescript').Node): void {
      if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) { return; }
      // Local export lists have no executable expression. Re-exports can load
      // another module, so retain those along with imports and runtime code.
      if (ts.isExportDeclaration(node) && !node.moduleSpecifier) { return; }
      const children = node.getChildren(ast);
      if (children.length) { children.forEach(visit); return; }
      if (node.kind === ts.SyntaxKind.EndOfFileToken || node.kind === ts.SyntaxKind.SyntaxList) { return; }
      const first = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
      const last = ast.getLineAndCharacterOfPosition(Math.max(node.getStart(ast), node.end - 1)).line + 1;
      for (let line = first; line <= last; line += 1) { tokenLines.add(line); }
    }
    visit(ast);
    let found = 0;
    let hit = 0;
    const lines = record.split('\n').filter(line => {
      if (/^(LF|LH):/.test(line)) { return false; }
      const entry = /^DA:(\d+),(\d+)/.exec(line);
      if (!entry) { return true; }
      if (!tokenLines.has(Number(entry[1]))) { return false; }
      found += 1;
      if (Number(entry[2]) > 0) { hit += 1; }
      return true;
    });
    return lines.join('\n').trimEnd() + `\nLF:${found}\nLH:${hit}\n`;
  }).join('end_of_record');
}
