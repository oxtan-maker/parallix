// Real-tool diagnostics are evaluated together; the owning suite separately
// proves the shell gate's status handling with isolated tool executables.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// These tools publish CommonJS. Load them through their native entry points
// rather than making Node scan their large sources to detect module format.
const require = createRequire(import.meta.url);
const { ESLint } = require('eslint');
const ts = require('typescript');
const parser = require('@typescript-eslint/parser');

const [root, config, encoded] = process.argv.slice(2);
const scenarios = JSON.parse(encoded);
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
  strict: true, noEmit: true, skipLibCheck: true, target: 'ES2024',
  // Scenarios use ES5 globals and Promise. Avoid parsing the unrelated
  // collection, iterator and reflection libraries in this one-shot project.
  module: 'NodeNext', moduleResolution: 'NodeNext', types: [], lib: ['ES5', 'ES2015.Promise'],
}, include: ['src/**/*.ts', 'scripts/**/*.ts', 'test/**/*.ts'] }));
const files = scenarios.map((scenario, index) => {
  const file = path.join(root, scenario.file.replace('fixture.ts', `fixture-${index}.ts`));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, scenario.source + '\n');
  return file;
});
const eslint = new ESLint({ cwd: root, overrideConfigFile: config });
const lintFiles = files.filter((file, index) => file.includes(`${path.sep}src${path.sep}`)
  && !scenarios[index].name.includes('compiler'));
const lint = await eslint.lintFiles(lintFiles);
// Reuse the real project service program used by the lint rules instead of
// parsing and binding the same project a second time for compiler diagnostics.
const { services } = parser.parseForESLint(fs.readFileSync(files[0], 'utf8'), {
  filePath: files[0], tsconfigRootDir: root, projectService: true,
});
if (!services.program) throw new Error('fixture TypeScript program was not created');
const program = services.program;
// Diagnose the scenario sources, rather than traversing unrelated library
// files. The real checker and the lint project still share the same program.
const compilerFiles = files.filter((_file, index) => scenarios[index].name.includes('compiler'));
const diagnostics = compilerFiles.flatMap(file => {
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`fixture source missing from TypeScript program: ${file}`);
  return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
});
process.stdout.write(JSON.stringify(scenarios.map((scenario, index) => ({
  name: scenario.name,
  lint: lint.find(result => result.filePath === files[index])?.messages ?? [],
  compiler: diagnostics.filter(diagnostic => diagnostic.file?.fileName === files[index])
    .map(diagnostic => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`),
}))));
