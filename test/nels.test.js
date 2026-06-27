const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  computeNEL,
  computeNELRecord,
  classifyBucket,
  isExcluded,
  EXCLUSION_PATTERNS,
  BUCKET_SMALL_MAX,
  BUCKET_MEDIUM_MAX,
} = require('../lib/core/nels');

// ---------- exclude-path tests ----------

test('isExcluded filters missions/** paths', () => {
  assert.strictEqual(isExcluded('missions/task-1355/MISSION.md'), true);
  assert.strictEqual(isExcluded('missions/task-1355/data/dataset.md'), true);
  assert.strictEqual(isExcluded('missions/other/file.txt'), true);
});

test('isExcluded filters backlog/** paths', () => {
  assert.strictEqual(isExcluded('backlog/tasks/task-001.md'), true);
  assert.strictEqual(isExcluded('backlog/archive/old.md'), true);
});

test('isExcluded filters review-* paths', () => {
  assert.strictEqual(isExcluded('review-claude.md'), true);
  assert.strictEqual(isExcluded('review-codex-summary.md'), true);
});

test('isExcluded filters CP-* paths', () => {
  assert.strictEqual(isExcluded('CP-1.md'), true);
  assert.strictEqual(isExcluded('CP-2.md'), true);
});

test('isExcluded filters **/*.md paths', () => {
  assert.strictEqual(isExcluded('README.md'), true);
  assert.strictEqual(isExcluded('docs/api/README.md'), true);
  assert.strictEqual(isExcluded('src/NOTES.md'), true);
});

test('isExcluded filters docs/** paths', () => {
  assert.strictEqual(isExcluded('docs/adr/0032.md'), true);
  assert.strictEqual(isExcluded('docs/guidelines.md'), true);
});

test('isExcluded filters package-lock.json', () => {
  assert.strictEqual(isExcluded('package-lock.json'), true);
});

test('isExcluded filters coverage/** paths', () => {
  assert.strictEqual(isExcluded('coverage/lcov.info'), true);
  assert.strictEqual(isExcluded('coverage/src/file.js.html'), true);
});

test('isExcluded filters lockfiles', () => {
  assert.strictEqual(isExcluded('yarn.lock'), true);
  assert.strictEqual(isExcluded('pnpm-lock.yaml'), true);
  assert.strictEqual(isExcluded('Gemfile.lock'), true);
});

test('isExcluded allows non-excluded paths', () => {
  assert.strictEqual(isExcluded('src/index.js'), false);
  assert.strictEqual(isExcluded('lib/core/nels.js'), false);
  assert.strictEqual(isExcluded('test/nels.test.js'), false);
  assert.strictEqual(isExcluded('package.json'), false);
  assert.strictEqual(isExcluded('px.js'), false);
});

// ---------- bucket classification tests ----------

test('classifyBucket returns Small for 0 NEL', () => {
  const b = classifyBucket(0);
  assert.strictEqual(b.label, 'Small');
  assert.strictEqual(b.min, 0);
  assert.strictEqual(b.max, BUCKET_SMALL_MAX);
});

test('classifyBucket returns Small for 80 NEL', () => {
  const b = classifyBucket(80);
  assert.strictEqual(b.label, 'Small');
  assert.strictEqual(b.max, BUCKET_SMALL_MAX);
});

test('classifyBucket returns Medium for 81 NEL', () => {
  const b = classifyBucket(81);
  assert.strictEqual(b.label, 'Medium');
  assert.strictEqual(b.min, BUCKET_SMALL_MAX + 1);
});

test('classifyBucket returns Medium for 235 NEL', () => {
  const b = classifyBucket(235);
  assert.strictEqual(b.label, 'Medium');
  assert.strictEqual(b.max, BUCKET_MEDIUM_MAX);
});

