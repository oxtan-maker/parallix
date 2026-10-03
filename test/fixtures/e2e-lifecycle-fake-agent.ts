import fs from 'node:fs';
import path from 'node:path';
import { createMissionApplicationServices } from '../../src/composition/application-services.js';
import { missionId } from '../../src/domain/mission.js';
import { recordApproval } from '../../src/adapters/review/review-round.js';

function services(root = process.cwd()) {
  return createMissionApplicationServices(root);
}

function value(prompt: string, expression: RegExp): string | null {
  return prompt.match(expression)?.[1]?.trim() ?? null;
}

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

async function recordContract(slug: string, root: string): Promise<void> {
  const missionServices = await services(root);
  const request = async (capability: 'mission:context' | 'checkpoint:record') => {
    const loaded = await missionServices.store.load(missionId(slug));
    if (loaded.kind !== 'found') { throw new Error(`fake agent could not read ${slug}`); }
    return { operationId: `fake-${slug}`, missionId: missionId(slug), expectedVersion: loaded.version, capabilities: new Set([capability]) };
  };
  await missionServices.brief.update({ ...await request('mission:context'), patch: { goal: 'Exercise the real lifecycle with deterministic fake agent output', why: 'Protect the workflow surface from regression drift' } });
  await missionServices.brief.update({ ...await request('mission:context'), patch: { scope: 'Run draft, active, review and integrate through the real CLI', outOfScope: ['Real model execution'] } });
  await missionServices.brief.setGates({ ...await request('mission:context'), gates: ['node -e ""'] });
  await missionServices.brief.setSuccessCriteria({ ...await request('mission:context'), criteria: ['The lifecycle reaches integration through the real CLI'] });
  await missionServices.checkpoints.plan({ ...await request('mission:context'), name: 'CP-1', description: 'Execute the fake deliverable' });
  await missionServices.checkpoints.plan({ ...await request('mission:context'), name: 'CP-2', description: 'Ready the mission for review' });
  await missionServices.brief.setPredictedNelBucket({ ...await request('mission:context'), bucket: 'Small' });
}

async function runFakeLifecycleAgent(prompt: string, worktree?: string) {
  const slug = value(prompt, /^(?:Mission s|S)lug:\s*((?:task-[a-z0-9-]+|parallix-adhoc-\d+))/im)
    ?? value(prompt, /^Mission:\s*((?:task-[a-z0-9-]+|parallix-adhoc-\d+))/im)
    ?? value(prompt, /^Mode: act-on-review\. Branch:\s*mission\/((?:task-[a-z0-9-]+|parallix-adhoc-\d+))/im)
    ?? 'task-unknown';
  const root = worktree ?? process.cwd();
  const missionDir = value(prompt, /^Mission dir:\s*(.+)$/m) ?? path.join(root, 'missions', slug);
  if (/^Mode: draft\./m.test(prompt) || /Mission Slug:/m.test(prompt)) {
    write(path.join(missionDir, 'milestone-1.md'), '# Milestone 1\n');
    await recordContract(slug, root);
  }

  if (/^Mode: execute after lock\./m.test(prompt)) {
    write(path.join(root, 'deliverable.txt'), 'fake execute output\n');
    const missionServices = await services(root);
    for (const [name, criterion, evidence, next] of [['CP-1', 'The lifecycle reaches integration through the real CLI', 'deliverable.txt:1', 'Run review.'], ['CP-2', 'The lifecycle reaches integration through the real CLI', 'deliverable.txt:1', 'Approve the mission in review.']] as const) {
      let recorded: any;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const loaded = await missionServices.store.load(missionId(slug));
        if (loaded.kind !== 'found') { throw new Error(`fake agent could not read ${slug}`); }
        recorded = await missionServices.checkpoints.record({ operationId: `fake-${slug}-${name}`, missionId: missionId(slug), expectedVersion: loaded.version, capabilities: new Set(['checkpoint:record']), checkpoint: { missionId: missionId(slug), name, goalCheck: [{ criterion, evidence }], nextActionText: next } });
        if (recorded.status === 'completed') { break; }
        await new Promise(resolve => setImmediate(resolve));
      }
      if (recorded.status !== 'completed') { throw new Error(`fake checkpoint ${name} failed: ${recorded.error?.message}`); }
    }
    const loaded = await missionServices.store.load(missionId(slug));
    if (loaded.kind !== 'found') { throw new Error(`fake agent could not read ${slug}`); }
    const completion = await missionServices.brief.markSuccessCriteriaComplete({ operationId: `fake-${slug}-complete`, missionId: missionId(slug), expectedVersion: loaded.version, capabilities: new Set(['mission:context']), criterion: 'all' });
    if (completion.status !== 'completed') { throw new Error(`fake criterion completion failed: ${completion.error?.message}`); }
  }

  if (/^Mode: review\./m.test(prompt)) {
    const missionServices = await services(root);
    const loaded = await missionServices.store.load(missionId(slug));
    if (loaded.kind !== 'found') { throw new Error(`fake agent could not read ${slug}`); }
    const approved = await recordApproval(slug, { comment: 'No blocking findings.', decidedAt: new Date().toISOString(), expectedVersion: Number(loaded.version) }, { missionStore: missionServices.store });
    if (approved.outcome === 'failed') { throw new Error(`fake approval failed: ${approved.diagnostic}`); }
  }

  return { status: 0, stdout: '{"sessionID":"ses_fake"}\n', stderr: '' };
}

export function fakeLifecycleAgent({ prompt, worktree }: { prompt: string; worktree?: string }) {
  const root = worktree ?? process.cwd();
  return {
    invocation: { command: 'in-process-fake-agent', args: [], options: { cwd: root } },
    resultPromise: runFakeLifecycleAgent(prompt, worktree),
  };
}
