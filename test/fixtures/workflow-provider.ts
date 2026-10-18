/** Deterministic executable substituted only at the provider command boundary. */
import fs from 'node:fs';
import path from 'node:path';
import { launchPrepared } from '../../src/adapters/agents/agent-launch-process.js';
import type { PreparedLaunch } from '../../src/adapters/agents/agent-launch-context.js';
import { spawnAndTee } from '../../src/adapters/process/spawn-tee.js';
import { reportWorkflowProviderStarted } from '../../src/application/ports/mission-write-authorization.js';
import type { ParallixConfiguration } from '../../src/application/ports/configuration.js';
import { agentRunId, agentRunIdentity } from '../../src/domain/agent-run.js';
import { resolveCanonicalRepositoryId } from '../../src/adapters/git/repository-identity.js';
import { missionRunsDir, openRunCapture } from '../../src/adapters/filesystem/run-history-store.js';
import { missionRepositoryKey } from '../../src/adapters/filesystem/mission-repository-key.js';

export async function barrier(root: string, name: string) {
  fs.writeFileSync(path.join(root, `${name}.entered`), 'entered');
  const deadline = Date.now() + 20_000;
  while (!fs.existsSync(path.join(root, `${name}.release`))) {
    if (Date.now() >= deadline) { throw new Error(`Fixture barrier expired: ${name}`); }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

export async function fixtureProvider(root: string, slug: string, configuration: ParallixConfiguration, family = 'codex', attempt = 1) {
  const script = `const fs=require('fs'); const base=process.argv[1]; fs.writeFileSync(base+'.entered',String(process.pid)); console.log('PROVIDER-READY'); const timer=setInterval(()=>{if(fs.existsSync(base+'.release')) {clearInterval(timer);console.log('PROVIDER-EXIT');process.exit(0)}},10); process.on('SIGTERM',()=>process.exit(0)); setTimeout(()=>process.exit(9),20000).unref();`;
  const prepared: PreparedLaunch = {
    launcher: options => ({ invocation: { command: process.execPath, args: ['-e', script, path.join(root, `${slug}.provider-${attempt}`)] },
      resultPromise: spawnAndTee(process.execPath, ['-e', script, path.join(root, `${slug}.provider-${attempt}`)], { ...options.teeOptions, configuration, cwd: root }) }),
    agentEnv: {}, resume: false, sessionId: null, launchSessionMarkerPort: undefined, sessionRole: 'execute', actualPrompt: 'fixture', model: null,
    watchdogConfig: null, customReservation: null, effectiveProfile: null, nativeSandbox: false,
  };
  // All effects consumed by launchPrepared are real; unused loop/selection dependencies are absent.
  const deps: Parameters<typeof launchPrepared>[1] = { configuration, step: 'execute', slug, worktree: root, role: 'execute', log: console.log, unrefChild: false,
    onLaunch: () => reportWorkflowProviderStarted(family) };
  return launchPrepared(prepared, deps, family, attempt);
}

/** Mirror retained legacy/interrupted populations without reading or changing operator state. */
export function seedRetainedProviderHistory(root: string, mission: string): void {
  const old = new Date('2026-10-12T00:00:00Z');
  const identity = agentRunIdentity({ repositoryId: resolveCanonicalRepositoryId(root), missionId: mission, role: 'execute', family: 'codex', attempt: 1, startedAtMs: old.getTime() });
  const capture = openRunCapture({ worktree: root, identity, runId: agentRunId(identity), terminalHost: 'pipe', now: () => old });
  const template = capture.finish({ exitCode: 0, signal: null });
  const repositoryKey = missionRepositoryKey(root);
  for (let index = 0; index < 58; index++) {
    const coordinator = index >= 41;
    const runId = coordinator ? `workflow-00000000-0000-0000-0000-${String(index).padStart(12, '0')}`
      : agentRunId({ ...identity, startedAtMs: identity.startedAtMs + index });
    const legacy = index >= 33 && !coordinator;
    const dir = path.join(missionRunsDir(root, mission), runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ ...template, runId,
      captureKind: legacy ? undefined : coordinator ? 'coordinator' : 'agent', family: coordinator ? null : 'codex',
      repositoryId: legacy ? undefined : template.repositoryId, repositoryKey: legacy ? repositoryKey : undefined,
      state: legacy && index !== 40 ? 'running' : 'exited', exitCode: legacy ? null : 0,
      endedAt: legacy && index !== 40 ? null : template.endedAt,
      execution: legacy && index % 2 ? undefined : null, supervisorPid: 999_999_999, operationId: 'historical-operation',
    }));
    fs.utimesSync(dir, old, old);
  }
}
