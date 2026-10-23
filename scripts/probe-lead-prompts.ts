import { operatorDecisionRequest } from '../src/application/operator-decision.js';
import { missionId } from '../src/domain/mission.js';
import { agentFamily } from '../src/domain/agents.js';
/** Final native-adapter capture with a doubled process boundary and isolated state. */
import { buildExecutePrompt } from '../src/adapters/cli/commands/active.js';
import { buildCompactActOnReviewPrompt } from '../src/adapters/review/review-prompts.js';
import { recoveryInstruction } from '../src/application/recovery-supervisor.js';
import { buildFreshDiagnosticRepairPrompt } from '../src/application/rebound-prompts.js';
import { FRESH_SESSION_MARKER_PORT } from '../src/application/fresh-session-marker-port.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startAgent } from '../src/adapters/agents/agents.js';
import * as codex from '../src/adapters/agents/codex.js';
import * as claude from '../src/adapters/agents/claude.js';
import * as qwen from '../src/adapters/agents/qwen.js';
import { setBubblewrapProbeForTest, wrapWithBubblewrap } from '../src/adapters/process/bubblewrap.js';
import { resolveConfiguration } from '../src/composition/config.js';
import { shouldResume, type SessionMarker } from '../src/domain/session.js';
import type { SessionMarkerPort } from '../src/application/domain-ports.js';
import type { AgentProcessSpawn } from '../src/adapters/agents/agent-process-types.js';
const slug = 'task-audit';
const prompts = {
  execute: buildExecutePrompt(slug, 'No checkpoint evidence recorded.', { rootDir: process.cwd() }),
  actOnReview: buildCompactActOnReviewPrompt({ implementer: 'codex', branch: `mission/${slug}`, attempt: 1, repoRoot: process.cwd() }),
  gateRepair: buildFreshDiagnosticRepairPrompt({ label: 'GATE FAILURE', slug, worktree: process.cwd(), area: 'unit', facts: [], diagnostic: 'fixture failure', classification: { failureClass: 'GateFailure', dispatchAction: 'AutoSendBack', isRelaunchable: true, label: 'fixture' }, attempt: 1, maxAttempts: 2, remedy: 'The harness reruns the failed gate.' }),
  recovery: recoveryInstruction({ missionId: slug, lane: 'active', diagnostic: 'fixture attention', attemptedOperation: 'px active task-audit' }),
};
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-prompt-capture-'));
const home = path.join(temporary, 'home'); fs.mkdirSync(home);
const cli = path.join(temporary, 'configured px');
const configuration = resolveConfiguration({ HOME: home, PATH: process.env.PATH,
  PARALLIX_CLI_COMMAND: cli, PARALLIX_TERMINAL_STATE_DIR: path.join(temporary, 'terminal') });
