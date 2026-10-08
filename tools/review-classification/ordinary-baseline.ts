/** Explicit, read-only matched review experiment. No Mission or provider writes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { ensureCodexHome, buildCodexDraftInvocation, extractCodexTelemetry, codexHomeRoot } from '../../src/adapters/agents/codex.js';
import { resolveAgentModel } from '../../src/adapters/config/product-config.js';
import { buildEvidencePacket } from '../../src/application/review-classification/evidence-packet.js';
import { GitReviewEvidence } from '../../src/adapters/review/review-evidence.js';
import { createDecisionPort } from '../../src/composition/decision.js';
import { classifyFindings, hasBroaderReviewObligations } from '../../src/application/review-classification/routing-policy.js';

const [inputPath, outputDirectory] = process.argv.slice(2);
if (!inputPath || !outputDirectory || path.resolve(outputDirectory).startsWith(`${process.cwd()}${path.sep}`)) {
  throw new Error('Usage: ordinary-baseline.ts <replication JSON> <external output directory>');
}
const input = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const cases = input.cases.filter((c: any) => c.cohort === 'fresh');
const root = process.cwd();
const production = process.argv.includes('--production');
const repository = new GitReviewEvidence(root), decision = createDecisionPort();
await fs.mkdir(outputDirectory, { recursive: true });
const model = resolveAgentModel('codex', root);
const output = path.join(outputDirectory, 'ordinary-baseline.json');
const results: Record<string, unknown>[] = [];
for (const item of cases) {
  const cycleStarted = performance.now();
  let preparationMs: number | null = null, classificationMs: number | null = null;
  let route = 'reviewer', reason = 'ordinary-baseline';
  if (production) {
    const a = item.archivedInput, revisions = item.pinnedRevisions;
    const findings = a.findings.map((f: any) => ({ id: f.finding_id ?? f.id, summary: f.summary, location: f.location ?? null }));
    const packet = await buildEvidencePacket({ ...revisions, priorRevision: revisions.prior, candidateRevision: revisions.candidate,
      findings, resolvedFindingIds: findings.map((f: any) => f.id), priorReviewComment: a.priorReviewComment,
      implementerResponse: a.implementerResponse }, repository);
    preparationMs = performance.now() - cycleStarted;
    if ('fallback' in packet) { reason = packet.fallback; }
    else if (hasBroaderReviewObligations(await repository.diff(revisions.prior, revisions.candidate, []), packet.paths)) {
      reason = 'broader-review-obligations'; preparationMs = performance.now() - cycleStarted;
    } else {
      const callStarted = performance.now();
      try { const selected = classifyFindings(await decision.decide(packet.request)); route = selected.route; reason = selected.reason; }
      catch { reason = 'classifier-failure'; }
      classificationMs = performance.now() - callStarted;
    }
    if (route !== 'reviewer') {
      results.push({ id: item.id, arm: 'production', route, reason, preparationMs, classificationMs,
        elapsedMs: performance.now() - cycleStarted, status: 0, failure: null, pinnedRevisions: revisions });
      await fs.writeFile(output, JSON.stringify({ repeats: 1, family: 'codex', configuredModel: model, results }, null, 2));
      continue;
    }
  }
  const worktree = path.join(outputDirectory, item.id);
  await fs.mkdir(worktree, { recursive: true });
  const evidencePath = path.join(worktree, 'evidence.json');
  await fs.writeFile(evidencePath, JSON.stringify(item, null, 2));
  const responsePath = path.join(worktree, 'response.txt');
  const prompt = `Read-only review measurement. Do not change files, publish reviews, run code from historical revisions, or delegate.
Review the candidate repair for the complete original finding set. The actual previous review, response and pinned source are in ${evidencePath}.
Use git -C ${root} show <pinned-revision>:<path> and git diff to inspect any omitted material or dependencies needed for judgment.
Do not review the current checkout. Do not assume claims or comments prove correct behavior. Preserve normal completion and required output.
Return one JSON object: {"route":"clear"|"implementer"|"reviewer","reason":"...","newFindings":[]}. Clear only when the full original finding set is resolved; report demonstrably unresolved findings as implementer, and insufficient evidence as reviewer. Keep new findings separate.
No historical outcome in the evidence is proof of correctness. Decide independently. This measures source review, with no executable gate or Forgejo publication in either arm.`;
  // Historical references/outcomes are withheld from the reviewer.
  const { productionRequest, pinnedRevisions, archivedInput } = item;
  await fs.writeFile(evidencePath, JSON.stringify({ productionRequest, pinnedRevisions, archivedInput }, null, 2));
  ensureCodexHome(worktree);
  const invocation = buildCodexDraftInvocation({ prompt: '-', worktree, interactive: false, model });
  const execIndex = invocation.args.indexOf('exec');
  invocation.args.splice(execIndex, 0, '--config', 'features.multi_agent=false');
  invocation.args.splice(execIndex + 3, 0, '--sandbox', 'read-only', '--skip-git-repo-check', '--output-last-message', responsePath);
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  const startedAt = Date.now(), started = performance.now();
  const child = spawn(invocation.command, invocation.args, { cwd: worktree, env: invocation.options.env,
    stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  const kill = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already exited */ } };
  const timer = setTimeout(kill, 180_000);
  const onSignal = () => { kill(); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  child.stdout.on('data', chunk => { stdout.push(chunk); });
  child.stderr.on('data', chunk => { stderr.push(chunk); });
  child.stdin.end(prompt);
  let status: number | null = null, failure: string | null = null;
  try {
    status = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  finally { clearTimeout(timer); process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal); kill(); }
  const elapsedMs = performance.now() - started;
  await fs.writeFile(path.join(worktree, 'stdout.jsonl'), Buffer.concat(stdout));
  await fs.writeFile(path.join(worktree, 'stderr.txt'), Buffer.concat(stderr));
  let response: unknown = null;
  try { response = JSON.parse((await fs.readFile(responsePath, 'utf8')).replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch { failure ??= 'missing-or-invalid-review-verdict'; }
  const telemetry = extractCodexTelemetry(codexHomeRoot(worktree), { sinceMs: startedAt });
  results.push({ id: item.id, arm: production ? 'production' : 'ordinary', status, failure, response, elapsedMs,
    cycleMs: production ? performance.now() - cycleStarted : elapsedMs, route, reason,
    model: telemetry?.model ?? model,
    provider: telemetry?.provider ?? null, pinnedRevisions, classifiedRoute: item.productionRoute,
    classificationMs, preparationMs });
  await fs.writeFile(output, JSON.stringify({ repeats: 1, family: 'codex', configuredModel: model,
    limitation: 'Matched source-review boundary only; excludes executable gates and Forgejo publication. Fallback-cycle timings must include this review, preparation and classifier cost.', results }, null, 2));
  process.stdout.write(JSON.stringify({ id: item.id, status, failure, elapsedMs }) + '\n');
}
