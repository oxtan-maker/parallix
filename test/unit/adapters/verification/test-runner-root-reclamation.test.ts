import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTempRootRegistry, recoverRecordedTempRoots, registerRunnerOwner } from '../../../../src/adapters/verification/temp-root-registry.js';
import { probeProcessLiveness, processStartIdentity } from '../../../../src/adapters/process/process-liveness.js';
import { cleanupRunnerTempRoots, reportUnresolvedTempRoots, signalExitCode } from '../../../lib/test-runner-temp-roots.js';
import { mkdtemp as registeredMkdtemp, mkdtempAt } from '../../../helpers/temp-dir.js';

test('recorded dead roots are reclaimed while live and unrecorded roots survive', () => {
  const fixture = registeredMkdtemp('task-2365-');
  const manifests = path.join(fixture, 'manifests');
  fs.mkdirSync(manifests);
  const recordedRoots = [
    'parallix-real-agent-',
    'node-coverage-',
    'coverage-gate-tmp-',
    'codex-home-',
    'task-2339-aggregate-',
  ].map(prefix => mkdtempAt(fixture, prefix));
  const liveRoot = mkdtempAt(fixture, 'parallix-real-agent-');
  const unrecordedRoot = mkdtempAt(fixture, 'node-coverage-');
  const runnerRoot = mkdtempAt(fixture, 'task-2339-aggregate-');

  try {
    fs.writeFileSync(path.join(manifests, '111.json'), JSON.stringify({ pid: 111, roots: recordedRoots }));
    fs.writeFileSync(path.join(manifests, '222.json'), JSON.stringify({ pid: 222, roots: [liveRoot] }));
    fs.mkdirSync(path.join(manifests, 'test-run-333'));
    fs.writeFileSync(path.join(manifests, 'test-run-333', '444.json'), JSON.stringify([runnerRoot]));

    recoverRecordedTempRoots({ manifestDir: manifests, isProcessAlive: pid => pid === 222 });

    for (const root of recordedRoots) {
      assert.equal(fs.existsSync(root), false, `dead recorded root must be reclaimed: ${root}`);
    }
    assert.equal(fs.existsSync(path.join(manifests, '111.json')), false, 'dead owner record must be removed');
    assert.equal(fs.existsSync(liveRoot), true, 'live owner root must survive');
    assert.equal(fs.existsSync(path.join(manifests, '222.json')), true, 'live owner record must survive');
    assert.equal(fs.existsSync(unrecordedRoot), true, 'unrecorded root must survive');
    assert.equal(fs.existsSync(runnerRoot), false, 'dead runner worker root must be reclaimed');
    assert.equal(fs.existsSync(path.join(manifests, 'test-run-333')), false, 'dead runner manifest must be removed');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('runner cleanup removes worker roots before forwarding child failure or a handled signal', () => {
  const fixture = registeredMkdtemp('task-2365-');
  const manifests = path.join(fixture, 'test-run-333');
  const root = mkdtempAt(fixture, 'codex-home-');
  try {
    fs.mkdirSync(manifests);
    fs.writeFileSync(path.join(manifests, '444.json'), JSON.stringify([root]));
    cleanupRunnerTempRoots(manifests);
    cleanupRunnerTempRoots(manifests);
    assert.equal(fs.existsSync(root), false, 'runner cleanup removes registered worker root');
    assert.equal(fs.existsSync(manifests), false, 'runner cleanup removes its worker manifest');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('runner preserves each child signal exit code after cleanup', () => {
  assert.equal(signalExitCode('SIGINT'), 130);
  assert.equal(signalExitCode('SIGTERM'), 143);
  assert.equal(signalExitCode('SIGKILL'), 137);
});

test('recovery ignores raced entries and roots outside the temporary directory', () => {
  const fixture = registeredMkdtemp('task-2365-');
  const manifests = path.join(fixture, 'manifests');
  const outside = path.join(process.cwd(), `.task-2365-outside-${process.pid}`);
  fs.mkdirSync(manifests);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(manifests, '111.json'), JSON.stringify([outside]));
  fs.symlinkSync(path.join(manifests, 'missing'), path.join(manifests, 'test-run-222'));
  try {
    assert.doesNotThrow(() => recoverRecordedTempRoots({ manifestDir: manifests, isProcessAlive: () => false }));
    assert.equal(fs.existsSync(outside), true, 'recorded root outside the temporary directory must survive');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a SIGKILLed runner\'s registered scratch is reclaimed at the next recovery while live and uncertain owners keep theirs (TASK-2816)', () => {
  const fixture = registeredMkdtemp('task-2816-');
  const manifests = path.join(fixture, 'manifests');
  // Runner scratch on a disk-backed base outside the system temp dir is
  // trusted by its exact layout, not by its location.
  const outside = path.join(process.cwd(), `.task-2816-outside-${process.pid}`);
  const scratch = (...parts: string[]) => { const dir = path.join(outside, ...parts); fs.mkdirSync(dir, { recursive: true }); return dir; };
  const killedCoverage = scratch('px-tmp-0123456789ab', 'coverage-scratch-AbC123');
  const killedFastUnit = scratch('repo', 'tmp', 'fast-unit-scratch-XyZ789');
  const killedForeign = scratch('not-a-runner-scratch');
  const reusedPid = scratch('px-tmp-0123456789ab', 'coverage-scratch-Reused');
  const live = scratch('px-tmp-0123456789ab', 'coverage-scratch-Live01');
  const uncertain = scratch('px-tmp-0123456789ab', 'coverage-scratch-Unsure');
  const sharedCache = scratch('px-tmp-0123456789ab', 'tsx-1000');
  const runner = (pid: number, startId: string | null, roots: string[]) => {
    const dir = path.join(manifests, `test-run-${pid}`);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid, startId }));
    fs.writeFileSync(path.join(dir, 'runner.json'), JSON.stringify(roots));
    return dir;
  };
  try {
    runner(111, 'killed', [killedCoverage, killedFastUnit]);
    const unresolvedRecord = runner(112, 'killed', [killedForeign]);
    runner(333, 'before-reuse', [reusedPid]);
    const liveRecord = runner(222, 'live', [live]);
    const uncertainRecord = runner(444, null, [uncertain]);
    const ownerLiveness = (pid: number, startId: string | null) => pid === 222 && startId === 'live' ? true : pid === 444 ? null : false;
    const report = recoverRecordedTempRoots({ manifestDir: manifests, isProcessAlive: pid => pid === 333, ownerLiveness });
    for (const root of [killedCoverage, killedFastUnit, reusedPid]) { assert.equal(fs.existsSync(root), false, `abandoned runner scratch is reclaimed without exit handlers: ${root}`); }
    for (const root of [live, uncertain, sharedCache, killedForeign]) { assert.equal(fs.existsSync(root), true, `must survive: ${root}`); }
    assert.equal(fs.existsSync(path.join(manifests, 'test-run-111')), false, 'a fully reclaimed record is removed');
    for (const record of [liveRecord, uncertainRecord, unresolvedRecord]) { assert.equal(fs.existsSync(record), true, `record kept: ${record}`); }
    assert.deepEqual(report.unresolved, [{ root: killedForeign, reason: 'recorded outside the trusted temporary roots' }], 'what recovery cannot prove safe is reported');
    const again = recoverRecordedTempRoots({ manifestDir: manifests, isProcessAlive: () => false, ownerLiveness });
    assert.deepEqual({ reclaimed: again.reclaimed, unresolved: again.unresolved }, { reclaimed: [], unresolved: report.unresolved }, 'repeated recovery is idempotent');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a runner records its start identity before its scratch so a reused PID cannot keep it alive (TASK-2816)', () => {
  const fixture = registeredMkdtemp('task-2816-');
  const manifests = path.join(fixture, 'manifests');
  const record = path.join(manifests, `test-run-${process.pid}`);
  fs.mkdirSync(record, { recursive: true, mode: 0o700 });
  try {
    const roots = registerRunnerOwner(record, { pid: process.pid, startId: processStartIdentity(process.pid) });
    const scratch = roots.register(mkdtempAt(fixture, 'coverage-scratch-'));
    const owner = JSON.parse(fs.readFileSync(path.join(record, 'owner.json'), 'utf8'));
    assert.equal(owner.pid, process.pid); assert.equal(owner.startId, processStartIdentity(process.pid));
    assert.ok(owner.bootId === null || typeof owner.bootId === 'string', 'boot identity is retained with the manifest');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(record, 'runner.json'), 'utf8')), [scratch], 'the root is recorded before the runner depends on it');
    recoverRecordedTempRoots({ manifestDir: manifests, ownerLiveness: probeProcessLiveness });
    assert.equal(fs.existsSync(scratch), true, 'the running owner keeps its scratch');
    recoverRecordedTempRoots({ manifestDir: manifests });
    assert.equal(fs.existsSync(scratch), true, 'without an identity probe a live PID is uncertain and keeps its scratch');
    recoverRecordedTempRoots({ manifestDir: manifests, ownerLiveness: () => false });
    assert.equal(fs.existsSync(scratch), false, 'a dead owner identity releases it at the next recovery');
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('legacy coverage scratch is reclaimed only with trusted ownership and confirmed owner absence; the rest is reported (TASK-2816)', () => {
  const fixture = registeredMkdtemp('task-2816-');
  const manifests = path.join(fixture, 'manifests');
  const base = path.join(fixture, 'base');
  const checkout = path.join(base, 'px-tmp-0123456789ab');
  const nowMs = Date.now();
  const scratch = (name: string, ageMinutes = 60) => {
    const dir = path.join(checkout, name);
    fs.mkdirSync(dir, { recursive: true, mode: 0o775 });
    fs.writeFileSync(path.join(dir, 'payload'), 'raw coverage');
    const at = (nowMs - ageMinutes * 60_000) / 1000;
    fs.utimesSync(dir, at, at);
    return dir;
  };
  fs.mkdirSync(manifests, { mode: 0o700 });
  try {
    const abandoned = scratch('coverage-scratch-old111');
    const unproven = scratch('coverage-scratch-noproo');
    const used = scratch('coverage-scratch-used22');
    const unknown = scratch('coverage-scratch-unkn33');
    const young = scratch('coverage-scratch-young4', 1);
    const registered = scratch('coverage-scratch-reg555');
    const cache = scratch('tsx-1000');
    const unrelated = path.join(base, 'elsewhere', 'coverage-scratch-other6');
    fs.mkdirSync(unrelated, { recursive: true });
    const link = path.join(checkout, 'coverage-scratch-link77');
    fs.symlinkSync(cache, link);
    fs.writeFileSync(path.join(manifests, `${process.pid}.json`), JSON.stringify([registered]));
    const ownership = (root: string, pid: number) => {
      const record = path.join(fixture, `test-run-${pid}`); fs.mkdirSync(record);
      registerRunnerOwner(record, { pid, startId: 'recorded' }).register(root);
      fs.rmSync(record, { recursive: true });
    };
    ownership(abandoned, 111); ownership(used, 222); ownership(unknown, 333);
    const ownerLiveness = (pid: number) => pid === 222 ? true : pid === 333 ? null : false;
    const report = recoverRecordedTempRoots({ manifestDir: manifests, legacyCoverageBases: [base, base], ownerLiveness, nowMs });
    assert.deepEqual(report.reclaimed, [abandoned]);
    for (const root of [used, unknown, young, registered, cache, unrelated, link, unproven]) { assert.equal(fs.existsSync(root), true, `must survive: ${root}`); }
    assert.deepEqual(report.unresolved.map(entry => [path.basename(entry.root), entry.reason]).sort(), [
      ['coverage-scratch-link77', 'coverage scratch is not a directory owned by this user'],
      ['coverage-scratch-noproo', 'no trusted ownership record; owner absence cannot be confirmed'],
      ['coverage-scratch-unkn33', 'owner absence cannot be confirmed'],
    ]);
    const lines: string[] = [];
    reportUnresolvedTempRoots(report, line => lines.push(line));
    assert.deepEqual(lines.map(line => line.replace(/: .*/, '')), ['[temp-root-recovery] reclaimed 1 abandoned temporary root(s)', '[temp-root-recovery] kept 3 unresolved temporary root(s)']);
    const again = recoverRecordedTempRoots({ manifestDir: manifests, legacyCoverageBases: [base], ownerLiveness, nowMs });
    assert.deepEqual(again.reclaimed, [], 'repeated recovery is idempotent');
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('disk ownership survives missing manifests and reboot; live children and uncertain identities remain protected (TASK-2816)', () => {
  const fixture = registeredMkdtemp('scratch-durable-owner-');
  const base = path.join(fixture, 'disk');
  const manifests = path.join(fixture, 'volatile');
  const checkout = path.join(base, 'px-tmp-0123456789ab');
  fs.mkdirSync(checkout, { recursive: true });
  fs.mkdirSync(manifests);
  const root = (name: string) => { const dir = path.join(checkout, `coverage-scratch-${name}`); fs.mkdirSync(dir); return dir; };
  try {
    const dead = root('Dead01'), liveChild = root('Child1'), uncertain = root('Unsure'), rebooted = root('Reboot'), launching = root('Launch');
    const register = (directory: string, pid: number, bootId?: string) => {
      const manifest = path.join(manifests, `test-run-${pid}`); fs.mkdirSync(manifest);
      const registry = registerRunnerOwner(manifest, { pid, startId: 'recorded', bootId });
      registry.register(directory); return registry;
    };
    register(dead, 111);
    register(liveChild, 112).recordChild({ pid: 222, startId: 'child' });
    register(uncertain, 333);
    const pendingLaunch = register(launching, 555); pendingLaunch.prepareChild();
    register(rebooted, 444, 'a-different-boot');
    const worker = mkdtempAt(fixture, 'live-worker-');
    fs.writeFileSync(path.join(manifests, 'test-run-112', '222.json'), JSON.stringify([worker]));
    recoverRecordedTempRoots({ manifestDir: manifests, ownerLiveness: pid => pid === 222 || pid === 444 ? true : pid === 333 ? null : false });
    assert.equal(fs.existsSync(worker), true, 'a surviving suite also protects its worker fixtures after the runner dies');
    fs.rmSync(manifests, { recursive: true });
    const report = recoverRecordedTempRoots({ manifestDir: manifests, legacyCoverageBases: [base], ownerLiveness: pid => pid === 222 || pid === 444 ? true : pid === 333 ? null : false });
    assert.equal(fs.existsSync(dead), false, 'no volatile manifest is needed to reclaim a confirmed dead owner');
    if (process.platform === 'linux') { assert.equal(fs.existsSync(rebooted), false, 'an identity from a previous boot is dead even if the PID exists'); }
    assert.equal(fs.existsSync(liveChild), true, 'a surviving suite protects the dead runner scratch');
    assert.equal(fs.existsSync(uncertain), true);
    assert.equal(fs.existsSync(launching), true, 'a kill between spawn and identity publication cannot authorize deletion');
    assert.deepEqual(report.unresolved.map(entry => entry.root).sort(), [launching, uncertain].sort());
    pendingLaunch.recordChild({ pid: 666, startId: 'published' });
    const again = recoverRecordedTempRoots({ manifestDir: manifests, legacyCoverageBases: [base], ownerLiveness: () => false });
    assert.ok(again.reclaimed.includes(liveChild) && again.reclaimed.includes(uncertain));
    assert.deepEqual(recoverRecordedTempRoots({ manifestDir: manifests, legacyCoverageBases: [base], ownerLiveness: () => false }).reclaimed, []);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});
