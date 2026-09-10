import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const capacityModule = new URL('../src/adapters/agents/custom-capacity.ts', import.meta.url).href;

function startContender(worktree: string, home: string) {
  const script = `
    import { tryAcquireCustomCapacity } from ${JSON.stringify(capacityModule)};
    const reservation = await tryAcquireCustomCapacity(process.argv[1]);
    process.stdout.write((reservation ? 'acquired' : 'rejected') + ':' + process.env.PARALLIX_HOME + '\\n');
    if (reservation) setTimeout(() => reservation.release(), 5_000);
  `;
  return spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script, worktree], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PARALLIX_HOME: home }
  });
}

function firstLine(child: ReturnType<typeof startContender>): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('\n')) resolve(output.trim());
    });
    child.once('error', reject);
    child.stderr.once('data', (chunk) => reject(new Error(String(chunk))));
  });
}

test('two processes contend for one custom slot: exactly one acquires', async (t) => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-capacity-race-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-capacity-home-'));
  fs.writeFileSync(path.join(worktree, 'workflow.config.json'), JSON.stringify({
    adapters: { agents: { maxConcurrentCustom: 1 } }
  }));
  t.after(() => {
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  const first = startContender(worktree, home);
  t.after(() => {
    first.kill();
  });

  assert.match(await firstLine(first), /^acquired:/);
  const second = startContender(worktree, home);
  t.after(() => second.kill());
  assert.match(await firstLine(second), /^rejected:/);
});
