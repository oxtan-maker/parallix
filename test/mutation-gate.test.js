const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mutationGate = require('../dist/lib/commands/mutation-gate');
const {
  parseArgs,
  loadBaseline,
  saveBaseline,
  findTestFiles,
  computeScoresFromReport,
} = mutationGate;

function makeRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-gate-repo-'));
  fs.mkdirSync(path.join(repoRoot, 'test'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'lib', 'core'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'lib', 'core', 'widget.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(repoRoot, 'test', 'widget.test.js'), "require('node:test');\n");
  return repoRoot;
}

test('parseArgs parses all flags with expected defaults', () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, base: null, head: 'HEAD', baselinePath: mutationGate.DEFAULT_BASELINE_PATH, threshold: null });
  const parsed = parseArgs(['--dry-run', '--base', 'develop', '--head', 'feature', '--threshold', '75.5']);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.base, 'develop');
  assert.equal(parsed.head, 'feature');
  assert.equal(parsed.threshold, 75.5);
});

test('loadBaseline returns empty filePaths when file is missing', () => {
  assert.deepEqual(loadBaseline('/nonexistent/baseline.json'), { filePaths: {} });
});

test('loadBaseline returns empty filePaths on malformed JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-gate-baseline-'));
  const baselinePath = path.join(dir, 'baseline.json');
  fs.writeFileSync(baselinePath, '{not json');
  try {
    assert.deepEqual(loadBaseline(baselinePath), { filePaths: {} });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('saveBaseline writes the documented schema and loadBaseline reads it back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-gate-baseline-'));
  const baselinePath = path.join(dir, 'nested', 'baseline.json');
  try {
    saveBaseline(baselinePath, { filePaths: { 'lib/core/widget.js': { score: 88.5, timestamp: '2026-01-01T00:00:00.000Z' } } });
    const raw = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    assert.deepEqual(raw, { filePaths: { 'lib/core/widget.js': { score: 88.5, timestamp: '2026-01-01T00:00:00.000Z' } } });
    assert.deepEqual(loadBaseline(baselinePath), raw);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('findTestFiles matches by basename convention before falling back to the full suite', () => {
  const repoRoot = makeRepo();
  try {
    const matched = findTestFiles(['lib/core/widget.js'], repoRoot);
    assert.deepEqual(matched, [path.join(repoRoot, 'test', 'widget.test.js')]);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('findTestFiles falls back to the full test/ suite when no basename matches', () => {
  const repoRoot = makeRepo();
  try {
    fs.writeFileSync(path.join(repoRoot, 'test', 'other.test.js'), "require('node:test');\n");
    const matched = findTestFiles(['lib/core/unrelated.js'], repoRoot);
    assert.deepEqual(matched, [
      path.join(repoRoot, 'test', 'other.test.js'),
      path.join(repoRoot, 'test', 'widget.test.js'),
    ]);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('computeScoresFromReport derives killed/(killed+survived+timeout) per file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-gate-report-'));
  const reportPath = path.join(dir, 'mutation.json');
  try {
    fs.writeFileSync(reportPath, JSON.stringify({
      files: {
        'lib/core/widget.js': {
          mutants: [
            { status: 'Killed' },
            { status: 'Killed' },
            { status: 'Survived' },
            { status: 'Timeout' },
            { status: 'NoCoverage' },
          ],
        },
        'lib/core/empty.js': { mutants: [] },
      },
    }));
    const scores = computeScoresFromReport(reportPath);
    assert.equal(scores['lib/core/widget.js'].score, 50);
    assert.equal(scores['lib/core/widget.js'].killed, 2);
    assert.equal(scores['lib/core/widget.js'].survived, 1);
    assert.equal(scores['lib/core/widget.js'].timeout, 1);
    assert.equal(scores['lib/core/empty.js'].score, 100);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run: first-run with no baseline entries passes the ratchet and seeds the baseline (CP-4)', () => {
  const repoRoot = makeRepo();
  const baselineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-gate-baseline-'));
  const baselinePath = path.join(baselineDir, 'mutation-baseline.json');
  try {
    const scopeFn = () => ({
      baseBranch: 'main',
      headRef: 'HEAD',
      changedFiles: ['lib/core/widget.js'],
      calleeFiles: [],
      targetFiles: ['lib/core/widget.js'],
    });
    const spawnSyncFn = (_cmd, args) => {
      const configPath = args[1];
      const reportPath = path.join(repoRoot, 'reports', 'mutation', 'mutation.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify({
        files: { 'lib/core/widget.js': { mutants: [{ status: 'Killed' }, { status: 'Survived' }] } },
      }));
      assert.ok(fs.existsSync(configPath));
      return { status: 0, error: null };
    };

    let exitCode = null;
    // @ts-expect-error TS2349 This expression is not callable.
    mutationGate(['--base', 'main', '--baseline-path', baselinePath], {
      exitFn: code => { exitCode = code; },
      scopeFn,
      spawnSyncFn,
      getPrimaryBranchFn: () => 'main',
      repoRoot,
    });

    assert.equal(exitCode, 0);
    const baseline = loadBaseline(baselinePath);
    assert.equal(baseline.filePaths['lib/core/widget.js'].score, 50);
    assert.ok(baseline.filePaths['lib/core/widget.js'].timestamp);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(baselineDir, { recursive: true, force: true });
  }
});

test('run: --dry-run never invokes spawnSyncFn and exits 0', () => {
  const repoRoot = makeRepo();
  try {
    const scopeFn = () => ({
      baseBranch: 'main',
      headRef: 'HEAD',
      changedFiles: ['lib/core/widget.js'],
      calleeFiles: [],
      targetFiles: ['lib/core/widget.js'],
    });
    let spawned = false;
    let exitCode = null;
    // @ts-expect-error TS2349 This expression is not callable.
    mutationGate(['--dry-run', '--base', 'main'], {
      exitFn: code => { exitCode = code; },
      scopeFn,
      spawnSyncFn: () => { spawned = true; return { status: 0, error: null }; },
      getPrimaryBranchFn: () => 'main',
      repoRoot,
    });
    assert.equal(exitCode, 0);
    assert.equal(spawned, false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
