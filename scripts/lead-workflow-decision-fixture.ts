/** HTTPS loopback boundary for offline public-CLI judgment qualification only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import type { DecisionRequest } from '../src/application/ports/decision.js';
import { DECISION_MODEL } from '../src/adapters/decision/provider.js';

export async function openWorkflowDecisionFixture(root: string) {
  const directory = path.join(root, 'decision-tls'); fs.mkdirSync(directory);
  const key = path.join(directory, 'key.pem'); const cert = path.join(directory, 'cert.pem');
  const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'],
  { encoding: 'utf8', timeout: 5000 });
  if (generated.status !== 0) { throw new Error(`Cannot generate disposable HTTPS identity: ${generated.stderr}`); }
  fs.chmodSync(key, 0o600);
  const requests: Array<{ request: DecisionRequest & { model: string }; response: unknown }> = [];
  const errors: string[] = [];
  const credential = 'offline-loopback-fixture-key';
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, async (request, response) => {
    try {
      assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/systemone');
      assert.equal(request.headers.authorization, `Bearer ${credential}`);
      let body = '';
      for await (const chunk of request) {
        body += String(chunk); if (Buffer.byteLength(body) > 65536) { throw new Error('Fixture request exceeds 64 KiB'); }
      }
      const data = JSON.parse(body) as DecisionRequest & { model: string };
      assert.equal(data.model, DECISION_MODEL);
      assert.deepEqual(Object.keys(data.questions), ['action', 'controls']);
      const question = data.questions.action;
      assert.equal(question.type, 'choice');
      if (question.type !== 'choice' || !Object.hasOwn(question.criteria, 'continue')) { throw new Error('Continuation unavailable in actual packet'); }
      const answer = { model: DECISION_MODEL, answers: { action: { type: 'choice', choice: 'continue', confidence: 1,
        probabilities: Object.fromEntries(Object.keys(question.criteria).map(action => [action, action === 'continue' ? 1 : 0])) }, controls: { type: 'choice', choice: 'mission-worktree', confidence: 1,
          probabilities: { standard: 0, 'mission-worktree': 1, unknown: 0 } } } };
      requests.push({ request: data, response: answer });
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(answer));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      response.writeHead(400); response.end('Offline fixture rejected request');
    }
  });
  server.requestTimeout = 2000; server.headersTimeout = 2000; server.setTimeout(2000, socket => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') { throw new Error('Loopback HTTPS address unavailable'); }
    return { requests, errors,
      // Passed only to the disposable child. The parent process's trust and
      // environment remain unchanged; certificate verification stays enabled.
      environment: { JEV_CODE_PROVIDER: 'typesafe', TYPESAFE_BASE_URL: `https://127.0.0.1:${address.port}`,
        TYPESAFE_API_KEY: credential, TYPESAFE_DEFAULT_MODEL: DECISION_MODEL, NODE_EXTRA_CA_CERTS: cert, NODE_TLS_REJECT_UNAUTHORIZED: '1' },
      async close() {
        await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
      },
    };
  } catch (error) { server.closeAllConnections(); server.close(); throw error; }
}
