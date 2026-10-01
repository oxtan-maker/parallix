/**
 * TASK-2622.02 reproducible worker-cost probe.
 *
 * It uses fresh child workers on one Node binary.  Empty workers are paired
 * with phase probes so process/tsx/bootstrap/module/fixture/subprocess cost is
 * not mistaken for assertion CPU.  The companion loader is observational.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samples = Number(process.env.PARALLIX_PROFILE_SAMPLES || 5);
const output = path.join(root, 'backlog/docs/task-2622.02-worker-profile.json');
const loader = path.join(root, 'scripts/test-worker-dependency-loader.mjs');
const bootstrap = path.join(root, 'test/bootstrap-parallix-home.ts');

type Sample = { wallMs: number; cpuMs: number; phases: Record<string, number>; loads: string[]; unresolved: string[] };
type Probe = { name: string; source: string; bootstrap?: boolean; coverage?: boolean };

const probes: Probe[] = [
  { name: 'empty-worker', source: 'mark("assertions");' },
  { name: 'bootstrap-only', bootstrap: true, source: 'mark("assertions");' },
  { name: 'launcher-selection-import', bootstrap: true, source: 'await phase("module-evaluation", () => import(process.env.PARALLIX_PROBE_TARGET)); mark("assertions");' },
  { name: 'application-services-import', bootstrap: true, source: 'await phase("module-evaluation", () => import(process.env.PARALLIX_PROBE_TARGET)); mark("assertions");' },
  { name: 'module-mock-relink', bootstrap: true, source: 'await phase("module-mock-relink", async () => { const seam = await import(process.env.PARALLIX_MODULE_MOCK); const handle = seam.mockModule(process.env.PARALLIX_PROBE_TARGET, import.meta.url); await seam.installModuleMocks(); if (!handle.selectAgent) throw new Error("mock relink unavailable"); }); mark("assertions");' },
  { name: 'fixture-creation', bootstrap: true, source: 'await phase("fixture-creation", async () => { const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path"); const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-2622-probe-")); fs.writeFileSync(path.join(dir, "fixture"), "x"); fs.rmSync(dir, { recursive: true, force: true }); }); mark("assertions");' },
  { name: 'subprocess', bootstrap: true, source: 'await phase("subprocess", async () => { const { spawnSync } = await import("node:child_process"); spawnSync(process.execPath, ["--version"], { stdio: "ignore" }); }); mark("assertions");' },
  { name: 'assertion-cpu', bootstrap: true, source: 'await phase("assertions", async () => { let total = 0; for (let i = 0; i < 2_000_000; i += 1) total += i; if (total < 1) throw new Error("assertion probe failed"); });' },
  { name: 'coverage-report-empty-worker', bootstrap: true, coverage: true, source: 'const { default: test } = await import("node:test"); test("empty covered worker", () => {});' },
];

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10;
}

function probeSource(body: string) {
  return `import { performance } from 'node:perf_hooks';
const start = performance.now(); const phases = {};
const mark = name => { phases[name] = performance.now() - start; };
const phase = async (name, fn) => { const before = performance.now(); await fn(); phases[name] = performance.now() - before; };
${body}
process.stdout.write(JSON.stringify({ phases }) + '\\n');\n`;
}

function run(probe: Probe): Sample {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2622-worker-'));
  const file = path.join(dir, 'probe.mjs');
  const trace = path.join(dir, 'dependencies.jsonl');
  fs.writeFileSync(file, probeSource(probe.source));
  const args = ['--experimental-loader', loader, '--experimental-test-module-mocks', '--import', 'tsx'];
  if (probe.bootstrap) args.push('--import', pathToFileURL(bootstrap).href);
  if (probe.coverage) args.push('--experimental-test-coverage', '--test');
  args.push(file);
  const started = process.hrtime.bigint();
  const target = probe.name === 'launcher-selection-import'
    ? pathToFileURL(path.join(root, 'src/adapters/agents/launcher-selection.ts')).href
    : probe.name === 'application-services-import'
      ? pathToFileURL(path.join(root, 'src/composition/application-services.ts')).href
      : probe.name === 'module-mock-relink'
        ? pathToFileURL(path.join(root, 'src/adapters/agents/launcher-selection.ts')).href : '';
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: { ...process.env, PARALLIX_WORKER_DEPENDENCY_TRACE: trace, PARALLIX_PROBE_TARGET: target, PARALLIX_MODULE_MOCK: pathToFileURL(path.join(root, 'test/lib/module-mock.ts')).href } });
  const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (result.status !== 0) throw new Error(`${probe.name} failed: ${result.stderr}`);
  const line = result.stdout.trim().split('\n').find(entry => entry.startsWith('{"phases"')) || '{}';
  const phases = probe.coverage ? { 'coverage-report': wallMs } : (JSON.parse(line) as { phases: Record<string, number> }).phases;
  const records = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return { wallMs, cpuMs: 0, phases, loads: records.filter(r => r.type === 'load').map(r => r.url), unresolved: records.filter(r => r.type === 'unresolved').map(r => r.specifier) };
}

function staticDependencies(file: string) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const staticEdges = [...source.matchAll(/(?:import|export)\s+(?:[^'"()]*?from\s+)?['"]([^'"]+)['"]/g)].map(match => match[1]);
  const dynamicEdges = [...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]);
  const nonliteralDynamics = (source.match(/import\(\s*[^'"]/g) || []).length - dynamicEdges.length;
  const env = [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map(match => match[1]);
  return { file, staticEdges, dynamicEdges, unresolvedDynamicCount: Math.max(0, nonliteralDynamics), resources: [...source.matchAll(/(?:readFileSync|writeFileSync|copyFileSync)\([^\n]+/g)].map(match => match[0]), environment: [...new Set(env)] };
}

const results = probes.map(probe => {
  const runs = Array.from({ length: samples }, () => run(probe));
  const first = runs[0];
  return {
    name: probe.name,
    samples,
    medianWallMs: median(runs.map(run => run.wallMs)),
    medianPhasesMs: Object.fromEntries(Object.keys(first.phases).map(key => [key, median(runs.map(run => run.phases[key] || 0))])),
    evaluatedModules: [...new Set(runs.flatMap(run => run.loads))].sort(),
    unresolvedRuntimeDependencies: [...new Set(runs.flatMap(run => run.unresolved))].sort(),
  };
});
const report = {
  task: 'TASK-2622.02', generatedAt: new Date().toISOString(), node: process.version, tsx: requireVersion('tsx'), samples,
  method: 'Fresh process-isolated workers; median of paired controls. Loader observations include runtime resolve/load events, while source scans enumerate literal static/dynamic, nonliteral dynamic, resource, and environment dependencies. This inventory is diagnostic only and must not be used as a cache key.',
  probes: results,
  staticDependencyAccount: ['test/bootstrap-parallix-home.ts', 'src/adapters/agents/launcher-selection.ts', 'src/composition/application-services.ts', 'test/lib/module-mock.ts'].map(staticDependencies),
};
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`${output}: ${results.length} probes, ${samples} samples each`);

function requireVersion(name: string) {
  const result = spawnSync('npx', [name, '--version'], { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unavailable';
}
