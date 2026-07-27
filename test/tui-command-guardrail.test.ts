import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

test('TUI modules perform no task-file write, Git call, SQL, Forgejo call, or subprocess spawn', () => {
  const directory = join(process.cwd(), 'src/interfaces/tui');
  const forbidden = /node:child_process|\bspawn\(|\bexec\(|\.git\b|forgejo|writeFile|appendFile|unlink|sqlite/i;
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) { continue; }
    const source = readFileSync(join(directory, name), 'utf8');
    assert.doesNotMatch(source, forbidden, `${name} must delegate effects through application ports`);
  }
});
