/** Explicit held-out classifier evaluation; labels never enter the decision request. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { buildEvidencePacket, PACKET_VERSION, PROMPT_VERSION } from '../../src/application/review-classification/evidence-packet.js';
import { classifyRepeatFindings, ROUTING_POLICY_VERSION } from '../../src/application/review-classification/routing-policy.js';
import { LEGACY_CLASSIFIER_POLICY_VERSION } from '../../src/domain/classifier-review.js';
import { GitReviewEvidence } from '../../src/adapters/review/review-evidence.js';
import { createDecisionPort } from '../../src/composition/decision.js';
import type { RepeatFindingEvidence } from '../../src/application/ports/review-evidence.js';

const args = process.argv.slice(2);
const argument = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const inputPath = argument('--input'), outputPath = argument('--output');
const repeats = Number(argument('--repeats') ?? 1);
if (!inputPath || !outputPath || !Number.isSafeInteger(repeats) || repeats < 1 || repeats > 10) {
  throw new Error('Usage: validate-cases.ts --input <JSON> --output <external JSON> [--repeats 1..10]');
}
if (path.resolve(outputPath).startsWith(`${process.cwd()}${path.sep}`)) {
  throw new Error('Experiment output must stay outside the repository');
}
const inputText = await fs.readFile(inputPath, 'utf8');
const input = JSON.parse(inputText) as { selection: string; cases: { id: string; expected: string; input: RepeatFindingEvidence }[] };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const execute = promisify(execFile);
const resolve = async (revision: string) => (await execute('git', ['rev-parse', '--verify', `${revision}^{commit}`],
  { encoding: 'utf8', timeout: 10_000, maxBuffer: 4096 })).stdout.trim();
const evidence = new GitReviewEvidence(process.cwd()), decision = createDecisionPort();
const report = {
  selection: input.selection, inputHash: hash(inputText), policyVersion: ROUTING_POLICY_VERSION,
  packetVersion: PACKET_VERSION, promptVersion: PROMPT_VERSION, repeats,
  availability: await decision.available(), cases: [] as Record<string, unknown>[],
};
const persist = () => fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
for (const item of input.cases) {
  const started = performance.now();
  const row: Record<string, unknown> = { id: item.id, expected: item.expected, calls: [] };
  report.cases.push(row);
  try {
    const priorRevision = await resolve(item.input.priorRevision), candidateRevision = await resolve(item.input.candidateRevision);
    row.pinnedRevisions = { priorRevision, candidateRevision };
    const packet = await buildEvidencePacket({ ...item.input, priorRevision, candidateRevision }, evidence);
    row.preparationMs = performance.now() - started;
    if ('fallback' in packet) { row.fallback = packet.fallback; }
    else {
      row.request = packet.request; row.packetHash = hash(JSON.stringify(packet.request));
      for (let repeat = 1; repeat <= repeats; repeat++) {
        const callStarted = performance.now();
        const call: Record<string, unknown> = { repeat };
        (row.calls as Record<string, unknown>[]).push(call);
        try {
          const response = await decision.decide(packet.request);
          const selected = classifyRepeatFindings(response);
          const legacy = classifyRepeatFindings(response, LEGACY_CLASSIFIER_POLICY_VERSION);
          call.response = response; call.route = selected.route; call.legacyRoute = legacy.route;
          call.agrees = selected.route === 'reviewer' ? null
            : selected.route === 'clear' ? item.expected === 'approved' : item.expected === 'changes-requested';
        } catch (error) { call.failure = error instanceof Error ? error.message : String(error); call.route = 'reviewer'; }
        call.classificationMs = performance.now() - callStarted;
        await persist();
      }
    }
  } catch (error) { row.fallback = 'missing-or-failed-evidence'; row.failure = error instanceof Error ? error.message : String(error); }
  await persist();
  process.stdout.write(JSON.stringify({ id: item.id, fallback: row.fallback ?? null,
    routes: (row.calls as Record<string, unknown>[]).map(call => call.route) }) + '\n');
}
