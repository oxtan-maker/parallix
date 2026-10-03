import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const baseline = process.argv[2];
if (!baseline)
    throw new Error('Usage: node tools/review-consolidation/compare-native-lines.mjs <baseline-checkout>');
const dir = 'tools/review-consolidation/';
function parse(file) { const map = new Map(); let lines; for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('SF:')) {
        const source = line.slice(3);
        lines = map.get(source) ?? new Map();
        map.set(source, lines);
    }
    else if (line.startsWith('DA:')) {
        const [n, h] = line.slice(3).split(',').map(Number);
        lines.set(n, Math.max(lines.get(n) ?? 0, h));
    }
} return map; }
const before = parse(dir + 'before-comparable.lcov'), after = parse(dir + 'after-comparable.lcov');
const missing = [], newLines = [];
for (const [source, lines] of before) {
    for (const [line, hits] of lines) {
        if (!after.get(source)?.has(line))
            missing.push({ source, line, hits });
    }
}
for (const [source, lines] of after) {
    for (const [line, hits] of lines) {
        if (!before.get(source)?.has(line))
            newLines.push({ source, line, hits });
    }
}
const erased = new Map();
for (const { source } of missing) {
    if (erased.has(source))
        continue;
    const text = fs.readFileSync(source, 'utf8');
    const ast = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true);
    const valid = new Set(), invalid = new Set();
    function visit(n, isErased = false) {
        if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode)
            return;
        isErased ||= ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isTypeNode(n) || (ts.isImportDeclaration(n) && n.importClause?.isTypeOnly);
        const children = n.getChildren(ast);
        if (children.length) {
            children.forEach(c => visit(c, isErased));
            return;
        }
        if (n.kind === ts.SyntaxKind.EndOfFileToken || n.kind === ts.SyntaxKind.SyntaxList)
            return;
        const start = n.getStart(ast), end = n.end;
        const first = ast.getLineAndCharacterOfPosition(start).line + 1, last = ast.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line + 1;
        for (let l = first; l <= last; l++)
            (isErased ? valid : invalid).add(l);
    }
    visit(ast);
    for (const line of invalid)
        valid.delete(line);
    erased.set(source, valid);
}
for (const row of missing) {
    row.classification = erased.get(row.source)?.has(row.line) ? 'erased TypeScript tokens only' : 'UNRESOLVED';
    if (row.hits !== 0 || row.classification === 'UNRESOLVED')
        throw Error(JSON.stringify(row));
}
if (newLines.length)
    throw Error('New denominator lines ' + JSON.stringify(newLines));
let denominator = 0, beforeHits = 0, afterHits = 0;
const lost = [];
for (const [source, lines] of before) {
    for (const [line, hits] of lines) {
        denominator++;
        if (hits > 0) {
            beforeHits++;
            if (!(after.get(source)?.get(line) > 0))
                lost.push(source + ':' + line);
        }
        if (after.get(source)?.get(line) > 0)
            afterHits++;
    }
}
const sourceHashes = Object.fromEntries([...before.keys()].map(source => { const actual = fs.readFileSync(source); const prior = fs.readFileSync(path.join(baseline, source)); if (!actual.equals(prior))
    throw Error('Changed source ' + source); return [source, crypto.createHash('sha256').update(actual).digest('hex')]; }));
const result = { baselineRevision: 'b7b304407', method: 'Sequential isolated native coverage, repository merge/type-only/comment normalization; pinned original source/line inventory. Missing zero-hit erased TypeScript lines remain in the comparable denominator at zero. No executable source is excluded and no hit is synthesized.', rawInventory: JSON.parse(fs.readFileSync(dir + 'coverage-comparison.json')), inventoryDifference: missing, comparable: { sourceFiles: before.size, denominator, beforeCovered: beforeHits, afterCovered: afterHits, beforeRate: beforeHits / denominator, afterRate: afterHits / denominator, lostCovered: lost }, sourceHashes, coverageTransfer: { removedReviewBootstrap: 'Lifecycle setup incidental coverage remains covered by unchanged owning lifecycle and persistence suites, selected on BOTH baseline and candidate.', owners: ['test/mission-use-case-persistence-contract.test.ts', 'test/mission-handoff-lane-events-contract.test.ts', 'test/sqlite-repository-contract.integration.test.ts', 'test/task-2322-05-mission-sqlite-fixture.test.ts'], durableReviewAssertions: 'Approval round idempotency and request-changes/resolution history are retained and strengthened by SQLite reopen assertions in test/review-state.test.ts.' } };
fs.writeFileSync(dir + 'coverage-transfer.json', JSON.stringify(result, null, 2) + '\n');
console.log(result.comparable, 'Validated erased-only differences:', missing.length);
