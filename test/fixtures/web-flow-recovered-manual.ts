/**
 * Manual acceptance against an isolated recovered operator database.
 *
 *   PARALLIX_HOME=/tmp/task-2836-iso npx tsx \
 *     test/fixtures/web-flow-recovered-manual.ts
 *
 * The fixture measures the same production projection used by the public host;
 * final acceptance also starts `px web` so the observer deadline is exercised.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { createProductionApplicationServices } from '../../src/composition/application-services.js';
import { createStatsMissionFlowReader } from '../../src/composition/stats.js';
import { resolveProcessConfiguration } from '../../src/composition/config.js';
import { selectStatsReport } from '../../src/application/services/statistics-report-selection.js';
import { createWebHost } from '../../src/interfaces/web/host.js';
import { loadWebAssets } from '../../src/adapters/web/asset-store.js';

type GeometryPoint = { readonly x: number; readonly y: number };
type GeometryRect = GeometryPoint & { readonly right: number; readonly bottom: number; readonly id: string };

function crosses(first: GeometryPoint, second: GeometryPoint, rect: GeometryRect): boolean {
  if (first.x === second.x) {
    return first.x > rect.x && first.x < rect.right
      && Math.max(Math.min(first.y, second.y), rect.y) < Math.min(Math.max(first.y, second.y), rect.bottom);
  }
  return first.y > rect.y && first.y < rect.bottom
    && Math.max(Math.min(first.x, second.x), rect.x) < Math.min(Math.max(first.x, second.x), rect.right);
}

const home = process.env.PARALLIX_HOME;
assert.ok(home, 'PARALLIX_HOME must name an isolated recovered operator home');
const databasePath = path.join(home, 'parallix.db');
const configuration = resolveProcessConfiguration();
const graph = await createProductionApplicationServices(process.cwd(), undefined, { configuration });
assert.ok(graph.presentationCapabilities, 'presentation capabilities unavailable');

const started = performance.now();
const projection = await graph.presentationCapabilities.boardProjection.build();
const buildMs = Math.round(performance.now() - started);
const flow = projection.metrics.flow;
assert.ok(flow, projection.metrics.flowUnavailable ?? 'FLOW projection unavailable');
if (process.env.FLOW_REQUIRE_UNREADABLE_OPERATION === '1') {
  const unreadable = /unreadable workflow operation row excluded from FLOW statistics/;
  assert.equal(flow.current.defects.some(diagnostic => unreadable.test(diagnostic)), false,
    'repository-wide unreadable history must not be copied onto every mission');
}
const statsMissions = await createStatsMissionFlowReader({ rootDir: process.cwd(), configuration, dbPath: databasePath })();
assert.ok(statsMissions, 'px stats Mission flow unavailable');
const statsFlow = selectStatsReport([], statsMissions, { mode: 'weekly', today: new Date() }).flowStatistics;
assert.ok(statsFlow, 'px stats shared FLOW projection unavailable');
for (const [period, board, stats] of [['current', flow.current, statsFlow.current], ['previous', flow.previous, statsFlow.previous]] as const) {
  assert.deepEqual({ rework: board.extraAgentLaunches.reworkJobs, agent: board.sendBacks.agent, human: board.sendBacks.human },
    { rework: stats.extraAgentLaunches.reworkJobs, agent: stats.sendBacks.agent, human: stats.sendBacks.human }, `${period} board FLOW differs from px stats`);
  for (const gate of ['declared-gates', 'integration-gates'] as const) {
    const outgoing = board.graph.edges.filter(edge => edge.from === gate);
    const displayed = outgoing.flatMap(edge => edge.percentage === null ? [] : [edge.percentage]);
    if (displayed.length > 0 && outgoing.some(edge => edge.share !== null && edge.share > 0)) {
      assert.equal(displayed.reduce((sum, value) => sum + value, 0), 100, `${period} ${gate} displayed outcomes do not total 100%`);
    }
    const node = board.graph.nodes.find(value => value.id === gate)!;
    const returned = outgoing.find(edge => edge.kind === 'gate-failed')!;
    if (node.observedMissions === 0 && returned.count > 0) { assert.equal(returned.share, null, `${period} ${gate} invents a return rate`); }
  }
  for (const resolve of ['pre-review-resolve', 'integration-resolve'] as const) {
    const outgoing = board.graph.edges.filter(edge => edge.from === resolve);
    if (outgoing.some(edge => edge.count > 0)) {
      assert.equal(outgoing.reduce((sum, edge) => sum + (edge.percentage ?? 0), 0), 100, `${period} ${resolve} displayed outcomes do not total 100%`);
    }
  }
  const returnArrows = board.graph.edges.filter(edge => edge.to === 'implement' && edge.kind !== 'flow');
  assert.equal(returnArrows.reduce((sum, edge) => sum + edge.count, 0), board.extraAgentLaunches.reworkJobs,
    `${period} return arrows do not reconcile to implementation rework`);
}

const db = new DatabaseSync(databasePath, { readOnly: true });
const recovered = db.prepare(`
  SELECT id, repository_id AS repositoryId, closed_at AS closedAt
  FROM missions
  WHERE status = 'done'
    AND repository_id = ?
    AND substr(closed_at, 1, 10) BETWEEN ? AND ?
  ORDER BY closed_at, id
`).all(projection.repositoryId, flow.current.startDate, flow.current.endDate) as Array<{
  readonly id: string;
  readonly repositoryId: string;
  readonly closedAt: string;
}>;
const rawRebases = db.prepare(`
  SELECT event_data AS eventData
  FROM operational_history
  WHERE event_type = 'flow.rebase'
    AND json_extract(event_data, '$.repositoryId') = ?
    AND json_extract(event_data, '$.missionId') = 'task-2845'
  ORDER BY json_extract(event_data, '$.occurredAt'), id
`).all(projection.repositoryId) as Array<{ readonly eventData: string }>;
const parsedRawRebases = rawRebases.map(row => JSON.parse(row.eventData)) as Array<{
  readonly stage: 'direct-rebase' | 'pre-review-rebase' | 'integration-rebase';
  readonly outcome: 'running' | 'no-op' | 'clean' | 'conflict' | 'resolved' | 'failed';
  readonly operationId: string;
  readonly sourceId: string;
}>;
db.close();
assert.equal(recovered.length, flow.current.completedMissions);
assert.ok(recovered.some(mission => mission.id === 'task-2845'), 'rebase outcome fixture task-2845 missing');
assert.equal(flow.current.graph.nodes.some(node => node.id === 'implement'), true);
assert.equal(flow.current.graph.edges.some(edge => edge.from === 'pre-review-rebase'
  && edge.to === 'pre-review-resolve' && edge.kind === 'rebase-conflict'), true);
if (process.env.FLOW_REQUIRE_CONFLICT === '1') {
  assert.ok(flow.current.graph.edges.some(edge => edge.kind === 'rebase-conflict' && edge.count > 0),
    'disposable conflict scenario did not reach the mounted FLOW projection');
}
const taskOutcomeObservation = statsMissions.find(mission => mission.mission === 'task-2845')?.flowObservation;
assert.ok(taskOutcomeObservation, 'production stats reader omitted task-2845 FLOW facts');
const outcomeStages = taskOutcomeObservation.rebaseStages;
type StageName = (typeof outcomeStages)[number]['stage'];
const stageFacts = (name: StageName) => outcomeStages.filter(value => value.stage === name);
const rejectedRebaseSources = new Set(taskOutcomeObservation.diagnostics
  .filter(diagnostic => diagnostic.kind === 'identity' && diagnostic.missionId === 'task-2845'
    && diagnostic.stage.endsWith('-rebase') && diagnostic.sourceId)
  .map(diagnostic => diagnostic.sourceId!));
const rawOutcomes = (name: StageName, operationId: string | null) => parsedRawRebases
  .filter(value => value.stage === name && value.operationId === operationId
    && value.outcome !== 'running' && !rejectedRebaseSources.has(value.sourceId))
  .map(value => value.outcome);
for (const name of ['pre-review-rebase', 'integration-rebase'] as const) {
  for (const fact of stageFacts(name)) { assert.deepEqual(fact.outcomes, rawOutcomes(name, fact.operationId)); }
}
assert.ok(parsedRawRebases.filter(value => value.outcome !== 'running' && rejectedRebaseSources.has(value.sourceId))
  .every(value => taskOutcomeObservation.diagnostics.some(diagnostic => diagnostic.kind === 'identity'
    && diagnostic.missionId === 'task-2845' && diagnostic.sourceId === value.sourceId)),
  'every excluded raw terminal has a scoped identity diagnostic');
for (const outcome of ['no-op', 'clean', 'conflict', 'resolved'] as const) {
  assert.ok(stageFacts('pre-review-rebase').flatMap(fact => fact.outcomes).includes(outcome),
    `pre-review ${outcome} outcome missing`);
}
assert.ok(stageFacts('pre-review-rebase').flatMap(fact => fact.outcomes)
  .filter(outcome => outcome === 'resolved').length >= 2,
  'repeated conflict resolutions were collapsed');
assert.ok(stageFacts('integration-rebase').flatMap(fact => fact.outcomes).includes('failed'),
  'integration failed outcome missing');
assert.ok(stageFacts('direct-rebase').some(fact => fact.state === 'interrupted'));
const inapplicableStage = statsMissions.flatMap(mission => mission.flowObservation?.rebaseStages ?? [])
  .find(value => value.state === 'inapplicable');
assert.ok(inapplicableStage, 'current projection lacks a typed inapplicable rebase stage');

const publicStats = spawnSync(process.execPath, [path.resolve('build/px.mjs'), 'stats'], {
  cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024,
});
assert.equal(publicStats.status, 0, publicStats.stdout + publicStats.stderr);
for (const visible of statsFlow.current.rebaseStages.visible) {
  assert.ok(publicStats.stdout.includes(`Rebase stage: ${visible.repositoryId}/${visible.missionId} ${visible.stage} ${visible.state}`),
    `public CLI omitted server-selected stage ${visible.missionId}/${visible.stage}/${visible.state}`);
}
assert.ok((publicStats.stdout.match(/^Rebase stage:/gm) ?? []).length <= 24,
  'public CLI emitted more than the bounded current/previous rebase detail');
assert.match(publicStats.stdout, /Rebase stages: \d+ additional stage facts not shown; incomplete states are listed first\./);

const host = createWebHost({
  assets: loadWebAssets(path.resolve('build/web')),
  buildProjection: async () => projection,
});
const info = await host.start();
const browser = await chromium.launch({
  executablePath: process.env.PARALLIX_CHROMIUM ?? '/usr/bin/chromium',
  headless: true,
  args: ['--disable-extensions'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1288, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(info.origin);
  await page.getByRole('button', { name: 'Flow', exact: true }).click();
  await page.locator('[data-flow-view]').waitFor();
  assert.match(await page.locator('[data-flow-view]').innerText(), new RegExp(`${flow.current.completedMissions} missions landed`));
  assert.match(await page.locator('[data-flow-view]').innerText(), new RegExp(`${flow.current.observation.complete} of ${flow.current.completedMissions} measured`));
  const rebaseText = await page.locator('[data-flow-region="rebase-provenance"]').textContent() ?? '';
  for (const visible of flow.current.rebaseStages.visible) {
    assert.ok(rebaseText.includes(`${visible.missionId} · ${visible.stage} · ${visible.state}`),
      `Flow panel omitted server-selected stage ${visible.missionId}/${visible.stage}/${visible.state}`);
  }
  if (flow.current.rebaseStages.omitted > 0) {
    assert.match(rebaseText, new RegExp(`${flow.current.rebaseStages.omitted} additional stage facts not shown`));
  }
  assert.equal(await page.locator('[data-flow-node]').count(), flow.current.graph.nodes.length);
  assert.ok(await page.locator('[data-flow-edge]').count() >= flow.current.graph.edges.filter(edge => edge.count > 0).length);
  assert.equal(await page.locator('[data-flow-time-row="unobserved"]').count(), 0);
  assert.deepEqual(await page.locator('[data-flow-node]').evaluateAll(nodes => nodes.flatMap(node => node.scrollHeight > node.clientHeight
    ? [`${node.getAttribute('data-flow-node')}:${node.scrollHeight}/${node.clientHeight}`] : [])), [], 'Flow node text is clipped');
  const firstPassDetail = page.locator('[data-flow-kpi="First-pass yield"] > div').last();
  assert.match(await firstPassDetail.innerText(), /(measured|first pass)$/);
  assert.deepEqual(await page.locator('[data-flow-kpi] > div:last-child').evaluateAll(details => details.flatMap(detail => detail.scrollWidth > detail.clientWidth
    ? [`${detail.parentElement?.getAttribute('data-flow-kpi')}:${detail.scrollWidth}/${detail.clientWidth}`] : [])), [], 'KPI detail overflows its card');
  if (process.env.FLOW_SCREENSHOT) { await page.screenshot({ path: process.env.FLOW_SCREENSHOT, fullPage: true }); }
  if (process.env.FLOW_TIME_SCREENSHOT) {
    await page.locator('[data-flow-region="time"]').scrollIntoViewIfNeeded();
    await page.locator('[data-flow-region="time"]').screenshot({ path: process.env.FLOW_TIME_SCREENSHOT });
  }

  const wide = await browser.newPage({ viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1 });
  await wide.goto(info.origin);
  await wide.getByRole('button', { name: 'Flow', exact: true }).click();
  await wide.locator('[data-flow-view]').waitFor();
  const inspectWideGeometry = () => wide.locator('[data-flow-region="graph"]').evaluate(root => {
    const returnId = 'integration-gates->implement:gate-failed';
    const group = root.querySelector<SVGGElement>(`[data-flow-edge="${returnId}"]`)!;
    const line = group.querySelector<SVGPolylineElement>('polyline')!, svg = line.ownerSVGElement!;
    const returnLabelElement = root.querySelector<HTMLElement>(`[data-flow-edge-label="${returnId}"]`)!, returnLabel = returnLabelElement.getBoundingClientRect();
    const labelElements = [...root.querySelectorAll<HTMLElement>('[data-flow-edge-label], [data-flow-edge-suffix]')];
    const blockers = [...root.querySelectorAll<HTMLElement>('[data-flow-node], [data-flow-edge-label], [data-flow-edge-suffix]')]
      .filter(element => { const rect = element.getBoundingClientRect(); return element !== returnLabelElement
        && returnLabel.left < rect.right && returnLabel.right > rect.left && returnLabel.top < rect.bottom && returnLabel.bottom > rect.top; })
      .map(element => element.getAttribute('data-flow-node') ?? element.getAttribute('data-flow-edge-label') ?? element.getAttribute('data-flow-edge-suffix'));
    const svgRect = svg.getBoundingClientRect();
    const points = Array.from({ length: line.points.numberOfItems }, (_, index) => line.points.getItem(index))
      .map(point => ({ x: svgRect.left + point.x, y: svgRect.top + point.y }));
    const elements = [...root.querySelectorAll<HTMLElement>('[data-flow-node], [data-flow-edge-label], [data-flow-edge-suffix]')]
      .flatMap(element => { const id = element.getAttribute('data-flow-node') ?? element.getAttribute('data-flow-edge-label')
          ?? element.getAttribute('data-flow-edge-suffix');
        if (id === 'implement' || id === 'integration-gates' || id === null) { return []; }
        const value = element.getBoundingClientRect();
        return [{ id, x: value.left, y: value.top, right: value.right, bottom: value.bottom }]; });
    const routes = [...root.querySelectorAll<SVGGElement>('[data-flow-edge]')].flatMap(edgeGroup => {
      const routeLine = edgeGroup.querySelector<SVGPolylineElement>('polyline'), id = edgeGroup.getAttribute('data-flow-edge');
      if (!routeLine || !id) { return []; }
      const routeSvg = routeLine.ownerSVGElement!.getBoundingClientRect();
      return [{ id, points: Array.from({ length: routeLine.points.numberOfItems }, (_, index) => routeLine.points.getItem(index))
        .map(point => ({ x: routeSvg.left + point.x, y: routeSvg.top + point.y })) }];
    });
    const labels = labelElements.flatMap(element => { const id = element.getAttribute('data-flow-edge-label') ?? element.getAttribute('data-flow-edge-suffix');
      if (!id) { return []; }
      const value = element.getBoundingClientRect();
      return [{ id, x: value.left, y: value.top, right: value.right, bottom: value.bottom }]; });
    const implementRect = root.querySelector<HTMLElement>('[data-flow-node="implement"]')!.getBoundingClientRect();
    return { points, elements, routes, labels, implement: { id: 'implement', x: implementRect.left, y: implementRect.top,
      right: implementRect.right, bottom: implementRect.bottom }, blockers,
      unrecordedOrigin: root.querySelectorAll('[data-flow-edge-origin="unrecorded->implement:workflow-return"]').length };
  });
  const routeLabelBlockers = (geometry: Awaited<ReturnType<typeof inspectWideGeometry>>) => geometry.routes.flatMap(route => geometry.labels
    .filter(label => label.id !== route.id && route.points.slice(1).some((point, index) => crosses(route.points[index]!, point, label)))
    .map(label => `${route.id} crosses label ${label.id}`));
  const wideGeometry = await inspectWideGeometry();
  assert.deepEqual(wideGeometry.blockers, [], 'integration return label overlaps graph content at 4K');
  const routeBlockers = wideGeometry.elements.filter(rect => wideGeometry.points.slice(1)
    .some((point, index) => crosses(wideGeometry.points[index]!, point, rect))).map(rect => rect.id);
  assert.deepEqual(routeBlockers, [], 'integration return route crosses graph content at 4K');
  const tip = wideGeometry.points.at(-1)!, implement = wideGeometry.implement;
  assert.ok(tip.x >= implement.x && tip.x <= implement.right && tip.y >= implement.y && tip.y <= implement.bottom,
    'integration return arrow does not land on Implement');
  assert.equal(wideGeometry.unrecordedOrigin, 1, 'unrecorded return lacks an explicit origin at 4K');
  const currentRouteLabelBlockers = routeLabelBlockers(wideGeometry);
  assert.deepEqual(currentRouteLabelBlockers, [], 'current Flow edge crosses a foreign edge label at 4K');
  await wide.getByRole('button', { name: 'Compare: previous week' }).click();
  const previousRouteLabelBlockers = routeLabelBlockers(await inspectWideGeometry());
  assert.deepEqual(previousRouteLabelBlockers, [], 'previous Flow edge crosses a foreign edge label at 4K');
  if (process.env.FLOW_WIDE_SCREENSHOT) { await wide.screenshot({ path: process.env.FLOW_WIDE_SCREENSHOT, fullPage: true }); }
  await wide.close();

  await page.getByRole('button', { name: 'Compare: previous week' }).click();
  assert.match(await page.locator('[data-flow-view]').innerText(), new RegExp(`${flow.previous.completedMissions} missions landed`));
  await page.getByRole('button', { name: 'Compare: previous week' }).click();

  const families: string[] = [];
  for (const family of flow.families) {
    families.push(family.family);
    await page.getByRole('button', { name: family.family, exact: true }).click();
    assert.equal(await page.getByRole('button', { name: family.family, exact: true }).getAttribute('aria-pressed'), 'true');
  }
  await page.getByRole('button', { name: 'All agents', exact: true }).click();
  await page.getByRole('button', { name: 'Longest first', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Longest first', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Mission order', exact: true }).click();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await page.getByRole('button', { name: 'Flow', exact: true }).click();

  const narrow = await browser.newPage({ viewport: { width: 640, height: 900 }, deviceScaleFactor: 1 });
  await narrow.goto(info.origin);
  await narrow.getByRole('button', { name: 'Flow', exact: true }).click();
  const overflow = await narrow.evaluate(() => ({
    body: document.body.scrollWidth - document.documentElement.clientWidth,
    controls: document.querySelector<HTMLElement>('[data-flow-region="controls"]')!.scrollWidth
      - document.querySelector<HTMLElement>('[data-flow-region="controls"]')!.clientWidth,
    graph: document.querySelector<HTMLElement>('[data-flow-region="graph"]')!.scrollWidth
      - document.querySelector<HTMLElement>('[data-flow-region="graph"]')!.clientWidth,
    time: document.querySelector<HTMLElement>('[data-flow-region="time"] [role="table"]')!.scrollWidth
      - document.querySelector<HTMLElement>('[data-flow-region="time"] [role="table"]')!.clientWidth,
  }));
  assert.equal(overflow.body, 0);
  assert.ok(overflow.controls > 0 && overflow.graph > 0 && overflow.time > 0);
  await narrow.close();

  console.log(JSON.stringify({
    result: 'FLOW DATA PATH PASS',
    interface: 'production projection, transport, public host, packaged assets, Chromium',
    isolatedDatabase: databasePath,
    buildMs,
    repositoryId: projection.repositoryId,
    recoveredWindow: { start: flow.current.startDate, end: flow.current.endDate },
    recoveredMissions: recovered.length,
    recoveredIdentities: recovered.slice(-6).map(mission => mission.id),
    publicCli: { command: 'px stats', rebaseLines: publicStats.stdout.split('\n').filter(line => line.startsWith('Rebase stage:')) },
    rebaseReconciliation: { stages: outcomeStages, rejectedRawSources: [...rejectedRebaseSources] },
    projected: {
      currentCompleted: flow.current.completedMissions,
      previousCompleted: flow.previous.completedMissions,
      nodes: flow.current.graph.nodes.map(node => node.id),
      observedEdges: flow.current.graph.edges.filter(edge => edge.count > 0).map(edge => `${edge.id}=${edge.count}`),
      emptyEdges: flow.current.graph.edges.filter(edge => edge.count === 0).map(edge => `${edge.id}=${edge.share}`),
      firstPassYield: flow.current.firstPassYield,
      rework: { total: flow.current.extraAgentLaunches.reworkJobs, mean: flow.current.extraAgentLaunches.reworkMeanPerMission },
      observedWork: { missions: flow.current.time.measuredMissions, totalMs: flow.current.time.totals.totalMs,
        largestLane: flow.current.time.largestLane },
      stateMedians: flow.current.stateDwell.map(state => ({ state: state.state, medianMs: state.medianMs, p90Ms: state.p90Ms, n: state.n })),
      families,
      defects: flow.current.defects,
    },
    controls: ['Board', 'Flow', 'All agents', ...families, 'Compare: previous week', 'Mission order', 'Longest first'],
    wideGeometry: { routeBlockers, routeLabelChecks: { current: currentRouteLabelBlockers, previous: previousRouteLabelBlockers },
      tip, implement, labelBlockers: wideGeometry.blockers,
      unrecordedOrigin: wideGeometry.unrecordedOrigin },
    narrowOverflow: overflow,
    liveStateMutations: 0,
  }, null, 2));
} finally {
  await browser.close();
  await host.close();
  await graph.operatorState.close();
}
