import { build } from 'esbuild';
// Browser fixture bootstrapping installs these globals before a page is returned.
declare global {
  interface Window {
    unsafeDrag: boolean;
    boardInput: { downs: number; ups: number; kind: string | null };
    boardRenders: number;
    renderBoard: (_snapshot: unknown, _reset: boolean) => void;
  }
}

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

// Only immutable browser assets are shared. Each case still owns its browser,
// server, page and command state, including teardown and waited-child CPU.
let assets: Promise<{ js: string; css: string }> | undefined;

function pointerAssets() {
  return assets ??= build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {Board} from './web/src/board';
      import './web/src/style.css';
      const root = createRoot(document.getElementById('root'));
      let boardKey = 0;
      window.boardRenders = 0;
      // flushSync commits the refreshed DOM before the counter advances, so a
      // caller can wait for the applied projection instead of guessing a settle
      // time. Without it the counter only proved the frame was received.
      window.renderBoard = (snapshot, reset = false) => { if (reset) boardKey++; flushSync(() => root.render(React.createElement(Board, {key: boardKey, snapshot, onRefresh: async () => {}}))); window.boardRenders++; };
      // A coordinate press is dispatched through the browser process, so issuing
      // it does not prove the page has processed it. On a loaded runner the
      // pointerdown could land after an SSE refresh had already committed, which
      // turns a press meant for the pre-refresh control into an ordinary click on
      // the refreshed board. These counters make the press observable.
      window.boardInput = { downs: 0, ups: 0, kind: null };
      document.addEventListener('pointerdown', (event) => {
        const button = event.target && event.target.closest ? event.target.closest('button[data-action-kind]') : null;
        window.boardInput.downs++;
        window.boardInput.kind = button ? button.dataset.actionKind : null;
      }, true);
      document.addEventListener('pointerup', () => { window.boardInput.ups++; }, true);
      // Two frames plus a macrotask is the point past which the release's
      // synthesised click (when there is one) and React's commit have landed.
      window.boardSettled = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(true), 0))));
      const events = new EventSource('/events');
      events.onmessage = (event) => window.renderBoard(JSON.parse(event.data));
    `, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, minify: true, write: false, outdir: 'assets', external: ['/fonts/*'], define: { 'process.env.NODE_ENV': '"production"' },
  }).then(bundled => ({
    js: bundled.outputFiles.find((file) => file.path.endsWith('.js'))!.text,
    css: bundled.outputFiles.find((file) => file.path.endsWith('.css'))!.text,
  }));
}

export async function pointerBoard(onCommand?: (request: WebCommandRequest) => Promise<void>) {
  const { js, css } = await pointerAssets();
  const requests: unknown[] = [];
  let release: (() => void) | undefined;
  let responseDelay: Promise<void> | undefined;
  const streams = new Set<import('node:http').ServerResponse>();
  const server = createServer(async (req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      streams.add(res); res.write(': connected\n\n');
      req.on('close', () => streams.delete(res)); return;
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
  try { browser = await chromium.launch({ args: ['--disable-extensions'], executablePath: process.env.PARALLIX_CHROMIUM ?? '/usr/bin/chromium', headless: true, timeout: 5000 }); }
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
    /** Press at a coordinate and wait until the page has processed the press. */
    async press(x: number, y: number, kind: string | null = null) {
      await page.mouse.move(x, y);
      const seen = await page.evaluate(() => window.boardInput.downs);
      await page.mouse.down();
      await page.waitForFunction(([previous, expected]: [number, string | null]) => {
        const state = window.boardInput;
        return state.downs > previous && (expected === null || state.kind === expected);
      }, [seen, kind] as [number, string | null], { timeout: 5000 });
    },
    /** Release and wait until the page has processed it and settled. */
    async releasePress() {
      const seen = await page.evaluate(() => window.boardInput.ups);
      await page.mouse.up();
      await page.waitForFunction((previous: number) => window.boardInput.ups > previous, seen, { timeout: 5000 });
      await page.evaluate('window.boardSettled()');
    },
    async render(snapshot: ReturnType<typeof toWebBoardSnapshot>, sse = false) {
      const applied = await page.evaluate(() => window.boardRenders);
      if (sse) {
        // A frame can only land once the page's EventSource is registered.
        const connected = Date.now() + 3000;
        while (streams.size === 0 && Date.now() < connected) { await new Promise((resolve) => setTimeout(resolve, 20)); }
        for (const stream of streams) { stream.write(`data: ${JSON.stringify(snapshot)}\n\n`); }
      }
      else { await page.evaluate((value) => window.renderBoard(value, true), snapshot); }
      // An SSE frame is delivered asynchronously. The previous fixed 30 ms sleep
      // left a loaded runner on the pre-refresh DOM, so a coordinate press held
      // across a refresh still activated the control that refresh had removed.
      // Wait for the committed projection instead: the press precondition is now
      // observable, and every assertion in the pointer contracts is unchanged.
      await page.waitForFunction((previous: number) => window.boardRenders > previous, applied, { timeout: 5000 });
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
