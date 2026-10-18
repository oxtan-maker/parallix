// Static policy tooling: read production text without executing it. Keep the
// TypeScript compiler out of the covered test worker's module graph.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

function directJsonWrites(file, source) {
  // Both identifiers are necessary; the AST remains the matching authority.
  if (!source.includes('writeFileSync') || !source.includes('stringify')) return [];
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const writes = [];
  function visit(node) {
    if (ts.isCallExpression(node) && /\.writeFileSync$/.test(node.expression.getText(sourceFile))) {
      const body = node.arguments.slice(1).map(arg => arg.getText(sourceFile)).join(' ');
      if (/\bJSON\.stringify\s*\(/.test(body)) {
        writes.push(`${file}:${node.arguments[0].getText(sourceFile)}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return writes;
}

function scan(directory, root) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? scan(file, root)
      : entry.isFile() && entry.name.endsWith('.ts')
        ? directJsonWrites(path.relative(root, file), fs.readFileSync(file, 'utf8')) : [];
  });
}

const directory = process.argv[2];
process.stdout.write(JSON.stringify(scan(directory, path.dirname(directory))));
