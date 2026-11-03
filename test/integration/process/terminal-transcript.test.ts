// Owns the private transcript's POSIX shell boundary: failure-isolated relay
// and executed replay. Retention policy stays in the in-process tmux-host suite.
// No tmux, model backend or workstation service is needed by these shell cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { transcriptWriterScript, transcriptReplayScript } from '../../../src/adapters/process/terminal-transcript.js';

test('a failed transcript worker drains its FIFO without truncating durable command output (TASK-2816)', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-relay-'));
  fs.writeFileSync(path.join(root, 'writer.sh'), transcriptWriterScript('/bin/false', root));
  const payload = Buffer.alloc(2 * 1024 * 1024, 'x');
  const relay = spawn('sh', ['-c', 'mkfifo transcript; sh writer.sh ignored ignored < transcript & reader=$!; cat | tee transcript; status=$?; wait "$reader"; exit "$status"'], {
    cwd: root, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let finished = false, error: Error | undefined;
  const chunks: Buffer[] = [], diagnostics: Buffer[] = [];
  relay.stdout.on('data', chunk => chunks.push(chunk));
  relay.stderr.on('data', chunk => diagnostics.push(chunk));
  relay.on('error', failure => { error = failure; });
  relay.stdin.on('error', failure => { error = failure; });
  const completion = new Promise<number | null>(resolve => relay.on('close', code => { finished = true; resolve(code); }));
  const stop = () => { if (!finished && relay.pid) { try { process.kill(-relay.pid, 'SIGKILL'); } catch { /* already exited */ } } };
  const deadline = setTimeout(stop, 30_000);
  t.after(async () => { clearTimeout(deadline); stop(); await completion; fs.rmSync(root, { recursive: true, force: true }); });
  relay.stdin.end(payload);
  const status = await completion;
  assert.equal(error, undefined);
  assert.equal(status, 0, Buffer.concat(diagnostics).toString());
  assert.deepEqual(Buffer.concat(chunks), payload, 'every byte reaches retained workflow output after writer startup failure');
});

test('console replay executes retained segments in order and reports rotation or expiry (TASK-2816)', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-replay-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, 'replay.sh');
  fs.writeFileSync(script, transcriptReplayScript());
  for (const [index, text] of [[2, 'third'], [0, 'first'], [1, 'second']] as const) {
    fs.writeFileSync(path.join(root, `operation.${String(index).padStart(12, '0')}`), text + '\n');
  }
  fs.writeFileSync(path.join(root, 'operation.000000'), 'unshipped branch format');
  const replay = () => {
    const result = spawnSync('sh', [script, root, 'operation', '23'], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  assert.equal(replay(), 'first\nsecond\nthird\n\n[mission terminal command exit code: 23]\n');
  fs.rmSync(path.join(root, 'operation.000000000001'));
  assert.match(replay(), /between retained segments was not retained.*first\nthird\n/s);
  fs.writeFileSync(path.join(root, 'operation.000000000001'), 'second\n');
  fs.rmSync(path.join(root, 'operation.000000000000'));
  assert.match(replay(), /rotated out.*\nsecond\nthird\n/s);
  for (const index of [1, 2]) { fs.rmSync(path.join(root, `operation.${String(index).padStart(12, '0')}`)); }
  assert.match(replay(), /no longer retained.*\n\n\[mission terminal command exit code: 23\]/s);
});
