import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// This module is imported only by coverage-gate. Resolve the compiler before
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

/** C8's --all placeholders count erased TypeScript declarations as lines. */
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
