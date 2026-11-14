/**
 * Disposable production-host/Chromium exercise for the shared web projection.
 * It uses generated application projections only: no operator store, workflow
 * mutation, repository write, or external network access.
 */
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright-core';
import { agentFamily } from '../../src/domain/agents.js';
import { missionId } from '../../src/domain/mission.js';
import type { BoardProjection } from '../../src/application/projections/board.js';
import { createWebHost } from '../../src/interfaces/web/host.js';
import {
  toWebMissionDetail,
  validateWebBoardSnapshot,
  type WebBoardSnapshot,
  type WebMissionDetail,
  type WebMissionCard,
} from '../../src/interfaces/web/transport.js';
import { loadWebAssets } from '../../src/adapters/web/asset-store.js';
import { makeCard, makeProjection } from './board-projection.js';

const CLIENTS = 2;
const CARD_COUNT = 12;
const CHECKPOINTS_PER_CARD = 6;
const REVIEW_ROUNDS_PER_CARD = 4;

function projection(generation: number): BoardProjection {
  const cards = Array.from({ length: CARD_COUNT }, (_unused, cardIndex) => {
    const id = missionId(`task-manual-${String(cardIndex + 1).padStart(4, '0')}`);
    return makeCard({
      id,
      title: cardIndex === 0 ? `Shared projection generation ${generation}` : `Populated mission ${cardIndex + 1}`,
      lane: 'review', status: 'review', checkpoint: 'CP-3.md', checkpointDescription: 'Exercise shared browser delivery',
      gate: 'passed', reviewRound: REVIEW_ROUNDS_PER_CARD, reviewPhase: 'reviewing', reviewDisposition: 'REQUEST_CHANGES',
      checkpointEvidence: Array.from({ length: CHECKPOINTS_PER_CARD }, (_entry, checkpointIndex) => ({
        name: `CP-${checkpointIndex + 1}`,
        description: `Checkpoint ${checkpointIndex + 1} for populated mission ${cardIndex + 1}`,
        state: checkpointIndex < 2 ? 'completed' as const : checkpointIndex === 2 ? 'current' as const : 'future' as const,
        goalCheck: Array.from({ length: 3 }, (_row, rowIndex) => ({
          criterion: `criterion-${cardIndex + 1}-${checkpointIndex + 1}-${rowIndex + 1}-${'c'.repeat(48)}`,
          evidence: `checkpoint-evidence-card-${cardIndex + 1}-row-${checkpointIndex + 1}-${rowIndex + 1}-${'e'.repeat(96)}`,
        })),
      })),
      reviewHistory: Array.from({ length: REVIEW_ROUNDS_PER_CARD }, (_entry, roundIndex) => ({
        number: roundIndex + 1,
        reviewer: agentFamily('codex'), implementer: agentFamily('custom'), phase: 'reviewing',
        disposition: roundIndex === REVIEW_ROUNDS_PER_CARD - 1 ? 'REQUEST_CHANGES' as const : 'COMMENT' as const,
        comment: `review-comment-card-${cardIndex + 1}-round-${roundIndex + 1}-${'r'.repeat(96)}`,
        findingSummaries: [`finding-card-${cardIndex + 1}-round-${roundIndex + 1}-${'f'.repeat(96)}`],
        pushbacks: [`pushback-${cardIndex + 1}-${roundIndex + 1}-${'p'.repeat(64)}`],
        fixes: [`fix-${cardIndex + 1}-${roundIndex + 1}-${'x'.repeat(64)}`],
      })),
    });
  });
  return makeProjection({ review: cards }, 'manual-web-projection');
}

async function waitFor(description: string, predicate: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) { throw new Error(`Timed out waiting for ${description}`); }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

async function waitForCard(page: Page, title: string) {
  await page.getByText(title, { exact: true }).waitFor({ timeout: 10_000 });
}

function legacyCommonSnapshot(snapshot: WebBoardSnapshot, source: BoardProjection): unknown {
  const detailById = new Map<string, WebMissionDetail>(
    source.stages.flatMap(stage => [...stage.cards, ...stage.historyCards ?? []])
      .map(card => [card.id, toWebMissionDetail(source, card.id, snapshot.freshness)] as const),
  );
  const enrich = (card: WebMissionCard) => {
    const detail = detailById.get(card.id)!;
    return { ...card, checkpointEvidence: detail.checkpointEvidence, reviewHistory: detail.reviewHistory };
  };
  return {
    ...snapshot,
    stages: snapshot.stages.map(stage => ({ ...stage, cards: stage.cards.map(enrich),
      ...(stage.historyCards === undefined ? {} : { historyCards: stage.historyCards.map(enrich) }) })),
  };
}

let current = projection(1);
let builds = 0;
let failRefresh = false;
let scheduledTick: (() => void) | null = null;

function takeScheduledTick(description: string): () => void {
  const tick = scheduledTick;
  assert.ok(tick, description);
  scheduledTick = null;
  return tick;
}

