/** Report-only audit. Deliberately not wired into lint or verification gates. */
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export interface TypeEscapeSite { file: string; line: number; exemption: string | null }
export function typeEscapeSites(file: string, text: string): TypeEscapeSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sites: TypeEscapeSite[] = [];
  const unwrap = (node: ts.Expression): ts.Expression => ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
  function visit(node: ts.Node): void {
    if (ts.isAsExpression(node)) {
      const inner = unwrap(node.expression);
      const literal = node.type.kind === ts.SyntaxKind.NeverKeyword ? inner
        : ts.isAsExpression(inner) && inner.type.kind === ts.SyntaxKind.UnknownKeyword ? unwrap(inner.expression) : null;
      if (literal && ts.isObjectLiteralExpression(literal)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
        const prefix = text.split('\n').slice(Math.max(0, line - 1), line + 1).join('\n');
        const exemption = /type-escape-exempt:\s*([^\n]+)/.exec(prefix)?.[1]?.trim() ?? null;
        sites.push({ file, line: line + 1, exemption });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return sites;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = execFileSync('git', ['ls-files', '-z', '--', 'src', 'web', 'scripts', 'test'], { encoding: 'utf8' })
    .split('\0').filter(file => /\.tsx?$/.test(file));
  const sites = files.flatMap(file => typeEscapeSites(file, readFileSync(file, 'utf8')));
  for (const site of sites) { console.log(`${site.file}:${site.line} ${site.exemption ? `exempt: ${site.exemption}` : 'actionable'}`); }
  console.log(JSON.stringify({ actionable: sites.filter(site => !site.exemption).length, exemptions: sites.filter(site => site.exemption).length }));
}
