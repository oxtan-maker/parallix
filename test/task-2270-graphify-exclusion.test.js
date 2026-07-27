'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'task-2270-graphify-exclusion');

test('Graphify excludes configured mission documents before extraction while retaining source relationships', () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2270-graphify-'));
  try {
    fs.cpSync(fixtureRoot, worktree, { recursive: true });
    fs.copyFileSync(path.join(repoRoot, '.graphifyignore'), path.join(worktree, '.graphifyignore'));

    const result = childProcess.spawnSync('python3', ['-c', `
import json
import sys
from pathlib import Path
from graphify.detect import detect
from graphify.extract import collect_files, extract

root = Path(sys.argv[1])
detection = detect(root)
documents = detection['files']['document']
code_files = []
for filename in detection['files']['code']:
    code_files.extend(collect_files(Path(filename), root=root))
extraction = extract(code_files, cache_root=root)
print(json.dumps({
    'documents': documents,
    'node_sources': [node.get('source_file', '') for node in extraction['nodes']],
    'edges': extraction['edges'],
}))
`, worktree], {
      encoding: 'utf8',
      // The standard test bootstrap isolates HOME; restore the installed
      // Graphify package's user-site location for this focused tool contract.
      env: { ...process.env, HOME: os.userInfo().homedir }
    });

    assert.equal(result.status, 0, result.stderr);
    const graph = JSON.parse(result.stdout);
    assert.ok(
      !graph.documents.some(file => file.endsWith('/missions/task-0000/MISSION.md')),
      'the configured mission document must be excluded before Graphify creates nodes'
    );
    assert.ok(
      graph.node_sources.some(file => file.endsWith('src/source.ts')),
      'the non-excluded source fixture must create graph nodes'
    );
    assert.ok(
      graph.edges.some(edge => edge.relation === 'imports_from'),
      'the retained source fixtures must preserve their import relationship'
    );
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});