const launches: Array<Record<string, unknown>> = [];
const families = ['codex', 'claude', 'qwen'] as const;
type Family = typeof families[number];
async function capture(stage: keyof typeof prompts, initial: Family, fresh: boolean, fallback?: Family) {
  const worktree = path.join(temporary, `${stage}-${initial}${fallback ? '-fallback' : ''}`); fs.mkdirSync(worktree);
  fs.writeFileSync(path.join(worktree, 'workflow.config.json'), JSON.stringify({ agents: {
    terminal: { host: 'pipe' }, sandbox: true,
  } }));
  const marker: SessionMarker = { missionId: missionId(slug), role: 'execute', agent: agentFamily(initial),
    lastLaunched: new Date().toISOString(), sessionId: 'c0ffee00-0000-4000-8000-000000000001' };
  const markerWrites: Array<{ action: string; agent?: string }> = [];
  const normalMarkers: SessionMarkerPort = { find: async () => marker,
    shouldResume: async (id, role, family) => shouldResume(marker, id, role, family),
    save: async value => { markerWrites.push({ action: 'save', agent: value.agent }); },
    delete: async () => { markerWrites.push({ action: 'delete' }); } };
  const captures: Array<Record<string, unknown>> = [];
  const spawn: AgentProcessSpawn = async (command, args, options) => {
    const family = String(options?.env?.FORGEJO_USER);
    captures.push({ family, command, args, input: options?.input ?? null, cwd: options?.cwd,
      confinementInvocation: wrapWithBubblewrap(command, args, worktree, configuration),
      permissionConfiguration: family === 'qwen'
        ? JSON.parse(fs.readFileSync(qwen.qwenSettingsPath(worktree), 'utf8')).tools : null,
      environment: Object.fromEntries(['FORGEJO_USER', 'HOME', 'CODEX_HOME', 'QWEN_HOME']
        .flatMap(key => options?.env?.[key] ? [[key, options.env[key]]] : [])) });
    return { status: 0, signal: null, stdout: '', stderr: '' };
  };
  for (const adapter of [codex, claude, qwen]) { adapter.__setSpawnAndTeeForTest(spawn); }
  let limited = false;
  const result = await startAgent(stage === 'actOnReview' ? 'act-on-review' : 'execute', {
    configuration, worktree, agent: initial, slug, role: 'implementer',
    prompt: actual => stage === 'actOnReview'
      ? buildCompactActOnReviewPrompt({ implementer: initial, actualImplementer: actual,
        branch: `mission/${slug}`, attempt: 1, repoRoot: process.cwd() })
      : prompts[stage],
    sessionMarkerPort: fresh ? FRESH_SESSION_MARKER_PORT : normalMarkers,
    isAgentBlockedFn: () => false, assertAgentSupportedFn: () => {},
    resolveAgentModelFn: family => `fixture-${family}`,
    selectAgentFn: () => fallback ?? initial,
    detectLimitHitFn: () => {
      if (!fallback || limited) { return null; }
      limited = true;
      return { until: '2099-01-01 00', source: 'fixture', reason: 'deliberate capture-only fallback' };
    },
    updateAgentBlockFn: () => ({}), log: () => {}, noOutputWatchdog: false,
  });
  assert.equal(captures.length, fallback ? 2 : 1);
  assert.equal(result.agent, fallback ?? initial);
  for (const entry of captures) {
    assert.match(String(entry.input), new RegExp(cli.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const resumed = (entry.args as string[]).some(value => ['resume', '--resume', '-r'].includes(value));
    assert.equal(resumed, !fresh && entry.family === initial);
    if (stage === 'actOnReview') { assert.ok(String(entry.input).includes(`family: \`${entry.family}\``)); }
  }
  if (fresh) { assert.deepEqual(markerWrites, []); }
  launches.push({ stage, initial, fallback: fallback ?? null, fresh, markerBefore: marker,
    markerWrites, selected: result.agent, captures });
}
try {
  // The native adapter's process seam is doubled; no provider or model is run.
  setBubblewrapProbeForTest(() => true);
  for (const family of families) { await capture('execute', family, false); }
  await capture('actOnReview', 'codex', false);
  await capture('gateRepair', 'codex', true);
  await capture('recovery', 'codex', true);
  await capture('actOnReview', 'codex', false, 'qwen');
} finally {
  for (const adapter of [codex, claude, qwen]) { adapter.__setSpawnAndTeeForTest(null); }
  setBubblewrapProbeForTest(null);
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log(JSON.stringify({ prompts, launches,
  captureBoundary: 'Actual launch preparation and native adapter arguments at the doubled spawnAndTee seam; no model call or live tool execution.',
  cleaned: !fs.existsSync(temporary),
  operatorJudgment: operatorDecisionRequest({ missionId: slug, version: 1, operationId: null, progress: 'fixture-head/active', lane: 'active', working: false, observedAt: 0, allowedActions: ['wait', 'request-evidence', 'continue', 'escalate'], evidence: [{ ref: 'mission:task-audit@1', summary: 'fixture attention' }] }), freshSession: {
  marker: await FRESH_SESSION_MARKER_PORT.find(missionId(slug), 'execute'),
  resumes: await FRESH_SESSION_MARKER_PORT.shouldResume(missionId(slug), 'execute', agentFamily('codex')),
} }, null, 2));
