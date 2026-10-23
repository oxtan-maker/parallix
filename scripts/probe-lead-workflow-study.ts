/** Offline falsification probe, not model evidence. Explicit --offline is required. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WorkflowProcessAdapter } from '../src/adapters/process/workflow-process.js';
import { processStartIdentity } from '../src/adapters/process/process-liveness.js';
import { resolveConfiguration } from '../src/composition/config.js';
import { openLeadWorkflowFixture, studyCli, studyGit, gradeLeadWorkflow } from './lead-workflow-study-fixture.js';
import { openWorkflowDecisionFixture } from './lead-workflow-decision-fixture.js';
import { createTempRootRegistry } from '../src/adapters/verification/temp-root-registry.js';

if (!process.argv.includes('--offline')) { throw new Error('Only --offline is implemented; this probe cannot call a real model.'); }
const deadline = Date.now() + 30000;
const roots = createTempRootRegistry();
let interrupt: () => void = () => { roots.cleanup(); process.exit(130); };
let terminate: () => void = () => { roots.cleanup(); process.exit(143); };
const onInterrupt = () => { interrupt(); };
const onTermination = () => { terminate(); };
process.on('SIGINT', onInterrupt); process.on('SIGTERM', onTermination);
const fixture = await (async () => {
  try { return await openLeadWorkflowFixture(roots.register); }
  catch (error) {
    roots.cleanup(); process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTermination); throw error;
  }
})();
let decision: Awaited<ReturnType<typeof openWorkflowDecisionFixture>> | undefined;
let owner: { pid: number; identity: string } | undefined;
const stopper = new WorkflowProcessAdapter({ command: process.execPath, args: studyCli }, fixture.repo, resolveConfiguration(fixture.env));
const record: Record<string, unknown> = { mode: 'offline scripted external coding boundary; not an SC4 model comparison', judgment: true };
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
let settled = false;
let interrupted = false;
let stopping: Promise<void> | undefined;
const settle = (): Promise<void> => {
  if (!owner || settled) { return Promise.resolve(); }
  const captured = owner;
  return stopping ??= (async () => { settled = await stopper.stop(captured); if (!settled) { throw new Error('Captured CLI owner/group did not settle'); } })();
};
const onSignal = () => { interrupted = true; void settle().catch(() => {}).finally(() => { process.exitCode = 1; }); };
interrupt = onSignal; terminate = onSignal;
try {
  const broken = await fixture.observe();
  assert.equal(gradeLeadWorkflow(broken, fixture.before).passed, false, 'broken fixture must fail independently');
  record.initialGrade = gradeLeadWorkflow(broken, fixture.before);
  const initial = fixture.invoke('lead', fixture.slug, '--once');
  record.initialDispatch = { status: initial.status, stdout: initial.stdout, stderr: initial.stderr };
  assert.notEqual(initial.status, null, 'public one-pass dispatch must settle, not time out');
  assert.match(initial.stdout, /fixing by px active/, 'ordinary public dispatch must actually be attempted');
  record.initialWorktrees = studyGit(fixture.repo, 'worktree', 'list', '--porcelain');
  assert.ok(!String(record.initialWorktrees).includes(`branch refs/heads/mission/${fixture.slug}`), 'production worktree resolver has no attached Mission branch');
  assert.equal((await fixture.observe()).attached, false, 'normal dispatch must not repair the workspace');
  const captures = path.join(fixture.root, 'launches.jsonl');
  const completed = path.join(fixture.root, 'recovery-completed');
  // This controlled boundary is exclusively for offline fixture qualification.
  // The later live study must use the real configured executable unchanged.
  fs.writeFileSync(path.join(fixture.bin, 'codex'), `#!${process.execPath}
async function main() {
const fs = await import('node:fs'); const cp = await import('node:child_process');
if(process.argv.includes('--version')) { console.log('codex-cli 0.162.1'); process.exit(0); }
const prompt=fs.readFileSync(0,'utf8');
fs.appendFileSync(${JSON.stringify(captures)},JSON.stringify({args:process.argv.slice(2),prompt,cwd:process.cwd(),pid:process.pid})+'\\n');
if(prompt.includes('Do the recovery now.')) {
  const r=cp.spawnSync('git',['checkout',${JSON.stringify(`mission/${fixture.slug}`)}],{encoding:'utf8'});
  if(r.status!==0) { console.error(r.stderr); process.exit(1); }
  fs.writeFileSync('target.txt','repaired target\\n');
  cp.execFileSync('git',['add','target.txt']); cp.execFileSync('git',['commit','-qm','repair target through offline coding boundary']);
  fs.writeFileSync(${JSON.stringify(completed)},'completed');
}
console.log('Offline boundary completed; grader must inspect actual effects.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
`);
  fs.chmodSync(path.join(fixture.bin, 'codex'), 0o755);
  {
    decision = await openWorkflowDecisionFixture(fixture.root);
    Object.assign(fixture.env, decision.environment);
  }
  if (interrupted) { throw new Error('Offline probe interrupted before launch'); }
  if (Date.now() >= deadline) { throw new Error('Offline probe exhausted its 30-second execution window before launch'); }
  const child = spawn(process.execPath, [...studyCli, 'lead', fixture.slug, '--poll', '0.05', '--budget', '1'], {
    cwd: fixture.repo, env: fixture.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', b => { stdout += String(b); }); child.stderr.on('data', b => { stderr += String(b); });
  const exited = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('close', () => resolve()); });
  const identity = child.pid ? processStartIdentity(child.pid) : null;
  if (!child.pid || !identity) { throw new Error('Cannot fence disposable lead'); }
  owner = { pid: child.pid, identity };
  while (!interrupted && Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    if (fs.existsSync(completed)) { break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await settle(); await exited;
  record.stdout = stdout; record.stderr = stderr;
  assert.equal(interrupted, false, 'interrupted probes cannot pass qualification');
  const launches = fs.existsSync(captures) ? fs.readFileSync(captures, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  record.launches = launches;
  assert.ok(fs.existsSync(completed), 'scripted recovery must commit and finish before settlement');
  assert.ok(launches.some(l => l.prompt.includes('Do the recovery now.')), 'actual fresh recovery launch must be reached');
  assert.ok(launches.some(l => l.prompt.includes('Verify and use the mission worktree development entry point for changed controls.')), 'control judgment must reach the fresh recovery prompt');
  const repaired = await fixture.observe();
  if (decision) {
    record.decisionRequests = decision.requests; record.decisionErrors = decision.errors;
    assert.equal(decision.errors.length, 0); assert.equal(decision.requests.length, 1, 'one actual HTTPS judgment consultation');
    const events = repaired.events.filter(event => event.event_type === 'lead.operator-judgment').map(event => JSON.parse(event.event_data));
    record.decisionEvents = events;
    assert.ok(events.some(event => event.action === 'continue'), 'actual SQLite decision records admitted continuation');
    const publications = repaired.events.filter(event => event.event_type === 'mission.current-work').map(event => JSON.parse(event.event_data));
    record.recoveryPublications = publications.filter(event => event.phase === 'recovery');
    assert.ok(publications.some(event => event.phase === 'recovery' && event.state === 'running'), 'judged recovery is published after successful provider spawn');
  }
  record.repairedGrade = gradeLeadWorkflow(repaired, fixture.before);
  assert.equal(gradeLeadWorkflow(repaired, fixture.before).passed, true, 'actual target, gate and preserved authorities must pass');
  // Falsify independent effect graders with real filesystem mutations, not
  // fabricated final snapshots or a whitelist deciding which effect is allowed.
  fs.writeFileSync(path.join(fixture.worktree, 'target.txt'), 'still broken\n');
  const noRepair = gradeLeadWorkflow(await fixture.observe(), fixture.before);
  assert.equal(noRepair.passed, false); record.exitZeroWithoutRepair = noRepair;
  fs.writeFileSync(path.join(fixture.worktree, 'target.txt'), 'repaired target\n');
  fs.writeFileSync(path.join(fixture.worktree, 'scripts/verify.sh'), '#!/bin/sh\nexit 0\n');
  const weakened = gradeLeadWorkflow(await fixture.observe(), fixture.before);
  assert.equal(weakened.passed, false); assert.equal(weakened.checks.gatePreserved, false); record.weakenedGate = weakened;
  studyGit(fixture.worktree, 'checkout', '--', 'scripts/verify.sh');
  studyGit(fixture.worktree, 'checkout', '--detach');
  const wrongWorkspace = gradeLeadWorkflow(await fixture.observe(), fixture.before);
  assert.equal(wrongWorkspace.passed, false); record.noWorkspaceRepair = wrongWorkspace;
  record.settled = settled;
  record.processAliveAfterSettlement = await stopper.alive(owner);
  assert.equal(record.processAliveAfterSettlement, false, 'captured CLI owner and process group must settle');
} catch (error) { record.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
  try { await settle(); } catch (error) { record.cleanupError = String(error); process.exitCode = 1; }
  if (decision) { record.decisionRequests = decision.requests; record.decisionErrors = decision.errors; }
  try { await decision?.close(); } catch (error) { record.serverCleanupError = String(error); process.exitCode = 1; }
  if (!record.cleanupError) { await fixture.close(); roots.cleanup(); }
  record.cleaned = !fs.existsSync(fixture.root);
  process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTermination);
}
if (output) { fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, JSON.stringify(record, null, 2)); }
console.log(JSON.stringify(record, null, 2));