test('classifyBucket returns Large for 236 NEL', () => {
  const b = classifyBucket(236);
  assert.strictEqual(b.label, 'Large');
  assert.strictEqual(b.min, BUCKET_MEDIUM_MAX + 1);
});

test('classifyBucket returns Large for very high NEL', () => {
  const b = classifyBucket(10000);
  assert.strictEqual(b.label, 'Large');
  assert.strictEqual(b.max, Infinity);
});

// ---------- computeNEL integration tests ----------

function createTempGitRepo() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nels-test-'));
  spawnSync('git', ['init'], { cwd: tmpDir, stdio: 'pipe' });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir, stdio: 'pipe' });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'pipe' });
  return tmpDir;
}

test('computeNEL returns 0 for empty diff range', () => {
  const nel = computeNEL('HEAD..HEAD');
  assert.strictEqual(nel, 0);
});

test('computeNEL counts insertions and deletions for included files', () => {
  const tmpDir = createTempGitRepo();
  try {
    // Initial commit
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/app.js'), 'hello\nworld\n');
    spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: tmpDir, stdio: 'pipe' });

    // Modify: add lines
    fs.writeFileSync(path.join(tmpDir, 'src/app.js'), 'hello\nworld\nfoo\nbar\nbaz\n');
    spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'modify'], { cwd: tmpDir, stdio: 'pipe' });

    // The diff should show additions
    const nel = computeNEL('HEAD~1..HEAD', { cwd: tmpDir });
    assert.ok(nel > 0, `Expected positive NEL but got ${nel}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('computeNEL excludes missions/** from NEL count', () => {
  const tmpDir = createTempGitRepo();
  try {
    fs.mkdirSync(path.join(tmpDir, 'missions/task-001'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'missions/task-001/MISSION.md'), '# Mission\n');
    spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'add mission'], { cwd: tmpDir, stdio: 'pipe' });

    // Add 100 lines to a mission file
    let missionContent = '# Mission\n';
    for (let i = 0; i < 100; i++) {
      missionContent += `Line ${i}\n`;
    }
    fs.writeFileSync(path.join(tmpDir, 'missions/task-001/MISSION.md'), missionContent);
    spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });

    // NEL should be 0 because the only change is in missions/**
    const nel = computeNEL('HEAD~1..HEAD', { cwd: tmpDir });
    assert.strictEqual(nel, 0, `Expected NEL=0 for excluded path, got ${nel}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('computeNEL excludes **/*.md from NEL count', () => {
  const tmpDir = createTempGitRepo();
  try {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# README\n');
    spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: tmpDir, stdio: 'pipe' });

    // Add 100 lines to README
    let content = '# README\n';
    for (let i = 0; i < 100; i++) {
      content += `Line ${i}\n`;
    }
    fs.writeFileSync(path.join(tmpDir, 'README.md'), content);
    spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });

    // NEL should be 0 because README.md is excluded
    const nel = computeNEL('HEAD~1..HEAD', { cwd: tmpDir });
    assert.strictEqual(nel, 0, `Expected NEL=0 for .md file, got ${nel}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('computeNEL excludes docs/** from NEL count', () => {
  const tmpDir = createTempGitRepo();
  try {
    const docsDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'guide.md'), '# Guide\n');
    spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: tmpDir, stdio: 'pipe' });

    let content = '# Guide\n';
    for (let i = 0; i < 50; i++) {
      content += `Line ${i}\n`;
    }
    fs.writeFileSync(path.join(docsDir, 'guide.md'), content);
    spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });

    // NEL should be 0 because docs/** is excluded
    const nel = computeNEL('HEAD~1..HEAD', { cwd: tmpDir });
    assert.strictEqual(nel, 0, `Expected NEL=0 for docs/** file, got ${nel}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('computeNEL includes .js and .test.js files in NEL count', () => {
  const tmpDir = createTempGitRepo();
  try {
    fs.mkdirSync(path.join(tmpDir, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'lib/main.js'), '// initial\n');
    spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: tmpDir, stdio: 'pipe' });

    let content = '// initial\n';
    for (let i = 0; i < 10; i++) {
      content += `// line ${i}\n`;
    }
    fs.writeFileSync(path.join(tmpDir, 'lib/main.js'), content);
    spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'add lines'], { cwd: tmpDir, stdio: 'pipe' });

    const nel = computeNEL('HEAD~1..HEAD', { cwd: tmpDir });
    assert.ok(nel >= 10, `Expected NEL >= 10 for included .js file, got ${nel}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('computeNEL correctly handles mixed included and excluded files', () => {
  const tmpDir = createTempGitRepo();
  try {
    fs.mkdirSync(path.join(tmpDir, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'missions/task-001'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'lib/app.js'), '// v1\n');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Project\n');
    fs.writeFileSync(path.join(tmpDir, 'missions/task-001/MISSION.md'), '# Mission\n');
    spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: tmpDir, stdio: 'pipe' });

    // Modify: add lines to lib/app.js (included) and README.md (excluded)
    let jsContent = '// v1\n';
    for (let i = 0; i < 20; i++) {
      jsContent += `// added line ${i}\n`;
    }
    fs.writeFileSync(path.join(tmpDir, 'lib/app.js'), jsContent);

    let mdContent = '# Project\n';
    for (let i = 0; i < 50; i++) {
      mdContent += `doc line ${i}\n`;
    }
    fs.writeFileSync(path.join(tmpDir, 'README.md'), mdContent);

    spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'mixed changes'], { cwd: tmpDir, stdio: 'pipe' });

    // NEL should only count changes to lib/app.js (20 additions)
    // README.md and missions/** changes should be excluded
    const nel = computeNEL('HEAD~1..HEAD', { cwd: tmpDir });
    assert.ok(nel >= 20, `Expected NEL >= 20 for included file, got ${nel}`);
    assert.ok(nel < 70, `Expected NEL < 70 (excluding README changes), got ${nel}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('computeNEL returns 0 for non-existent range', () => {
  const nel = computeNEL('nonexistent-range-abc123..xyz');
  assert.strictEqual(nel, 0);
});

test('computeNELRecord returns nel and bucket', () => {
  const rec = computeNELRecord('HEAD..HEAD');
  assert.ok(typeof rec.nel === 'number', 'nel should be a number');
  assert.ok(rec.bucket, 'bucket should be defined');
  assert.ok(['Small', 'Medium', 'Large'].includes(rec.bucket.label), `bucket label should be valid, got ${rec.bucket.label}`);
});

// ---------- exclusion pattern regression tests ----------

test('EXCLUSION_PATTERNS contains all required patterns', () => {
  const patterns = EXCLUSION_PATTERNS;
  const patternStrs = patterns.join('|||');
  assert.ok(patternStrs.includes('missions/**'), 'Must exclude missions/**');
  assert.ok(patternStrs.includes('backlog/**'), 'Must exclude backlog/**');
  assert.ok(patternStrs.includes('review-*'), 'Must exclude review-*');
  assert.ok(patternStrs.includes('CP-*'), 'Must exclude CP-*');
  assert.ok(patternStrs.includes('**/*.md'), 'Must exclude **/*.md');
  assert.ok(patternStrs.includes('docs/**'), 'Must exclude docs/**');
  assert.ok(patternStrs.includes('package-lock.json'), 'Must exclude package-lock.json');
  assert.ok(patternStrs.includes('coverage/**'), 'Must exclude coverage/**');
  assert.ok(patterns.some(p => p.includes('lock')), 'Must exclude lockfiles');
});

test('isExcluded rejects review-* with various suffixes', () => {
  assert.strictEqual(isExcluded('review-claude.md'), true);
  assert.strictEqual(isExcluded('review-codex.md'), true);
  assert.strictEqual(isExcluded('review-summary.md'), true);
});
