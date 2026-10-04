/** Repeatable loopback measurement for the packaged web page and its board snapshot. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadWebAssets, resolveWebAssetRoot } from '../src/adapters/web/asset-store.js';
import { createWebHost } from '../src/interfaces/web/host.js';
import { intakeMission, missionId } from '../src/domain/mission.js';
import { composeBoardProjection } from '../src/composition/board-projection.js';
import { repositoryId } from '../src/domain/repository.js';
import { initOperatorState, clearOperatorStateCache } from '../src/adapters/sqlite/adapter-factory.js';
import { SqliteBlocklistRepository } from '../src/adapters/sqlite/blocklist-repository.js';
import { SqliteBoardLaneEventRepository } from '../src/adapters/sqlite/board-lane-event-repository.js';
import { SqliteOperationalHistoryRepository } from '../src/adapters/sqlite/operational-history-repository.js';
import { SqliteUsageRepository } from '../src/adapters/sqlite/usage-repository.js';
import { agentFamily } from '../src/domain/agents.js';

export const WEB_RELOAD_SAMPLES = 20;
export const WEB_RELOAD_WARMUPS = 3;
export const WEB_RELOAD_LIMIT_MS = 200;

export interface WebReloadSummary {
  readonly samplesMs: readonly number[];
  readonly medianMs: number;
  readonly p95Ms: number;
}

export function summarizeWebReload(samplesMs: readonly number[]): WebReloadSummary {
  if (samplesMs.length < WEB_RELOAD_SAMPLES) {
    throw new Error(`web reload benchmark needs at least ${WEB_RELOAD_SAMPLES} samples`);
  }
  const sorted = [...samplesMs].sort((left, right) => left - right);
  return {
    samplesMs: [...samplesMs],
    medianMs: sorted[Math.floor(sorted.length / 2)]!,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
  };
}

function elapsed(operation: () => Promise<void>): Promise<number> {
  const start = process.hrtime.bigint();
  return operation().then(() => Number(process.hrtime.bigint() - start) / 1e6);
}

async function benchmarkSource() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-web-reload-'));
  const homeDir = path.join(rootDir, 'operator-state');
  const init = spawnSync('git', ['init', '-q'], { cwd: rootDir });
  if (init.status !== 0) { throw new Error(`cannot initialize benchmark checkout: ${init.stderr}`); }
  const repo = repositoryId('web-reload-benchmark');
  const open = Array.from({ length: 110 }, (_, index) => intakeMission({
    id: missionId(`task-web-${String(index + 1).padStart(4, '0')}`),
    repositoryId: repo,
    title: `Web reload fixture ${index + 1}`,
  }));
  const done = Array.from({ length: 10 }, (_, index) => ({ ...intakeMission({
    id: missionId(`task-done-${String(index + 1).padStart(4, '0')}`), repositoryId: repo, title: `Completed fixture ${index + 1}`,
  }), status: 'done' as const, closedAt: index < 5 ? '2026-10-02T12:00:00.000Z' : '2026-09-01T12:00:00.000Z' }));
  const { db } = await initOperatorState({ homeDir });
  const store = {
    async loadByRepository() { return [...open, ...done]; },
    async load() { return { kind: 'missing' as const }; },
  };
  const board = composeBoardProjection({
    rootDir, missionStore: store as never, database: db, repositoryId: repo,
    blocklistRepo: new SqliteBlocklistRepository(db), historyRepo: new SqliteOperationalHistoryRepository(db),
    laneEventRepo: new SqliteBoardLaneEventRepository(db), usageRepo: new SqliteUsageRepository(db),
    knownAgentFamilies: [agentFamily('codex')],
  });
  return { rootDir, homeDir, build: () => board.builder.build() };
}

function scriptPath(html: string): string {
  const match = html.match(/<script type="module"[^>]+src="([^"]+)"/);
  if (!match?.[1]) { throw new Error('packaged web shell has no module script'); }
  return match[1];
}

async function reload(origin: string): Promise<void> {
  const shell = await fetch(`${origin}/`);
  if (!shell.ok) { throw new Error(`web shell request failed: ${shell.status}`); }
  const asset = await fetch(`${origin}${scriptPath(await shell.text())}`);
  if (!asset.ok) { throw new Error(`web script request failed: ${asset.status}`); }
  const snapshot = await fetch(`${origin}/api/board`, { headers: { accept: 'application/json' } });
  if (!snapshot.ok) { throw new Error(`board snapshot request failed: ${snapshot.status}`); }
  await snapshot.arrayBuffer();
}

export async function runWebReloadBenchmark(output = 'artifacts/benchmarks/web-reload.json') {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const assets = loadWebAssets(resolveWebAssetRoot(packageRoot));
  const source = await benchmarkSource();
  const host = createWebHost({ assets, buildProjection: source.build });
  const info = await host.start();
  try {
    for (let index = 0; index < WEB_RELOAD_WARMUPS; index += 1) { await reload(info.origin); }
    const samplesMs: number[] = [];
    for (let index = 0; index < WEB_RELOAD_SAMPLES; index += 1) { samplesMs.push(await elapsed(() => reload(info.origin))); }
    const summary = summarizeWebReload(samplesMs);
    const result = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      environment: { os: `${process.platform} ${os.release()}`, node: process.version, cpu: os.cpus()[0]?.model ?? 'unavailable' },
      scenario: 'GET /, packaged module asset, then GET /api/board over the composed projection builder and seeded SQLite operator state',
      fixture: { missions: 120, completedMissions: 10, warmups: WEB_RELOAD_WARMUPS, samples: WEB_RELOAD_SAMPLES },
      thresholdMs: WEB_RELOAD_LIMIT_MS,
      summary,
    };
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result));
    if (summary.p95Ms >= WEB_RELOAD_LIMIT_MS) {
      throw new Error(`web reload p95 ${summary.p95Ms.toFixed(2)} ms exceeds ${WEB_RELOAD_LIMIT_MS} ms`);
    }
    return result;
  } finally {
    await host.close();
    await clearOperatorStateCache();
    fs.rmSync(source.rootDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runWebReloadBenchmark().catch(error => { console.error(error); process.exitCode = 1; });
}
