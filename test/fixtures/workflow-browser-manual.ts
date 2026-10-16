// Disposable manual Chromium observation using existing tooling, no operator data.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { probeProcessLiveness } from '../../src/adapters/process/process-liveness.js';
import { chromium } from 'playwright-core';
import { workflowBoard, until } from './workflow-board.js';
import { WEB_CSRF_META_NAME } from '../../src/interfaces/web/host.js';

const fixture = await workflowBoard(10);
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
try {
  let host = await fixture.start(true);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const events: Array<{ event: string; time: number; missionId?: string }> = [];
  page.on('request', request => { if (request.url().endsWith('/api/commands')) { events.push({ event: 'request', time: Date.now(), missionId: request.postDataJSON().missionId }); } });
  page.on('response', response => { if (response.url().endsWith('/api/board')) { events.push({ event: 'snapshot-response', time: Date.now() }); } });
  await page.addInitScript(() => {
    const requests: Array<{ missionId: string; time: number }> = [];
    (window as unknown as { workflowRequests: typeof requests }).workflowRequests = requests;
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).endsWith('/api/commands') && typeof init?.body === 'string') {
        requests.push({ missionId: JSON.parse(init.body).missionId, time: Date.now() });
      }
      return fetch(input, init);
    };
    const renders: Array<{ missionId: string; time: number }> = [];
    (window as unknown as { workflowRenders: typeof renders }).workflowRenders = renders;
    const seen = new Set<string>();
    new MutationObserver(() => {
      for (const card of document.querySelectorAll<HTMLElement>('[data-board-card]')) {
        const missionId = card.dataset.boardCard!;
        if (!seen.has(missionId) && card.textContent?.includes('preparing')) {
          seen.add(missionId); renders.push({ missionId, time: Date.now() });
        }
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
    const Native = window.EventSource;
    (window as unknown as { workflowNotifications: number[] }).workflowNotifications = [];
    window.EventSource = class extends Native {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        this.addEventListener('invalidate', () => (window as unknown as { workflowNotifications: number[] }).workflowNotifications.push(Date.now()));
      }
    };
  });
  await page.goto(host.origin);
  await page.locator(`[data-board-card="${fixture.slugs[0]}"]`).waitFor();
  const requestAt = Date.now();
  const acceptance = page.waitForResponse(response => response.url().endsWith('/api/commands'));
  await page.locator(`[data-board-card="${fixture.slugs[0]}"] [data-action-kind="active:execute"][aria-disabled="false"]`).last().click();
  const response = await acceptance; const firstAcknowledgedAt = Date.now(); assert.equal(response.status(), 202);
  const first = await response.json();
  const firstOperation = first.value.operationId as string;
  const committed = await fixture.store.load(fixture.slugs[0] as never);
  assert.equal(committed.kind === 'found' && committed.mission.status, 'active');
  const firstPersistedAt = Date.now();
  events.push({ event: 'commit-observed', time: firstPersistedAt });
  await page.waitForFunction(slug => document.querySelector(`[data-board-card="${slug}"]`)?.textContent?.includes('preparing'), fixture.slugs[0]);
  const visibleAt = Date.now(); events.push({ event: 'active-preparing-rendered', time: visibleAt });
  await until(() => fixture.entered(fixture.slugs[0]), 'first held gate');
  const ack: number[] = [firstAcknowledgedAt - requestAt];
  const persisted: number[] = [firstPersistedAt - requestAt];
  const visible: number[] = [visibleAt - requestAt];
  const ids = [firstOperation];
  for (const slug of fixture.slugs.slice(1)) {
    const started = Date.now();
    const result = await page.evaluate(async ({ slug, meta }) => {
      const csrf = document.querySelector<HTMLMetaElement>(`meta[name="${meta}"]`)!.content;
      const start = performance.now();
      const response = await fetch('/api/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-px-csrf': csrf },
        body: JSON.stringify({ missionId: slug, kind: 'active:execute', missionStatusAtRequest: 'refined', requestKey: crypto.randomUUID() }) });
      return { status: response.status, body: await response.json(), elapsed: performance.now() - start };
    }, { slug, meta: WEB_CSRF_META_NAME });
    assert.equal(result.status, 202); ack.push(result.elapsed); ids.push(result.body.value.operationId);
    const loaded = await fixture.store.load(slug as never);
    assert.equal(loaded.kind === 'found' && loaded.mission.status, 'active'); persisted.push(Date.now() - started);
    await page.waitForFunction(slug => document.querySelector(`[data-board-card="${slug}"]`)?.textContent?.includes('preparing'), slug);
    visible.push(Date.now() - started);
  }
  const rendered = await page.evaluate(() => (window as unknown as { workflowRenders: Array<{ missionId: string; time: number }> }).workflowRenders);
  const browserRequests = await page.evaluate(() => (window as unknown as { workflowRequests: Array<{ missionId: string; time: number }> }).workflowRequests);
  const initialNotifications = await page.evaluate(() => (window as unknown as { workflowNotifications: number[] }).workflowNotifications);
  const ordering = fixture.slugs.map((slug, index) => {
    const request = browserRequests.find(event => event.missionId === slug)!;
    const commit = fixture.hostEvents.find(event => event.operationId === ids[index])!;
    const render = rendered.find(event => event.missionId === slug)!;
    assert.ok(commit && render, `commit and render evidence for ${slug}`);
    assert.ok(commit.time >= request.time, `${slug}: commit follows request`);
    assert.ok(render.time >= commit.time, `${slug}: render follows committed admission`);
    const notifiedAt = initialNotifications.find(time => time >= commit.time && time <= render.time);
    assert.ok(notifiedAt, `${slug}: invalidation received after commit before render`);
    return { missionId: slug, operationId: ids[index], requestedAt: request.time, committedAt: commit.time, notifiedAt, renderedAt: render.time };
  });
  const originalHostPid = host.processId;
  await page.reload();
  await page.locator(`[data-board-card="${fixture.slugs[0]}"] [data-action-kind="workflow:stop"]`).waitFor();
  const ownerBefore = (await fixture.service.operation(firstOperation))?.owner;
  host = await fixture.start(true); await fixture.service.recover();
  await page.goto(host.origin);
  await page.locator(`[data-board-card="${fixture.slugs[0]}"] [data-action-kind="workflow:stop"]`).waitFor();
  assert.notEqual(host.processId, originalHostPid);
  assert.ok(ownerBefore);
  assert.equal(probeProcessLiveness(ownerBefore.pid, ownerBefore.identity), true);
  assert.deepEqual((await fixture.service.operation(firstOperation))?.owner, ownerBefore);
  const stopped = page.waitForResponse(response => response.url().endsWith('/api/commands'));
  await page.locator(`[data-board-card="${fixture.slugs[0]}"] [data-action-kind="workflow:stop"]`).click();
  assert.equal((await stopped).status(), 200);
  assert.equal((await fixture.service.operation(firstOperation))?.phase, 'stopped');
  assert.equal((await fixture.store.load(fixture.slugs[0] as never)).kind, 'found');
  await page.locator(`[data-board-card="${fixture.slugs[0]}"] [data-action-kind="active:execute"][aria-disabled="false"]`).last().waitFor();
  const restarted = page.waitForResponse(response => response.url().endsWith('/api/commands'));
  await page.locator(`[data-board-card="${fixture.slugs[0]}"] [data-action-kind="active:execute"][aria-disabled="false"]`).last().click();
  const restartedResponse = await restarted; assert.equal(restartedResponse.status(), 202);
  const replacement = (await restartedResponse.json()).value.operationId as string;
  for (const slug of fixture.slugs) { fixture.release(slug); }
  for (const id of [...ids.slice(1), replacement]) { await until(async () => (await fixture.service.operation(id))?.phase === 'completed', `completion ${id}`); }
  const retained = await fixture.observation.terminal.search(fixture.slugs[0], { pattern: 'REVIEW-OUTPUT' });
  assert.ok('hits' in retained && retained.hits.length > 0);
  const notifications = await page.evaluate(() => (window as unknown as { workflowNotifications: number[] }).workflowNotifications);
  const evidence = { result: 'PASS', recordedAt: new Date().toISOString(),
    timingMethod: 'Browser fetch initiation; fixture IPC immediately after committed admission transaction; browser SSE invalidation reception; MutationObserver first preparing text. Invalidation events carry no operation ID, so notification association is temporal.',
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirtyPaths: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    isolation: { temporaryRepository: true, temporaryDatabase: true, realModelProviders: false, realHttpHostProcesses: true, chromium: '/usr/bin/chromium' },
    originalHostPid, restartedHostPid: host.processId, ownerBefore,
    commitEvents: fixture.hostEvents, initialNotifications, ordering,
    browserRenderLatencyMs: ordering.map(event => event.renderedAt - event.requestedAt),
    firstVisibleMs: visibleAt - requestAt, acknowledgementMs: ack, persistedObservedMs: persisted, visibleMs: visible, events, notifications,
    hostRestartPreservedOwner: true, stopPreservedMission: true, replacementCompleted: true, retainedReviewOutput: true };
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); await fixture.close(); }
