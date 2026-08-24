/** Repeatable runtime measurements; writes volatile results outside documentation. */
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoardProjectionBuilder } from '../src/application/projections/board-readers.js';
import { intakeMission, missionId } from '../src/domain/mission.js';

export const SMALL_FIXTURE_MISSIONS = 10;
export const LARGE_FIXTURE_MISSIONS = 100;
export const DEFAULT_SAMPLES = 5;
export const DEFAULT_WARMUPS = 1;

export type Counter = number | 'unavailable';
export interface Counters { gitSubprocesses: Counter; gitWorktreeList: Counter; sqliteQueries: Counter; taskDocumentReads: Counter; }
export interface Summary { samplesMs: number[]; medianMs: number; tailMs: number; }

export function summarize(samplesMs: readonly number[]): Summary {
  if (!samplesMs.length) throw new Error('benchmark needs at least one sample');
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return { samplesMs: [...samplesMs], medianMs: sorted[Math.floor(sorted.length / 2)], tailMs: sorted.length < 20 ? sorted.at(-1)! : sorted[Math.ceil(sorted.length * .95) - 1] };
}

export function fixtureScale() { return { small: SMALL_FIXTURE_MISSIONS, large: LARGE_FIXTURE_MISSIONS }; }

export function unavailableCounters(): Counters {
  return { gitSubprocesses: 'unavailable', gitWorktreeList: 'unavailable', sqliteQueries: 'unavailable', taskDocumentReads: 'unavailable' };
}

