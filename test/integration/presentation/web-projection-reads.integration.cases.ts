import test from 'node:test';
import assert from 'node:assert/strict';
import type { BoardProjection } from '../../../src/application/projections/board.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { WEB_MISSION_DETAIL_PATH, WEB_SNAPSHOT_PATH } from '../../../src/interfaces/web/host.js';
import { validateWebBoardSnapshot, validateWebMissionDetail } from '../../../src/interfaces/web/transport.js';
import { makeCards, makeProjection } from '../../fixtures/board-projection.js';
import { manualTimers, withHost } from './web-host.integration.fixture.js';

test('web host: concurrent browser reads reuse one completed projection until detection replaces it (PX-0058.04)', async () => {
  const gates: Array<() => void> = [];
  const log: string[] = [];
  let builds = 0;
  const build: () => Promise<BoardProjection> = async () => {
    const id = ++builds;
    log.push(`start-${id}`);
    await new Promise<void>(resolve => { gates.push(resolve); });
    return makeProjection({ active: makeCards(id, 'active') });
  };
  const timers = manualTimers();
  await withHost({ buildProjection: build, subscription: timers.options }, async info => {
    const read = async (label: string) => {
      log.push(`ask-${label}`);
      const res = await fetch(`${info.origin}${WEB_SNAPSHOT_PATH}`);
      const validation = validateWebBoardSnapshot(await res.json());
      assert.ok(validation.ok);
      return validation.value.stages.find(stage => stage.lane === 'active')?.count;
    };
    const first = read('first');
    while (gates.length < 1) { await new Promise(resolve => setTimeout(resolve, 5)); }
    const late = ['a', 'b', 'c', 'd'].map(read);
    // Let the late requests reach the host while build 1 is still running.
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(builds, 1, 'a running build is not restarted per request');
    gates[0]();
    assert.equal(await first, 1, 'the first caller gets the build it started');
    assert.deepEqual(await Promise.all(late), [1, 1, 1, 1], 'late callers join and reuse the same completed build');
    assert.equal(builds, 1);
    assert.equal(await read('cached'), 1);
    assert.equal(builds, 1, 'completed projection is not rebuilt per browser');

    const detection = timers.tick();
    while (gates.length < 2) { await new Promise(resolve => setTimeout(resolve, 5)); }
    gates[1]();
    await detection;
    assert.deepEqual(await Promise.all(['next-a', 'next-b'].map(read)), [2, 2]);
    assert.equal(builds, 2, 'one detected refresh replaces the shared completed projection');
  });
});

test('web host: common snapshot is slim and mission detail reuses the same fresh projection (PX-0058.04)', async () => {
  const card = makeCards(1, 'review')[0];
  const detailed = { ...card, checkpointEvidence: [{ name: 'CP-1', description: 'verify', state: 'completed' as const,
    goalCheck: [{ criterion: 'kept on demand', evidence: 'test/integration/presentation/web-projection-reads.integration.cases.ts' }] }],
    reviewHistory: [{ number: 1, reviewer: agentFamily('codex'), implementer: agentFamily('custom'), phase: 'approved' as const, disposition: 'APPROVED' as const,
      comment: 'retained detail', findingSummaries: ['detail finding'], pushbacks: [], fixes: [] }] };
  let builds = 0;
  await withHost({ buildProjection: async () => { builds += 1; return makeProjection({ review: [detailed] }); } }, async info => {
    const snapshotResponse = await fetch(`${info.origin}${WEB_SNAPSHOT_PATH}`);
    const snapshot = await snapshotResponse.json();
    assert.ok(validateWebBoardSnapshot(snapshot).ok);
    assert.doesNotMatch(JSON.stringify(snapshot), /kept on demand|retained detail|detail finding/);
    const detailResponse = await fetch(`${info.origin}${WEB_MISSION_DETAIL_PATH.replace(':missionId', detailed.id)}`);
    const detail = await detailResponse.json();
    assert.ok(validateWebMissionDetail(detail).ok);
    assert.match(JSON.stringify(detail), /kept on demand/);
    assert.match(JSON.stringify(detail), /retained detail/);
    assert.equal(detail.freshness.revision, snapshot.freshness.revision);
    assert.equal(builds, 1, 'detail reads reuse the completed application projection');
  });
});

test('web host: refresh failure marks retained projection stale and recovery republishes fresh (PX-0058.04)', async () => {
  const timers = manualTimers();
  let failing = false;
  await withHost({
    buildProjection: async () => {
      if (failing) { throw new Error('observation unavailable'); }
      return makeProjection({ active: makeCards(1, 'active') });
    },
    subscription: timers.options,
  }, async info => {
    const first = await (await fetch(`${info.origin}${WEB_SNAPSHOT_PATH}`)).json();
    assert.equal(first.freshness.state, 'fresh');
    assert.equal(typeof first.freshness.revision, 'string');
    failing = true;
    await timers.tick();
    const stale = await (await fetch(`${info.origin}${WEB_SNAPSHOT_PATH}`)).json();
    assert.equal(stale.freshness.state, 'stale');
    assert.equal(stale.freshness.revision, first.freshness.revision, 'stale response identifies the retained completed projection');
    assert.match(stale.freshness.reason, /observation unavailable/);
    failing = false;
    await timers.tick();
    const recovered = await (await fetch(`${info.origin}${WEB_SNAPSHOT_PATH}`)).json();
    assert.equal(recovered.freshness.state, 'fresh');
    assert.equal(recovered.freshness.reason, null);
  });
});
