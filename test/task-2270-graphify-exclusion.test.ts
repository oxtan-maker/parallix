import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'task-2270-graphify-exclusion');

test('Graphify excludes configured mission documents before extraction while retaining source relationships', () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2270-graphify-'));
  try {
    fs.cpSync(fixtureRoot, worktree, { recursive: true });
    fs.copyFileSync(path.join(repoRoot, '.graphifyignore'), path.join(worktree, '.graphifyignore'));

    const result = childProcess.spawnSync('uv', ['run', '--offline', '--with', 'graphifyy', 'python', '-c', `
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
      // The standard test bootstrap isolates HOME; restore Graphify's tool
      // cache for this focused tool contract.
      env: { ...process.env, HOME: os.userInfo().homedir }
    });

    assert.equal(result.status, 0, result.stderr);
    const graph = JSON.parse(result.stdout as string);
    assert.ok(
      !graph.documents.some((file: string) => file.endsWith('/missions/task-0000/MISSION.md')),
      'the configured mission document must be excluded before Graphify creates nodes'
    );
    assert.ok(
      graph.node_sources.some((file: string) => file.endsWith('src/source.ts')),
      'the non-excluded source fixture must create graph nodes'
    );
    assert.ok(
      graph.edges.some((edge: { relation: string }) => edge.relation === 'imports_from'),
      'the retained source fixtures must preserve their import relationship'
    );
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});
