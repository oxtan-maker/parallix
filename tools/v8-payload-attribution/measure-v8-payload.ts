#!/usr/bin/env node
// TASK-2622.04 — attribute the raw V8 coverage payload that a covered test tier
// writes to NODE_V8_COVERAGE, by the process that wrote each file.
//
// Usage (from the repository root, after `npm run build` for integration-ci):
//   npx tsx tools/v8-payload-attribution/measure-v8-payload.ts --tier integration-ci
//   npx tsx tools/v8-payload-attribution/measure-v8-payload.ts --analyze <kept scratch dir>
//
// The run uses the same plan and coverage reporters as
// `PARALLIX_TEST_COVERAGE=1 npm run test:integration:ci:prebuilt`
// (buildTestRunPlan + withCoverageReporters), but keeps the scratch directory
// that test/run-default-tests.ts deletes, so the payload can be classified.
// This is diagnostic evidence only: it is not a selection or cache authority.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildTestRunPlan, withCoverageReporters } from '../../test/lib/test-run-plan.js';
import { checkoutTestTmpdir } from '../../test/lib/test-tmpdir.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };

type ProcessKind = 'test-worker' | 'tsx-source-child' | 'bundle-child' | 'other';
interface V8Script { url: string }
interface V8File { result?: V8Script[]; 'source-map-cache'?: Record<string, unknown> }
interface KindTotals { files: number; bytes: number; sourceMapCacheBytes: number; filesWithSourceUrls: number }

const sourcePrefix = `file://${path.join(root, 'src')}${path.sep}`;
const isSourceUrl = (url: string) => url.startsWith(sourcePrefix) && url.endsWith('.ts');

/** The process that wrote a payload file, judged from the scripts it executed. */
function classifyPayload(file: V8File): ProcessKind {
  const urls = (file.result ?? []).map(script => script.url);
  if (urls.some(url => /\/test\/[^/]+\.test\.ts$/.test(url) || /\/test\/adapters\/[^/]+\.test\.ts$/.test(url))) { return 'test-worker'; }
  if (urls.some(url => url.endsWith('/build/px.mjs'))) { return 'bundle-child'; }
  if (urls.some(isSourceUrl)) { return 'tsx-source-child'; }
  return 'other';
}

function analyzePayload(dir: string) {
  const kinds = new Map<ProcessKind, KindTotals>();
  let totalBytes = 0;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.json')) { continue; }
    const filePath = path.join(dir, entry);
    const bytes = fs.statSync(filePath).size;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as V8File;
    const kind = classifyPayload(parsed);
    const totals = kinds.get(kind) ?? { files: 0, bytes: 0, sourceMapCacheBytes: 0, filesWithSourceUrls: 0 };
    totals.files += 1;
    totals.bytes += bytes;
    totals.sourceMapCacheBytes += parsed['source-map-cache'] ? JSON.stringify(parsed['source-map-cache']).length : 0;
    if ((parsed.result ?? []).some(script => isSourceUrl(script.url))) { totals.filesWithSourceUrls += 1; }
    kinds.set(kind, totals);
    totalBytes += bytes;
  }
  return { totalBytes, kinds: Object.fromEntries([...kinds].sort(([a], [b]) => a.localeCompare(b))) };
}

function runTier(tier: string) {
  const plan = buildTestRunPlan({ executionRoot: root, requestedArgs: [`--${tier}`], coverage: true });
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const scratch = fs.mkdtempSync(path.join(root, 'tmp', `v8-payload-${tier}-`));
  const lcov = path.join(scratch, 'lcov.info');
  const payload = path.join(scratch, 'v8');
  fs.mkdirSync(payload);
  const started = process.hrtime.bigint();
  const result = spawnSync(plan.testNode, withCoverageReporters(plan.nodeArgs, lcov), {
    cwd: root, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, PARALLIX_PREBUILT_PACK: '1', FORCE_COLOR: '0', TMPDIR: checkoutTestTmpdir(root), NODE_V8_COVERAGE: payload },
  });
  const wallMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
  return { tier, exitStatus: result.status, wallMs, scratch, lcovBytes: fs.existsSync(lcov) ? fs.statSync(lcov).size : 0, ...analyzePayload(payload) };
}

const analyzeDir = option('--analyze');
const tier = option('--tier') ?? 'integration-ci';
const report = analyzeDir ? analyzePayload(path.resolve(analyzeDir)) : runTier(tier);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
