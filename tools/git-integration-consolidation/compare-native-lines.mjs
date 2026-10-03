// TASK-2622.09 — normalized executable-line identity and positive-hit comparison.
//
// Usage: node tools/git-integration-consolidation/compare-native-lines.mjs \
//          <baseline.info> <candidate.info> [out.json]
//
// Both inputs come from tools/coverage-comparison/compare-slice-coverage.ts with
// matched settings. Production sources are byte-identical on both sides, so the
// comparison reads source text from the working tree. A baseline line that was
// covered and is not covered by the candidate is a lost covered line; any
// divergence in the executable-line inventory (a line present on one side only)
// is classified against the TypeScript AST. Lines whose only tokens are erased
// type syntax are reporter inventory noise, not executable code. Anything else
// is UNRESOLVED and fails the comparison.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const [baselinePath, candidatePath, outPath] = process.argv.slice(2);
if (!baselinePath || !candidatePath) {
  throw new Error('Usage: compare-native-lines.mjs <baseline.info> <candidate.info> [out.json]');
}

function parse(file) {
  const files = new Map();
  let lines;
  for (const row of fs.readFileSync(file, 'utf8').split('\n')) {
    if (row.startsWith('SF:')) {
      const source = row.slice(3);
      const key = source.slice(source.lastIndexOf('/src/') + 1);
      lines = files.get(key) ?? new Map();
      files.set(key, lines);
    } else if (row.startsWith('DA:') && lines) {
      const [n, hits] = row.slice(3).split(',').map(Number);
      lines.set(n, Math.max(lines.get(n) ?? 0, hits));
    }
  }
  return files;
}

const erasedCache = new Map();
function erasedLines(source) {
  if (erasedCache.has(source)) { return erasedCache.get(source); }
  const text = fs.readFileSync(source, 'utf8');
  const ast = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true);
  const erased = new Set();
  const executable = new Set();
  const declarationOnly = new Set();
  function visit(node, isErased = false) {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) { return; }
    if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
      const from = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
      const to = ast.getLineAndCharacterOfPosition(node.end - 1).line + 1;
      for (let line = from; line <= to; line++) { declarationOnly.add(line); }
    }
    const nowErased = isErased || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
      || ts.isTypeNode(node) || (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)
      || (ts.isExportDeclaration(node) && node.isTypeOnly)
      || ((ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) && node.isTypeOnly);
    const children = node.getChildren(ast);
    if (children.length) { children.forEach(child => visit(child, nowErased)); return; }
    if (node.kind === ts.SyntaxKind.EndOfFileToken || node.kind === ts.SyntaxKind.SyntaxList) { return; }
    const start = node.getStart(ast);
    const first = ast.getLineAndCharacterOfPosition(start).line + 1;
    const last = ast.getLineAndCharacterOfPosition(Math.max(start, node.end - 1)).line + 1;
    for (let line = first; line <= last; line++) { (nowErased ? erased : executable).add(line); }
  }
  visit(ast);
  for (const line of executable) { erased.delete(line); }
  erasedCache.set(source, { erased, declarationOnly });
  return erasedCache.get(source);
}

// Lost covered lines are classified strictly. A line present in only one inventory is also accepted
// when it sits inside an import/export-from declaration, where the native reporter's per-line
// punctuation attribution varies with how the module was loaded.
const classify = (source, line, inventoryOnly = false) => {
  const { erased, declarationOnly } = erasedLines(source);
  if (erased.has(line)) { return 'erased TypeScript tokens only'; }
  return inventoryOnly && declarationOnly.has(line) ? 'import/export declaration line (inventory only)' : 'UNRESOLVED';
};
const baseline = parse(baselinePath);
const candidate = parse(candidatePath);
const lostCovered = [];
const inventoryOnlyBaseline = [];
const inventoryOnlyCandidate = [];
let baselineLines = 0, baselineCovered = 0, candidateLines = 0, candidateCovered = 0;
for (const [source, lines] of baseline) {
  for (const [line, hits] of lines) {
    baselineLines += 1;
    if (hits > 0) { baselineCovered += 1; }
    const next = candidate.get(source)?.get(line);
    if (next === undefined) { inventoryOnlyBaseline.push({ source, line, hits, classification: classify(source, line, true) }); }
    if (hits > 0 && !(next > 0)) { lostCovered.push({ source, line, baselineHits: hits, candidateHits: next ?? null, classification: classify(source, line) }); }
  }
}
for (const [source, lines] of candidate) {
  for (const [line, hits] of lines) {
    candidateLines += 1;
    if (hits > 0) { candidateCovered += 1; }
    if (baseline.get(source)?.get(line) === undefined) { inventoryOnlyCandidate.push({ source, line, hits, classification: classify(source, line, true) }); }
  }
}
// Comparable rate: the candidate evaluated on exactly the baseline's executable-line identities.
let comparableCandidateCovered = 0, normalizedBaselineLines = 0, normalizedBaselineCovered = 0, normalizedCandidateLines = 0, normalizedCandidateCovered = 0;
for (const [source, lines] of baseline) {
  for (const [line, hits] of lines) {
    if (candidate.get(source)?.get(line) > 0) { comparableCandidateCovered += 1; }
    if (!erasedLines(source).erased.has(line)) { normalizedBaselineLines += 1; if (hits > 0) { normalizedBaselineCovered += 1; } }
  }
}
for (const [source, lines] of candidate) {
  for (const [line, hits] of lines) {
    if (!erasedLines(source).erased.has(line)) { normalizedCandidateLines += 1; if (hits > 0) { normalizedCandidateCovered += 1; } }
  }
}
const rate = (covered, total) => Math.round((covered / total) * 10_000) / 100;
const unresolved = [...lostCovered, ...inventoryOnlyBaseline, ...inventoryOnlyCandidate].filter(row => row.classification === 'UNRESOLVED');
const report = {
  sourceFiles: { baseline: baseline.size, candidate: candidate.size },
  executableLines: { baseline: baselineLines, candidate: candidateLines },
  coveredLines: { baseline: baselineCovered, candidate: candidateCovered },
  lineRatePercent: { baseline: rate(baselineCovered, baselineLines), candidate: rate(candidateCovered, candidateLines) },
  comparableLineRate: { identities: baselineLines, baselineCovered, candidateCovered: comparableCandidateCovered, baselinePercent: rate(baselineCovered, baselineLines), candidatePercent: rate(comparableCandidateCovered, baselineLines) },
  normalizedLineRate: { baseline: { lines: normalizedBaselineLines, covered: normalizedBaselineCovered, percent: rate(normalizedBaselineCovered, normalizedBaselineLines) }, candidate: { lines: normalizedCandidateLines, covered: normalizedCandidateCovered, percent: rate(normalizedCandidateCovered, normalizedCandidateLines) } },
  lostCovered: lostCovered.length,
  lostCoveredErasedOnly: lostCovered.filter(row => row.classification !== 'UNRESOLVED').length,
  inventoryOnlyDeclarationLines: inventoryOnlyCandidate.filter(row => row.classification.startsWith('import/export')).length,
  inventoryOnlyBaseline: inventoryOnlyBaseline.length,
  inventoryOnlyCandidate: inventoryOnlyCandidate.length,
  inventoryOnlyCandidateCovered: inventoryOnlyCandidate.filter(row => row.hits > 0).length,
  unresolved,
  lostCoveredRows: lostCovered,
};
const text = `${JSON.stringify(report, null, 2)}\n`;
if (outPath) { fs.writeFileSync(outPath, text); } else { process.stdout.write(text); }
process.exitCode = unresolved.length === 0 ? 0 : 1;
