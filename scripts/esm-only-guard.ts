import fs from 'node:fs';
import path from 'node:path';

const authoredExtensions = new Set(['.ts', '.mts', '.mjs', '.js', '.json']);
const ignoredDirectories = new Set(['.git', 'node_modules', 'build', 'dist', 'graphify-out', 'backlog', 'missions', 'proofs']);
const forbidden = [
  /\bmodule\s*\.\s*exports\b/,
  /\brequire\s*\(/,
  /\btype\s*["']?\s*[:=]\s*["']commonjs["']/i,
  /\.test-runtime(?:[\\/]|\b)/,
];

function walk(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) { return ignoredDirectories.has(entry.name) ? [] : walk(file); }
    return authoredExtensions.has(path.extname(entry.name)) ? [file] : [];
  });
}

export function findEsmOnlyViolations(repoRoot = process.cwd()): string[] {
  return ['src', 'scripts', 'test', 'config', 'eslint.config.mjs', 'package.json'].flatMap(relative => {
    const candidate = path.join(repoRoot, relative);
    if (!fs.existsSync(candidate)) { return []; }
    return (fs.statSync(candidate).isDirectory() ? walk(candidate) : [candidate]);
  }).filter(file => {
    const base = path.basename(file);
    return base !== 'esm-only-guard.ts' && base !== 'esm-only-guard.test.ts';
  }).flatMap(file => {
    const source = fs.readFileSync(file, 'utf8');
    const relativePath = path.relative(repoRoot, file);
    // In test/ files, strip strings and comments so CJS patterns inside test
    // data (child process scenarios, assertion messages) don't trigger false
    // positives. Source/config/JSON files keep full text — their CJS patterns
    // are real code, not test fixtures.
    //
    // Strip order: strings first, then comments. If comments are stripped first,
    // a `//` inside a string (e.g. a URL like `https://example.com`) truncates
    // the rest of the line and can hide violations on that line.
    //
    // The `.test-runtime` pattern always matches raw source — retired-tree path
    // references live inside string literals and must be caught even in test/ files.
    const isTestFile = relativePath.startsWith('test' + path.sep);
    const checkText = isTestFile
      ? source
          .replace(/`(?:[^`\\]|\\.)*`/g, '')           // template literals
          .replace(/"(?:[^"\\]|\\.)*"/g, '')           // double-quoted strings
          .replace(/'(?:[^'\\]|\\.)*'/g, '')          // single-quoted strings
          .replace(/\/\/[^\n]*/g, '')                  // single-line comments
          .replace(/\/\*[\s\S]*?\*\//g, '')             // block comments
      : source;

    const runtimePattern = forbidden[forbidden.length - 1]; // .test-runtime
    const cjsPatterns = forbidden.slice(0, -1);             // module.exports, require(, type:commonjs
    const violations = [];
    for (const pattern of cjsPatterns) {
      if (pattern.test(checkText)) violations.push(`${relativePath}: ${pattern}`);
    }
    // .test-runtime checked against source with comments stripped (historical
    // notes in comments are acceptable; path references in strings must fire).
    const runtimeSource = source
      .replace(/\/\/[^\n]*/g, '')                  // single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '');             // block comments
    if (runtimePattern.test(runtimeSource)) violations.push(`${relativePath}: ${runtimePattern}`);
    return violations;
  });
}

if (process.argv[1] && path.basename(process.argv[1]) === 'esm-only-guard.ts') {
  const violations = findEsmOnlyViolations();
  if (violations.length) {
    process.stderr.write(`${violations.join('\n')}\n`);
    process.exitCode = 1;
  }
}
