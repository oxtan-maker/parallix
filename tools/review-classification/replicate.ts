/** Explicit experiment: read archived inputs; write only caller-selected external output. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildEvidencePacket, PACKET_VERSION, PROMPT_VERSION } from '../../src/application/review-classification/evidence-packet.js';
import { classifyFindings, hasBroaderReviewObligations, ROUTING_POLICY_VERSION } from '../../src/application/review-classification/routing-policy.js';
import { GitReviewEvidence } from '../../src/adapters/review/review-evidence.js';
import { createDecisionPort } from '../../src/composition/decision.js';
import { LEGACY_CLASSIFIER_POLICY_VERSION } from '../../src/domain/classifier-review.js';
import type { DecisionRequest, DecisionResult } from '../../src/application/ports/decision.js';

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const archive = arg('--archive');
const output = arg('--output');
if (!archive || !output) { throw new Error('Usage: replicate.ts --archive <TASK-2650 archive> --output <external JSON> [--live]'); }
if (path.resolve(output).startsWith(`${process.cwd()}${path.sep}`)) { throw new Error('Experiment output must stay outside the repository'); }
const live = args.includes('--live');
const read = async (file: string) => JSON.parse(await fs.readFile(path.join(archive, file), 'utf8'));
const fresh = await read('final-mechanical-validation/improved/results.json');
const sample = await read('final-mechanical-validation/candidate-sample.json');
const development = await read('task-2650-mechanical-context/results.json');
const devInputs = await read('task-2650-context-development/window-results.json');
const reference = await read('final-mechanical-validation/final-summary.json');
const port = createDecisionPort();
const repository = new GitReviewEvidence(process.cwd());
const availability = await port.available();
const metadata = { policyVersion: ROUTING_POLICY_VERSION, packetVersion: PACKET_VERSION, promptVersion: PROMPT_VERSION,
  recordedReplayPolicy: LEGACY_CLASSIFIER_POLICY_VERSION, repeats: 1, nodeVersion: process.version, platform: process.platform };
const execute = promisify(execFile);
const resolveRevision = async (revision: string): Promise<string> => {
  const { stdout } = await execute('git', ['rev-parse', '--verify', `${revision}^{commit}`],
    { encoding: 'utf8', timeout: 10_000, maxBuffer: 4096 });
  return stdout.trim();
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const cases: Record<string, unknown>[] = [];
for (const [cohort, recorded, inputs, folder] of [
  ['fresh', fresh, sample, 'final-mechanical-validation/improved/packets'],
  ['development', development, devInputs, 'task-2650-mechanical-context/packets'],
] as const) {
  for (const row of recorded.cases.filter((c: any) => c.arm === 'complete-files')) {
    const input = inputs.cases.find((c: any) => c.developmentId === row.developmentId
      || row.developmentId.endsWith(`${c.mission}-r${c.round}`));
    const result: Record<string, unknown> = { cohort, id: row.developmentId, historicalRoute: row.route, expected: row.expected };
    cases.push(result);
    if (row.response) {
      const a = row.response.answers.resolution;
      const replay: DecisionResult = { provider: row.response.provider || 'archive', model: row.response.model,
        answers: { resolution: { type: 'choice', selected: a.choice, probabilities: a.probabilities, confidence: a.confidence } } };
      result.recordedReplayRoute = classifyFindings(replay, LEGACY_CLASSIFIER_POLICY_VERSION).route;
    } else { result.recordedReplayRoute = 'reviewer'; result.frozenLiveRoute = 'reviewer'; }
    let frozenRequest: DecisionRequest | null = null;
    if (row.requestSha256 && row.response) {
      const compressed = await fs.readFile(path.join(archive, folder, `${row.developmentId}--${row.arm}.json.gz`));
      const body = gunzipSync(compressed).toString('utf8');
      if (hash(body) !== row.requestSha256) { throw new Error(`Archive hash mismatch: ${row.developmentId}`); }
      result.archiveHashVerified = true;
      const frozen = JSON.parse(body);
      frozenRequest = { state: frozen.state, questions: frozen.questions };
      if (live) {
        const started = performance.now();
        try {
          const response = await port.decide(frozenRequest!);
          result.frozenLiveResponse = response;
          result.frozenLiveRoute = classifyFindings(response).route;
        } catch (error) { result.frozenLiveRoute = 'reviewer'; result.frozenLiveFailure = error instanceof Error ? error.message : 'classifier failure'; }
        result.frozenLiveMs = performance.now() - started;
      }

    }
    if (!input) { result.productionFallback = 'missing-archived-case-input'; continue; }
    result.archivedInput = { priorRevision: input.priorRevision, candidateRevision: input.revision,
      priorReviewComment: input.priorReviewComment, implementerResponse: input.implementerResponse,
      findings: input.priorFindings };
    let priorRevision: string, candidateRevision: string;
    try {
      priorRevision = await resolveRevision(input.priorRevision);
      candidateRevision = await resolveRevision(input.revision);
      result.archivedRevisions = { prior: input.priorRevision, candidate: input.revision };
      result.pinnedRevisions = { prior: priorRevision, candidate: candidateRevision };
    } catch { result.productionFallback = 'missing-archived-revision'; continue; }
    const findings = input.priorFindings.map((f: any) => ({ id: f.finding_id ?? f.id, summary: f.summary, location: f.location ?? null }));
    const started = performance.now();
    const packet = await buildEvidencePacket({ priorRevision, candidateRevision,
      findings, priorReviewComment: input.priorReviewComment ?? '', implementerResponse: input.implementerResponse ?? '',
      resolvedFindingIds: findings.map((f: any) => f.id) }, repository);
    result.preparationMs = performance.now() - started;
    if ('fallback' in packet) { result.productionFallback = packet.fallback; continue; }
    const diff = await repository.diff(priorRevision, candidateRevision, []);
    result.broaderReviewObligations = hasBroaderReviewObligations(diff, packet.paths);
    result.productionRequest = packet.request;
    if (frozenRequest) {
      const before = frozenRequest.state as Record<string, unknown>;
      const after = packet.request.state as Record<string, unknown>;
      result.stateDifferences = [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
      // Git's default object abbreviation grows with repository history. Preserve
      // raw packets, but distinguish this metadata drift from changed evidence.
      const normalize = (state: Record<string, unknown>) => ({ ...state,
        diff: typeof state.diff === 'string'
          ? state.diff.replace(/^index [a-f0-9]+\.\.[a-f0-9]+/gm, 'index <object-identifiers>') : state.diff });
      result.sameArchivedEvidence = JSON.stringify(normalize(before)) === JSON.stringify(normalize(after));
    }
    result.productionPacketHash = hash(JSON.stringify(packet.request));
    result.sameArchivedState = row.requestSha256 && row.response ? await (async () => {
      const body = JSON.parse(gunzipSync(await fs.readFile(path.join(archive, folder, `${row.developmentId}--${row.arm}.json.gz`))).toString('utf8'));
      return JSON.stringify(body.state) === JSON.stringify(packet.request.state);
    })() : false;
    if (live) {
      const callStart = performance.now();
      try {
        const response = await port.decide(packet.request as DecisionRequest);
        result.response = response; result.classifierRoute = classifyFindings(response).route;
        result.productionRoute = result.broaderReviewObligations ? 'reviewer' : result.classifierRoute;
      } catch (error) { result.productionRoute = 'reviewer'; result.failure = error instanceof Error ? error.message : 'classifier failure'; }
      result.classificationMs = performance.now() - callStart;
    }
    // Persist every raw case, including failures, so interruption cannot cherry-pick success.
    await fs.writeFile(output, JSON.stringify({ live, ...metadata, availability, reference, cases }, null, 2));
  }
}
const count = (cohort: string, field: string) => Object.fromEntries(['clear', 'implementer', 'reviewer'].map(route =>
  [route, cases.filter(c => c.cohort === cohort && (c[field] ?? (c.productionFallback ? 'reviewer' : null)) === route).length]));
const report = { live, ...metadata, availability, reference,
  recordedReplay: { fresh: count('fresh', 'recordedReplayRoute'), development: count('development', 'recordedReplayRoute') },
  frozenLive: { fresh: count('fresh', 'frozenLiveRoute'), development: count('development', 'frozenLiveRoute') },
  production: { fresh: count('fresh', 'productionRoute'), development: count('development', 'productionRoute') },
  historicalEstimatedSaving: (3 * 120 - 7.81) / (20 * 120),
  measuredEndToEndSaving: null, limitation: 'Classifier decision counts and historical agreement are the acceptance measures. This experiment does not execute a general review cycle; packet/API time is not end-to-end savings.', cases };
await fs.writeFile(output, JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify({ recordedReplay: report.recordedReplay, production: report.production, live, output }) + '\n');