const host = createWebHost({
  assets: loadWebAssets('build/web'),
  buildProjection: () => {
    builds += 1;
    if (failRefresh) { throw new Error('disposable refresh failure'); }
    return Promise.resolve(current);
  },
  subscription: {
    intervalMs: 1,
    idleIntervalMs: 1,
    setTimer: callback => { scheduledTick = callback; return callback; },
    clearTimer: () => { scheduledTick = null; },
  },
});

const info = await host.start();
const browser = await chromium.launch({
  executablePath: process.env.PARALLIX_CHROMIUM ?? '/usr/bin/chromium',
  headless: true,
  args: ['--disable-extensions'],
});
const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
let unavailableHost: ReturnType<typeof createWebHost> | null = null;

try {
  const pages: Page[] = [];
  for (let index = 0; index < CLIENTS; index += 1) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
  }
  await Promise.all(pages.map(page => page.goto(info.origin)));
  await Promise.all(pages.map(page => waitForCard(page, 'Shared projection generation 1')));
  await waitFor('two SSE clients', () => host.clientCount() === CLIENTS);
  assert.equal(builds, 1, 'all initial browser reads reuse one completed projection');

  const response = await fetch(`${info.origin}/api/board`);
  const currentBody = await response.text();
  const validation = validateWebBoardSnapshot(JSON.parse(currentBody));
  assert.ok(validation.ok);
  if (!validation.ok) { throw new Error('representative snapshot did not validate'); }
  const snapshot = validation.value;
  const legacyBody = JSON.stringify(legacyCommonSnapshot(snapshot, current));
  assert.ok(Buffer.byteLength(currentBody) < Buffer.byteLength(legacyBody));
  assert.doesNotMatch(currentBody, /checkpoint-evidence-card-|review-comment-card-|finding-card-/);

  const firstId = current.stages.find(stage => stage.lane === 'review')!.cards[0]!.id;
  const detailResponse = await fetch(`${info.origin}/api/board/${firstId}/detail`);
  const detailBody = await detailResponse.text();
  assert.match(detailBody, /checkpoint-evidence-card-1-row-3-1/);
  assert.match(detailBody, /review-comment-card-1-round-1/);
  assert.equal(builds, 1, 'HTTP snapshot and detail reads retain the completed projection');

  const firstPage = pages[0]!;
  const firstCard = firstPage.locator(`[data-board-card="${firstId}"]`);
  await firstCard.getByRole('button', { name: /View checkpoint evidence/ }).click();
  const checkpointDialog = firstPage.getByRole('dialog', { name: `Checkpoint evidence for ${firstId}` });
  await checkpointDialog.getByText(/checkpoint-evidence-card-1-row-3-1/).waitFor();
  await firstPage.keyboard.press('Escape');
  let detailRequests = 0;
  firstPage.on('request', request => { if (new URL(request.url()).pathname.endsWith('/detail')) { detailRequests += 1; } });
  await firstCard.getByRole('button', { name: `View review history for ${firstId}` }).click();
  const reviewDialog = firstPage.getByRole('dialog', { name: `Review history for ${firstId}` });
  await reviewDialog.getByText(/review-comment-card-1-round-1/).waitFor();
  assert.equal(builds, 1, 'browser disclosures use on-demand detail without rebuilding');
  assert.equal(detailRequests, 1, 'the opened review disclosure reads its deferred payload once');

  const ipcPayloadBytes = Buffer.byteLength(JSON.stringify({ id: 1, value: current }));
  const buildsBeforeDetection = builds;
  current = projection(2);
  const tick = takeScheduledTick('change detector tick is scheduled');
  tick();
  await Promise.all(pages.map(page => waitForCard(page, 'Shared projection generation 2')));
  const detectedChangeBuilds = builds - buildsBeforeDetection;
  assert.equal(detectedChangeBuilds, 1, 'one detector completion serves both browser refetches');
  await reviewDialog.getByText(/review-comment-card-1-round-1/).waitFor();
  assert.equal(detailRequests, 1, 'an open disclosure retains detail across unrelated projection revisions');
  await firstPage.keyboard.press('Escape');
  const oldIpcBytes = ipcPayloadBytes * (1 + CLIENTS);
  const currentIpcBytes = ipcPayloadBytes * detectedChangeBuilds;

  let releaseSnapshotRead!: () => void;
  let snapshotReadStarted!: () => void;
  let snapshotReadFinished!: () => void;
  const snapshotReadRelease = new Promise<void>(resolve => { releaseSnapshotRead = resolve; });
  const snapshotReadStart = new Promise<void>(resolve => { snapshotReadStarted = resolve; });
  const snapshotReadFinish = new Promise<void>(resolve => { snapshotReadFinished = resolve; });
  await firstPage.route(`${info.origin}/api/board`, async route => {
    snapshotReadStarted();
    await snapshotReadRelease;
    await route.continue();
    snapshotReadFinished();
  });
  current = projection(3);
  const racingTick = takeScheduledTick('detail-race detector tick is scheduled');
  racingTick();
  await snapshotReadStart;
  await firstPage.locator(`[data-board-card="${firstId}"]`).getByRole('button', { name: `View review history for ${firstId}` }).click();
  const racingDialog = firstPage.getByRole('dialog', { name: `Review history for ${firstId}` });
  await waitFor('one-build-ahead detail read', () => detailRequests === 2);
  assert.doesNotMatch(await racingDialog.textContent() ?? '', /Review history unavailable/);
  releaseSnapshotRead();
  await snapshotReadFinish;
  await firstPage.unroute(`${info.origin}/api/board`);
  await Promise.all(pages.map(page => waitForCard(page, 'Shared projection generation 3')));
  await racingDialog.getByText(/review-comment-card-1-round-1/).waitFor();
  await waitFor('bounded detail retry', () => detailRequests === 3);
  assert.doesNotMatch(await racingDialog.textContent() ?? '', /Review history unavailable/);
  await firstPage.keyboard.press('Escape');

  failRefresh = true;
  const failingTick = takeScheduledTick('failure detector tick is scheduled');
  failingTick();
  await Promise.all(pages.map(page => page.locator('[data-board-freshness="stale"]')
    .getByText(/disposable refresh failure/).waitFor({ timeout: 10_000 })));
  const staleResponse = await fetch(`${info.origin}/api/board`);
  const stale = await staleResponse.json() as WebBoardSnapshot;
  assert.equal(stale.freshness.state, 'stale');
  assert.equal(stale.freshness.reason, 'disposable refresh failure');
  await Promise.all(pages.map(page => waitForCard(page, 'Shared projection generation 3')));

  failRefresh = false;
  const recoveryTick = takeScheduledTick('recovery detector tick is scheduled');
  recoveryTick();
  await Promise.all(pages.map(page => waitForCard(page, 'Shared projection generation 3')));
  await Promise.all(pages.map(page => waitFor('freshness banner to clear', async () =>
    await page.locator('[data-board-freshness="stale"]').count() === 0)));

  const buildsBeforeReconnect = builds;
  await pages[0]!.close();
  await waitFor('one browser to detach', () => host.clientCount() === CLIENTS - 1);
  pages[0] = await contexts[0]!.newPage();
  await pages[0]!.goto(info.origin);
  await waitForCard(pages[0]!, 'Shared projection generation 3');
  await waitFor('disconnected browser to reconnect', () => host.clientCount() === CLIENTS);
  assert.equal(builds, buildsBeforeReconnect, 'reconnected browser reuses the retained fresh projection');

  unavailableHost = createWebHost({
    assets: loadWebAssets('build/web'),
    buildProjection: async () => { throw new Error('disposable initial unavailability'); },
  });
  const unavailableInfo = await unavailableHost.start();
  const unavailableContext = await browser.newContext();
  contexts.push(unavailableContext);
  const unavailablePage = await unavailableContext.newPage();
  await unavailablePage.goto(unavailableInfo.origin);
  await unavailablePage.getByText('▲ SNAPSHOT REQUEST FAILED', { exact: true }).waitFor({ timeout: 10_000 });
  assert.equal(await unavailablePage.locator('[data-board-card]').count(), 0, 'unavailable initial projection fabricates no board');
  const unavailableResponse = await fetch(`${unavailableInfo.origin}/api/board`);
  assert.equal(unavailableResponse.status, 503);

  const currentHttpBytes = Buffer.byteLength(currentBody);
  const oldHttpBytes = Buffer.byteLength(legacyBody);
  console.log(JSON.stringify({
    clients: CLIENTS, cards: CARD_COUNT, checkpointsPerCard: CHECKPOINTS_PER_CARD, reviewRoundsPerCard: REVIEW_ROUNDS_PER_CARD,
    completedProjectionBuilds: { initial: 1, detectedChange: detectedChangeBuilds },
    ipc: { representativePayloadBytes: ipcPayloadBytes, priorCycleBytes: oldIpcBytes, sharedCycleBytes: currentIpcBytes,
      decreaseBytes: oldIpcBytes - currentIpcBytes, decreasePercent: Number((100 * (oldIpcBytes - currentIpcBytes) / oldIpcBytes).toFixed(1)) },
    http: { priorCommonSnapshotBytes: oldHttpBytes, slimCommonSnapshotBytes: currentHttpBytes,
      decreaseBytes: oldHttpBytes - currentHttpBytes, decreasePercent: Number((100 * (oldHttpBytes - currentHttpBytes) / oldHttpBytes).toFixed(1)),
      firstMissionDetailBytes: Buffer.byteLength(detailBody) },
    residualCommonPayload: ['card display summaries and actions', 'board metrics and operation log', 'source facts', 'transport identity and freshness'],
    observed: ['two isolated browser contexts', 'shared refresh', 'checkpoint and review detail on demand',
      'open detail retained across revision churn', 'one-build-ahead detail retry', 'stale reason',
      'same-revision stale recovery', 'initial unavailable state', 'disconnect and reconnect revalidation'],
  }));
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await waitFor('all SSE clients to detach', () => host.clientCount() === 0);
  await unavailableHost?.close();
  await host.close();
  await browser.close();
  assert.equal(host.clientCount(), 0);
  assert.equal(unavailableHost?.clientCount() ?? 0, 0);
  console.log('PASS: production host browser clients detached and both disposable hosts closed');
}