function elapsed(fn: () => void | Promise<void>): Promise<number> {
  const start = process.hrtime.bigint();
  return Promise.resolve(fn()).then(() => Number(process.hrtime.bigint() - start) / 1e6);
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): number {
  const result = childProcess.spawnSync(command, args, { cwd, env, stdio: 'pipe' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`);
  return (result.output || []).reduce((sum, chunk) => sum + (chunk?.byteLength ?? 0), 0);
}

function makeCliFixture(root: string) {
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'tasks', 'task-bench.md'), '---\nid: TASK-BENCH\ntitle: Benchmark fixture\nstatus: refined\nassignee: []\nlabels: []\n---\n\n## Description\nFixture.\n');
  run('git', ['init', '-q'], root, process.env);
  run('git', ['config', 'user.email', 'benchmark@example.invalid'], root, process.env);
  run('git', ['config', 'user.name', 'Benchmark'], root, process.env);
  run('git', ['add', '.'], root, process.env);
  run('git', ['commit', '-qm', 'benchmark fixture'], root, process.env);
}

function gitWrapper(root: string) {
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'git.log');
  fs.mkdirSync(bin, { recursive: true });
  const realGit = process.env.PARALLIX_REAL_GIT || childProcess.execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"${log}\"\nexec \"${realGit}\" \"$@\"\n`);
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  return { bin, log };
}

function counted(log: string): Pick<Counters, 'gitSubprocesses' | 'gitWorktreeList'> {
  const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { gitSubprocesses: lines.length, gitWorktreeList: lines.filter(line => line.startsWith('worktree list')).length };
}

async function boardBuild(count: number) {
  const missions = Array.from({ length: count }, (_, index) => intakeMission({ id: missionId(`task-${String(index + 1).padStart(4, '0')}`), repositoryId: 'benchmark' as any, title: `Fixture ${index + 1}` }));
  const builder = new BoardProjectionBuilder(
    { loadAllMissions: async () => missions, loadMission: async id => missions.find(mission => mission.id === id) ?? null, getSourceFacts: () => [] },
    { loadReview: async () => null, loadReviewApproval: async () => null },
    { loadGateStatus: async () => 'unknown' },
    { loadAgentAvailability: async () => [], loadAssignedAgent: async () => null },
    { loadRepositoryId: async () => 'benchmark' as any, loadHeadCommit: async () => 'fixture' },
    { loadOperationLog: async () => [] },
  );
  await builder.build();
}

async function samples(warmups: number, sampleCount: number, operation: () => void | Promise<void>) {
  for (let index = 0; index < warmups; index++) await operation();
  const values: number[] = [];
  for (let index = 0; index < sampleCount; index++) values.push(await elapsed(operation));
  return summarize(values);
}

function parseArgs(argv: readonly string[]) {
  const output = argv.indexOf('--output');
  return { output: output >= 0 ? argv[output + 1] : 'artifacts/benchmarks/runtime.json', samples: Number(process.env.PARALLIX_BENCHMARK_SAMPLES || DEFAULT_SAMPLES), warmups: Number(process.env.PARALLIX_BENCHMARK_WARMUPS || DEFAULT_WARMUPS) };
}

function buildCompositionProbe(root: string) {
  const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild');
  const output = path.join(root, 'build', 'benchmark-composition.mjs');
  run(esbuild, [path.join(root, 'src', 'composition', 'create-cli.ts'), '--bundle', '--platform=node', '--format=esm', `--alias:react-devtools-core=${path.join(root, 'scripts', 'stubs', 'react-devtools-core.mjs')}`, `--outfile=${output}`], root, process.env);
  return output;
}

export async function runBenchmark(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!Number.isInteger(options.samples) || options.samples < 5 || !Number.isInteger(options.warmups) || options.warmups < 1) throw new Error('samples must be >=5 and warmups must be >=1');
  run('npm', ['run', 'build'], process.cwd(), process.env); // Never inside a timed region.
  const compositionModule = buildCompositionProbe(process.cwd()); // Also outside timed regions.
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-runtime-benchmark-'));
  const home = path.join(fixture, 'home');
  makeCliFixture(fixture);
  const wrapper = gitWrapper(fixture);
  const env = { ...process.env, PARALLIX_HOME: home, PARALLIX_TEST_NO_FORGEJO: '1', PATH: `${wrapper.bin}:${process.env.PATH}` };
  const cli = path.join(process.cwd(), 'build', 'px.mjs');
  const cliScenario = async (name: string, args: string[]) => {
    for (let index = 0; index < options.warmups; index++) {
      fs.writeFileSync(wrapper.log, '');
      run(process.execPath, [cli, ...args], fixture, env);
    }
    const timings: number[] = [];
    const counterSamples: Pick<Counters, 'gitSubprocesses' | 'gitWorktreeList'>[] = [];
    for (let index = 0; index < options.samples; index++) {
      fs.writeFileSync(wrapper.log, '');
      timings.push(await elapsed(() => { run(process.execPath, [cli, ...args], fixture, env); })),
      counterSamples.push(counted(wrapper.log));
    }
    const counters = { ...counterSamples.at(-1)!, sqliteQueries: 'unavailable', taskDocumentReads: 'unavailable' } satisfies Counters;
    return { name, command: `px ${args.join(' ')}`, fixture: { missions: 1 }, summary: summarize(timings), counters, counterSamples };
  };
  const composition = await samples(options.warmups, options.samples, () => { run(process.execPath, ['--input-type=module', '--eval', `await import(${JSON.stringify(compositionModule)})`], fixture, env); });
  const board = async (count: number) => ({ name: 'BoardProjection build', module: 'BoardProjectionBuilder', fixture: { missions: count }, summary: await samples(options.warmups, options.samples, () => boardBuild(count)), counters: { gitSubprocesses: 0, gitWorktreeList: 0, sqliteQueries: 0, taskDocumentReads: 0 } satisfies Counters });
  const output = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), coldRunProcedure: 'Each CLI sample is a new Node process; filesystem cache is not flushed.',
    environment: { os: `${process.platform} ${os.release()}`, cpu: os.cpus()[0]?.model ?? 'unavailable', node: process.version, revision: childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), samples: options.samples, warmups: options.warmups },
    fixtureScale: fixtureScale(), scenarios: [await cliScenario('px --version cold', ['--version']), await cliScenario('px status <slug>', ['status', 'task-bench']), await cliScenario('px stats', ['stats']), { name: 'CLI composition-root/module loading', module: 'build/benchmark-composition.mjs', fixture: { missions: 1 }, summary: composition, counters: unavailableCounters() }, await board(SMALL_FIXTURE_MISSIONS), await board(LARGE_FIXTURE_MISSIONS)],
  };
  const target = path.resolve(options.output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n');
  console.log(target);
  return output;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) runBenchmark().catch(error => { console.error(error); process.exitCode = 1; });
