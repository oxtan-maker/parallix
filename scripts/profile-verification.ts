/** Opt-in paired V8 sampling experiment; never participates in gate selection. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { cpuSupervisor, readCpuReport } from '../test/lib/cpu-supervisor.js';
import { controlledVerificationComparisons } from '../src/application/projections/verification-profile-comparison.js';

const root = process.cwd();
const output = path.resolve(process.argv[2] ?? 'tmp/verification-profile');
const workload = process.argv.slice(3);
if (!workload.length) throw new Error('Usage: tsx scripts/profile-verification.ts OUTPUT TEST_PATH...');
const repetitions = Number(process.env.PARALLIX_PROFILE_SAMPLES ?? 3);
if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error('Positive sample count required');
fs.mkdirSync(output, { recursive: true });
const meter = cpuSupervisor(root);
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const dirty = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout.trim();
type Hotspot = { functionName: string; url: string; samples: number };
const runs: { name: string; coverage: boolean; profiled: boolean; pair: number; command: string[];
  wallMs: number; cpuUs: number; cpuProvenance: string;
  profiles: { file: string; samples: number; hotspots: Hotspot[] }[] }[] = [];
for (const coverage of [false, true]) {
  for (let pair = 0; pair < repetitions; pair++) {
    // Alternate the order to expose warm-cache/order effects rather than hiding them.
    for (const profiled of pair % 2 ? [true, false] : [false, true]) {
      const name = `${coverage ? 'covered' : 'plain'}-${pair}-${profiled ? 'profile' : 'control'}`;
      const directory = path.join(output, name);
      fs.mkdirSync(directory); // refuse to overwrite retained evidence
      const args = [
        ...(profiled ? ['--cpu-prof', '--cpu-prof-interval=1000', `--cpu-prof-dir=${directory}`] : []),
        '--import', 'tsx', '--import', './test/bootstrap-parallix-home.ts',
        '--test', ...(coverage ? ['--experimental-test-coverage'] : []), ...workload,
      ];
      const started = performance.now();
      const result = spawnSync(meter, ['--cpu-report', path.join(directory, 'cpu.json'), process.execPath, ...args],
        { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
      const wallMs = performance.now() - started;
      fs.writeFileSync(path.join(directory, 'stdout.txt'), result.stdout ?? '');
      fs.writeFileSync(path.join(directory, 'stderr.txt'), result.stderr ?? '');
      if (result.status !== 0) throw new Error(`${name} failed: ${result.stderr}`);
      const cpu = readCpuReport(path.join(directory, 'cpu.json'));
      const profiles = [];
      for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.cpuprofile'))) {
        const raw = fs.readFileSync(path.join(directory, file));
        const capture = JSON.parse(String(raw)) as { nodes: { id: number; callFrame: { functionName: string; url: string } }[]; samples: number[]; timeDeltas: number[] };
        const counts = new Map<number, number>();
        for (const id of capture.samples) counts.set(id, (counts.get(id) ?? 0) + 1);
        const hotspots = capture.nodes.map(node => ({ ...node.callFrame, samples: counts.get(node.id) ?? 0 }))
          .filter(node => node.samples > 0).sort((a, b) => b.samples - a.samples).slice(0, 30);
        fs.writeFileSync(path.join(directory, `${file}.gz`), gzipSync(raw));
        fs.unlinkSync(path.join(directory, file));
        profiles.push({ file: `${name}/${file}.gz`, samples: capture.samples.length, hotspots });
      }
      if (profiled && !profiles.length) throw new Error('Profiler produced no captures');
      runs.push({ name, coverage, profiled, pair, command: [process.execPath, ...args], wallMs,
        cpuUs: cpu.userUs + cpu.systemUs, cpuProvenance: 'wait4: supervisor plus waited process tree', profiles });
    }
  }
}
const comparisons = [false, true].map(coverage => {
  const selected = runs.filter(run => run.coverage === coverage);
  const average = (profiled: boolean, key: 'wallMs' | 'cpuUs') => {
    const group = selected.filter(run => run.profiled === profiled);
    return group.reduce((sum, run) => sum + run[key], 0) / group.length;
  };
  return { coverage, pairs: repetitions, wallOverheadRatio: average(true, 'wallMs') / average(false, 'wallMs'),
    cpuOverheadRatio: average(true, 'cpuUs') / average(false, 'cpuUs') };
});
const report = { revision, dirty: Boolean(dirty),
  node: process.version, platform: process.platform, arch: process.arch,
  tsx: JSON.parse(fs.readFileSync('node_modules/tsx/package.json', 'utf8')).version,
  workload, intervalUs: 1000, comparisons, runs,
  limits: 'Samples are V8 isolate observations, not OS CPU. Test workers inherit profiling flags; arbitrary external commands do not. Concurrent isolate sample counts cannot be summed as CPU. wait4 includes waited descendants only. No assertion/fixture or coverage-exclusive attribution is inferred from a hot frame. Paired local runs do not establish universal speedups.',
};
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ...report,
  controlledComparisons: controlledVerificationComparisons(report) }, null, 2) + '\n');
console.log(path.join(output, 'report.json'));
