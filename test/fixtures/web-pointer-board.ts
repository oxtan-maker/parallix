import { build } from 'esbuild';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { makeCard, makeProjection } from './board-projection.js';
import { toWebBoardSnapshot } from '../../src/interfaces/web/transport.js';
import { missionId } from '../../src/domain/mission.js';
import type { WebCommandRequest } from '../../src/interfaces/web/transport.js';
import { fixtureMission } from './mission-builders.js';
import { availableBoardCommands } from '../../src/application/projections/mission-board.js';

export function compactPointerSnapshot(lane: 'backlog' | 'refined' | 'active' | 'review' | 'integration') {
  const mission = fixtureMission('task-pointer-disposable', { status: lane, checkpoints: [] });
  const card = makeCard({ id: mission.id, title: 'Disposable pointer mission', lane, status: lane,
    commands: availableBoardCommands(mission, { reviewApproval: null }) });
  return toWebBoardSnapshot(makeProjection({ [lane]: [card] }));
}

export async function pointerBoard(onCommand?: (request: WebCommandRequest) => Promise<void>) {
  const bundled = await build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {Board} from './web/src/board';
      import './web/src/style.css';
      const root = createRoot(document.getElementById('root'));
      let boardKey = 0;
      window.renderBoard = (snapshot, reset = false) => { if (reset) boardKey++; root.render(React.createElement(Board, {key: boardKey, snapshot, onRefresh: async () => {}})); };
      const events = new EventSource('/events');
      events.onmessage = (event) => window.renderBoard(JSON.parse(event.data));
    `, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, outdir: 'assets', define: { 'process.env.NODE_ENV': '"production"' },
  });
  const js = bundled.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const css = bundled.outputFiles.find((file) => file.path.endsWith('.css'))!.text;
  const requests: unknown[] = [];
  let release: (() => void) | undefined;
  let responseDelay: Promise<void> | undefined;
  const streams = new Set<import('node:http').ServerResponse>();
  const server = createServer(async (req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': connected\n\n');
      streams.add(res); req.on('close', () => streams.delete(res)); return;
    }
    if (req.method === 'POST') {
      let body = ''; for await (const part of req) { body += part; }
      const command = JSON.parse(body) as WebCommandRequest;
      requests.push(command);
      await responseDelay;
      try { await onCommand?.(command); }
      catch (error) { res.writeHead(500); res.end(JSON.stringify({error: String(error)})); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({kind: 'command-result', transportVersion: 2, status: 'completed', value: null, error: null, durableEvidence: []})); return;
    }
    res.setHeader('content-type', req.url === '/board.js' ? 'text/javascript' : req.url === '/board.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/board.js' ? js : req.url === '/board.css' ? css : '<link rel="stylesheet" href="/board.css"><div id="root"></div><script src="/board.js"></script>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try { browser = await chromium.launch({ executablePath: process.env.PARALLIX_CHROMIUM ?? '/usr/bin/chromium', headless: true, timeout: 5000 }); }
  catch (error) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); throw error; }
  let closePromise: Promise<void> | undefined;
  const close = () => closePromise ??= (async () => {
    release?.();
    try { await browser.close(); }
    finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  })();
  const openPage = async () => {
    const page = await browser.newPage({ viewport: {width: 1600, height: 700} });
    page.setDefaultTimeout(3000);
    await page.goto(`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`);
    await page.waitForFunction(() => 'renderBoard' in window);
    return page;
  };
  const page = await openPage().catch(async (error: unknown) => { await close(); throw error; });
  return {
    page, requests, assetHash: createHash('sha256').update(js).digest('hex'),
    hold() { responseDelay = new Promise<void>((resolve) => { release = resolve; }); },
    release() { release?.(); responseDelay = undefined; },
    async render(snapshot: ReturnType<typeof toWebBoardSnapshot>, sse = false) {
      if (sse) { for (const stream of streams) { stream.write(`data: ${JSON.stringify(snapshot)}\n\n`); } }
      else { await page.evaluate((value) => (window as unknown as {renderBoard: (s: unknown, reset: boolean) => void}).renderBoard(value, true), snapshot); }
      await page.waitForTimeout(30);
    },
    close,
  };
}

export function pointerSnapshot(lane: 'backlog' | 'refined' | 'active' | 'review' | 'integration', commands = ['active', 'draft', 'handoff', 'review', 'integrate', 'cancel'], work: 'idle' | 'running' | 'unverified' | 'stale' | 'stopped' = 'idle') {
  const card = makeCard({
    id: missionId('task-pointer-disposable'), title: 'Disposable pointer mission', lane,
    status: lane, currentWork: ['running', 'unverified', 'stale'].includes(work) ? { operationId: 'pointer-operation', phase: 'execute', summary: 'running', agent: null, updatedAt: '2026-10-09T00:00:00Z', freshness: work === 'running' ? 'live' : work === 'unverified' ? 'unverified' : 'stale' } : null,
    blockingReason: work === 'stopped' ? 'blocked fixture' : null,
    commands: commands.map((command) => ({command, enabled: true, reason: null, targetLane: null})) as NonNullable<Parameters<typeof makeCard>[0]>['commands'],
  });
  return toWebBoardSnapshot(makeProjection({ [lane]: [card] }));
}
