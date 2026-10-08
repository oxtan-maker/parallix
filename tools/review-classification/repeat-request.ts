/** Repeat one saved request exactly; retain all responses, including failures. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createDecisionPort } from '../../src/composition/decision.js';
import { classifyFindings, ROUTING_POLICY_VERSION } from '../../src/application/review-classification/routing-policy.js';
import type { DecisionRequest } from '../../src/application/ports/decision.js';

const args = process.argv.slice(2);
const arg = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const input = arg('--input'), id = arg('--case'), output = arg('--output');
const repeats = Number(arg('--repeats') ?? 10);
if (!input || !id || !output || !Number.isSafeInteger(repeats) || repeats < 1 || repeats > 100) {
  throw new Error('Usage: repeat-request.ts --input <replication JSON> --case <id> --output <external JSON> [--repeats 10]');
}
if (path.resolve(output).startsWith(`${process.cwd()}${path.sep}`)) { throw new Error('Output must stay outside the repository'); }
const source = JSON.parse(await fs.readFile(input, 'utf8'));
const item = source.cases.find((value: { id: string }) => value.id === id);
if (!item?.productionRequest) { throw new Error('Case has no saved production request'); }
const request = item.productionRequest as DecisionRequest;
const packetHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
if (item.productionPacketHash !== packetHash) { throw new Error('Saved packet hash mismatch'); }
const port = createDecisionPort();
const report = { id, repeats, packetHash, request, pinnedRevisions: item.pinnedRevisions,
  historicalExpected: item.expected, policyVersion: ROUTING_POLICY_VERSION,
  availability: await port.available(), startedAt: new Date().toISOString(), calls: [] as Record<string, unknown>[] };
for (let repeat = 1; repeat <= repeats; repeat++) {
  const start = performance.now(), call: Record<string, unknown> = { repeat };
  report.calls.push(call);
  try {
    const response = await port.decide(request);
    call.response = response; call.routing = classifyFindings(response);
  } catch (error) { call.failure = error instanceof Error ? error.message : String(error); }
  call.classificationMs = performance.now() - start;
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ repeat, routing: call.routing ?? null, failure: call.failure ?? null }) + '\n');
}
