// @ts-nocheck -- TASK-2642: bounded real-agent evaluation of recovery-evidence retrieval.

// Tier 2 blocking e2e: proves the capability criterion 6 demands — a configured
// real agent actually RETRIEVES the hidden failure that a large passing prefix
// and a later passing-looking summary hide from the terminal tail, and identifies
// the repair target, rather than only passing a prompt that merely mentions the
// evidence route. Real model traffic stays here (agent-e2e), never in unit tests.
//
// Scenario, end to end through the production `px` CLI:
//   1. A small throwaway repository holds a mission whose verification gate runs
//      `bash ./verify.sh docs`, a script that prints a large PASSING prefix, then
//      a single hidden assertion failure, then a PASSING-LOOKING parallel summary.
//      The actionable failure is therefore invisible to the terminal tail and to
//      any generic final error (the exact TASK-2637.03 loss this mission exists to
//      prevent).
//   2. `px active` runs the gate, it fails, and the rebound kernel captures the
//      full failed command to durable per-mission recovery evidence BEFORE it
//      launches a repair agent.
//   3. The repair agent is launched with the recovery evidence route, which names
//      the retained command and gives the `lookupRecoveryEvidence` retrieval route.
//   4. This evaluation checks the repair agent actually retrieves the hidden
//      failure through that route and identifies the repair target.
//
// It reports three outcomes separately, as criterion 6 requires: retrieval
// success, repair outcome, and context cost.
//
// This gate requires a workstation with the configured codex runner reachable.
// It is intentionally narrow: one bounded repair launch against one hidden
// failure, not a full mission lifecycle.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import childProcess from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTempRootRegistry } from '../../../src/adapters/verification/temp-root-registry.js';
import { recoveryEvidenceFileSystem } from '../../../src/adapters/filesystem/recovery-evidence-fs.js';
import { lookupRecoveryEvidence, listRecoveryEvidence } from '../../../src/application/recovery-evidence.js';

const tempRootRegistry = createTempRootRegistry();
process.on('SIGINT', () => { tempRootRegistry.cleanup(); process.exit(130); });
process.on('SIGTERM', () => { tempRootRegistry.cleanup(); process.exit(143); });
process.on('exit', () => tempRootRegistry.cleanup());

const CLI_ENTRY = path.resolve(import.meta.dirname, '..', '..', '..', 'build', 'px.mjs');

// Bounded: the repair launch is one session against one hidden failure. Extend
// only via the env override, never by raising the default — a runaway model run
// must fail the gate, not silently consume the machine.
const RUN_TIMEOUT_MS = Number(process.env.PARALLIX_RECOVERY_E2E_TIMEOUT_MS || 600000);
// The active phase may relaunch the agent through the bounded rebound budget
// (gate fails, repair, re-run), so it needs more than a single run budget.
const ACTIVE_TIMEOUT_MS = RUN_TIMEOUT_MS * 2;
const OVERRIDE_AGENT = process.env.PARALLIX_REAL_AGENT || 'codex';
const SMOKE_AGENT = OVERRIDE_AGENT === 'custom' ? 'custom' : 'codex'; // only codex/custom are valid here
const LOCAL_E2E_API_KEY = 'parallix-pi-e2e-local-key';
const KEEP_TMP = process.env.PARALLIX_E2E_KEEP_TMP === '1';

function runCommand(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error && result.status === null) { throw result.error; }
  return result;
}

function runGit(cwd, args) {
  const result = runCommand('git', args, { cwd });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return (result.stdout || '').trim();
}

function maybeCommandPath(command) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) {continue;}
    const candidate = path.join(dir, command);
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; }
    catch { /* keep looking */ }
  }
  const probe = runCommand('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' });
  const line = (probe.stdout || '').trim();
  return line && fs.existsSync(line) ? line : null;
}

function requireCommandPath(command) {
  const resolved = maybeCommandPath(command);
  if (!resolved) { throw new Error(`Could not resolve ${command} on PATH: ${command}`); }
  return resolved;
}

/**
 * Build a throwaway repository that reaches `active` with a verification gate
 * whose actionable failure is hidden between a large passing prefix and a
 * passing-looking summary. The gate script is the whole point: it must reproduce
 * the TASK-2637.03 shape so the recovery evidence is genuinely exercised.
 */
function setupRepository() {
  const tmpRoot = tempRootRegistry.register(fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-recovery-e2e-')));
  const repoRoot = path.join(tmpRoot, 'repo');
  const stateHome = path.join(tmpRoot, 'parallix-home');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(stateHome, { recursive: true });

  for (const dir of [
    'backlog/tasks', 'backlog/drafts', 'backlog/completed', 'backlog/archive/tasks',
    'backlog/archive/drafts', 'backlog/decisions', 'backlog/docs', 'backlog/milestones',
    'config', 'scripts',
  ]) { fs.mkdirSync(path.join(repoRoot, ...dir.split('/')), { recursive: true }); }

  runGit(repoRoot, ['init', '-b', 'main']);
  runGit(repoRoot, ['config', 'user.email', 'e2e@parallix.test']);
  runGit(repoRoot, ['config', 'user.name', 'E2E']);
  // A committed base tree so the mission worktree has something to branch from.
  fs.writeFileSync(path.join(repoRoot, 'README.md'), '# recovery-e2e\n', 'utf8');
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-m', 'base']);

  // A real backlog task the draft can turn into a mission. Filename and the
  // uppercase frontmatter id must match what the backlog adapter resolves.
  const taskFile = path.join(repoRoot, 'backlog', 'tasks', 'task-6420 - hidden-failure-reproduction.md');
  fs.writeFileSync(taskFile, [
    '---',
    'id: TASK-6420',
    'title: Hidden-failure reproduction',
    'status: backlog',
    'assignee: []',
    "created_date: '2026-07-01 00:00'",
    'labels: [task]',
    'dependencies: []',
    '---',
    '',
    '## Description',
    '',
    'Reproduce the task-2637.03 loss: a verification command whose actionable',
    'failure sits between a large passing prefix and a later passing-looking',
    'parallel summary, hidden from the terminal tail and generic final error.',
    '',
  ].join('\n'), 'utf8');
  void taskFile;

  // The verification gate. It reproduces the TASK-2637.03 shape: a large
  // PASSING prefix, a single hidden assertion failure, then a PASSING-LOOKING
  // summary, so the actionable failure falls outside the inline diagnostic window
  // (the last 8000 output chars) and the repair target is unknowable from the
  // repository or the prompt. The failure is real (non-zero exit) so the rebound
  // kernel captures it and launches a repair. It is also fixable: the gate fails
  // because marker.txt does not hold the retained cause token; a repair that
  // actually read the recovered evidence writes that token into marker.txt and
  // clears the gate on the first relaunch (one model session, not the full
  // bounded budget), after which the gate passes.
  //
  // The cause token is generated once, written to the durable stderr evidence,
  // and is NOT present in the repository: only the recovered-evidence route can
  // deliver it, so clearing the gate proves the agent retrieved the hidden
  // failure rather than reading it from a tracked file.
  const verifyScript = path.join(repoRoot, 'scripts', 'verify.sh');
  const verifySource = `#!/usr/bin/env bash
# TASK-2642 E2E fixture: hidden actionable failure, evidence-only repair target.
set -u

[ -f .pre-draft-provisioned ] || { echo "verify.sh: this worktree was not provisioned" >&2; exit 1; }

# Durable evidence from the first failed run (attempt-1). Present only on a
# re-run: the original failure wrote the cause token into its stream.
EVDIR=".workflow/recovery-evidence"
EVFILE="$(find "$EVDIR" \( -name 'attempt-1.stdout.txt' -o -name 'attempt-1.stderr.txt' \) 2>/dev/null | head -1)"

if [ -n "$EVFILE" ]; then
  # Re-run: read the retained cause token from the durable evidence and clear the
  # gate only when marker.txt matches it. Otherwise fail and bury the failure
  # under a large healthy summary so it falls outside the inline diagnostic.
  EXPECTED="$(grep -Eo 'ACTION_TOKEN=[A-F0-9]{16}' "$EVFILE" 2>/dev/null | head -1 | cut -d= -f2)"
  if [ -n "$EXPECTED" ] && [ -f marker.txt ] && [ "$(cat marker.txt 2>/dev/null)" = "ACTION_TOKEN=$EXPECTED" ]; then
    echo "[PASS] post-fix verification ok"
    j=0
    while [ $j -lt 400 ]; do echo "[PASS] post-fix check $j ok"; j=$((j+1)); done
    echo "All checks passed"
    exit 0
  fi
  # Bury the failure under a large healthy stdout summary (past the last 8000
  # chars) so the inline diagnostic shows only healthy output.
  echo "[unit-test-budget:exceeded] marker.txt not applied; expected ACTION_TOKEN=$EXPECTED"
  j=0
  while [ $j -lt 400 ]; do echo "[PASS] parallel check $j ok (summary healthy)"; j=$((j+1)); done
  echo "Running 12 parallel checks... all green (summary looks healthy)"
  exit 1
fi

# First run: no evidence yet. Generate the cause token, emit it to stdout so it
# is captured into durable evidence, then fail (marker.txt is absent). Bury the
# failure under a large healthy summary (past the last 8000 chars).
TOKEN="ACTION_TOKEN=$(tr -dc 'A-F0-9' < /dev/urandom | head -c 16)"
echo "[unit-test-budget:exceeded] marker.txt missing; expected $TOKEN"
j=0
while [ $j -lt 400 ]; do echo "[PASS] parallel check $j ok (summary healthy)"; j=$((j+1)); done
echo "Running 12 parallel checks... all green (summary looks healthy)"
exit 1
`
  fs.writeFileSync(verifyScript, verifySource + '\n', 'utf8');
  fs.chmodSync(verifyScript, 0o755);

  // A fresh, minimal workflow.config.json (built like the real-agent smoke
  // fixture): pin the codex model, isolate state, force the codex family so no
  // other (costlier) agent can be selected, and point the gate at the failing
  // verify.sh. Deliberately omits any npm pre/post commands so the throwaway
  // repo needs no package-lock.json for the draft to reach the active phase.
  const isolated = {
    product: { name: 'recovery-e2e', targetUser: 'tests' },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
      agents: {
        models: { codex: 'gpt-5.6-terra' },
        blocklist: {
          claude: { blocked: true }, vibe: { blocked: true }, qwen: { blocked: true },
          custom: { blocked: true }, codex: { blocked: false },
        },
      },
      missions: { baseDir: 'missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
      verification: { command: './scripts/verify.sh {{area}}', defaultArea: 'docs' },
      draft: { preDraftCommand: `touch .pre-draft-provisioned` },
      review: { provider: 'none', tmpDir: '.workflow/review-artifacts' },
    },
  };
  fs.writeFileSync(path.join(repoRoot, 'workflow.config.json'), `${JSON.stringify(isolated, null, 2)}\n`, 'utf8');

  fs.writeFileSync(path.join(repoRoot, 'config', 'state-map.json'), '{}', 'utf8');
  // config/agents.json is committed repo config in a real repo (working-tree
  // copy is authoritative, ADR 0044). Seed it so first-run-config's idempotent
  // hook leaves it un-dirtied during active.
  const agentsConfigSource = path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'config', 'agents.json',
  );
  fs.writeFileSync(
    path.join(repoRoot, 'config', 'agents.json'),
    fs.existsSync(agentsConfigSource)
      ? fs.readFileSync(agentsConfigSource, 'utf8')
      : JSON.stringify({ steps: {} }, null, 2) + '\n',
    'utf8',
  );
  fs.writeFileSync(path.join(repoRoot, '.gitignore'), [
    '.workflow/', '.sessions/', '.forgejo-local/', '.pre-draft-provisioned',
    'workflow/.cache/', 'workflow/.sessions/', 'workflow/config/agents.local.json', 'agents.local.json', '',
  ].join('\n'), 'utf8');
  // The draft preflight rejects uncommitted repo-state config: the mission
  // worktree is created from HEAD, so commit the base tree (config + task) first.
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-m', 'initial recovery-e2e repo']);

  return { tmpRoot, repoRoot, stateHome };
}

function envFor(repo) {
  const binDir = path.join(repo.tmpRoot, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  fs.symlinkSync(requireCommandPath('git'), path.join(binDir, 'git'));
  fs.symlinkSync(requireCommandPath('bash'), path.join(binDir, 'bash'));
  // Codex launcher resolves its executable from CODEX_BIN first; pin it so the
  // run exercises this checkout's configured adapter, not an ambient one.
  const codexBin = requireCommandPath('codex');
  const env = {
    ...process.env,
    FORCE_COLOR: '0',
    PRIMARY_WORKTREE: repo.repoRoot,
    PARALLIX_HOME: repo.stateHome,
    NPM_CONFIG_CACHE: path.join(repo.tmpRoot, 'npm-cache'),
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
    CODEX_HOME: path.join(repo.tmpRoot, 'codex-home'),
    DEBUG: '1',
  };
  env.CODEX_BIN = codexBin;
  delete env.PWD;
  return env;
}

/**
 * Drive the mission to the active phase and let its verification gate fail with
 * a hidden failure. Returns the active run result plus the captured repair
 * prompt, so the evaluation can check what the repair agent was handed.
 */
function driveToRecovery(repo, env) {
  const slug = 'task-6420';
  const draft = runCommand(process.execPath, [CLI_ENTRY, 'draft', slug, '--agent', 'codex'], {
    cwd: repo.repoRoot, env, timeout: RUN_TIMEOUT_MS,
  });
  if (draft.status !== 0) {
    assert.fail(`[recovery-e2e] px draft failed (status=${draft.status}): ${draft.stderr || draft.stdout}`);
  }
  // `px active` runs from the mission worktree (PWD + branch preflight), which
  // is the same layout a real implementer session uses.
  const worktree = path.resolve(repo.repoRoot, '..', `${path.basename(repo.repoRoot)}-${slug}`);
  // Provision marker so the gate runs in this worktree (not a phantom checkout).
  fs.writeFileSync(path.join(worktree, '.pre-draft-provisioned'), 'e2e', 'utf8');
  // The gate fails because marker.txt does not hold the retained cause token.
  // A repair that read the recovered evidence writes that token into marker.txt
  // and clears the gate on the first relaunch (one model session, not the full
  // bounded budget), after which the gate passes.
  const active = runCommand(process.execPath, [CLI_ENTRY, 'active', slug, '--implementer', 'codex'], {
    cwd: worktree, env, timeout: ACTIVE_TIMEOUT_MS,
  });
  return { slug, active, worktree };
}

/**
 * Read the retained stdout/stderr streams a reference points at, via the same
 * port the production store uses. Returns the combined stream text so the
 * evaluation can assert the stranded hidden failure is actually on disk.
 */
function readStreamFiles(ref: { stdoutPath: string; stderrPath: string }): string {
  let text = '';
  for (const file of [ref.stdoutPath, ref.stderrPath]) {
    try { text += fs.readFileSync(file, { encoding: 'utf8' }); } catch { /* missing stream: not fatal */ }
  }
  return text;
}

/**
 * A bounded configured-agent evaluation. Reports three outcomes separately, as
 * criterion 6 requires: retrieval success, repair outcome, and context cost.
 */
function evaluate({ slug, active, worktree, repo, env }) {
  const stdout = `${active.stdout || ''}${active.stderr || ''}`.replace(/\x1B\[[0-9;]*m/g, '');

  // Repair outcome: did the bounded repair launch run at all, and how did it end?
  const repairOutcome = active.status === 0 ? 'passed' : (active.status ?? null);

  // Retrieval success. This must prove the CONFIGURED AGENT retrieved the
  // retained output, not that this test happened to call the retrieval interface
  // after the agent finished (which would be a proxy the agent could bypass by
  // fixing the fixture from the inline failure diagnostic alone).
  //
  // Three independent guards, all required, that together rule out every
  // shortcut the agent could take without retrieving:
  //
  //   1. `retrieved` / `hiddenFailureDelivered` — the retrieval interface,
  //      executed with the same production filesystem adapter the kernel bound,
  //      actually DELIVERS the stranded cause token from the durable store. This
  //      is the criterion 6 capability (the failure behind a large passing
  //      prefix and a passing-looking summary is retrievable, not merely present
  //      as a file on disk — existence is satisfiable without retrieval).
  //   2. `meansInsufficient` — the parent CLI output the agent was handed does
  //      NOT contain the actual cause token. If the inline diagnostic had
  //      revealed it, the agent could fix the fixture without the retrieval
  //      route, so a correct fix would prove nothing about retrieval. The
  //      fixture buries the failure past the last 8000 output chars so the
  //      inline diagnostic shows only healthy output.
  //   3. `noRepoLeak` — the cause token does NOT exist anywhere in the tracked
  //      repository (other than the agent's own repair artifact). If it were a
  //      pre-existing tracked file, the agent could read it directly and
  //      retrieval would be inferred, not proven. The only remaining source is
  //      the recovered-evidence route.
  //
  // `meansPresent` records that the agent was given a working route (its
  // opportunity). The proof of retrieval is the conjunction: the interface
  // delivered the token, the agent had to go past the inline prompt and the
  // repository, and it wrote the token to the right target.
  const retrieval = { meansPresent: false, meansInsufficient: false, noRepoLeak: false, retrieved: false, hiddenFailureDelivered: false };
  // The cause token the recovered evidence supplies. Hoisted so the repair
  // target can confirm the agent wrote the exact retrieved value.
  let causeToken = null;
  const causeTokenPattern = /ACTION_TOKEN=([A-F0-9]{16})/;
  try {
    retrieval.meansPresent = /Retained evidence for this failure/.test(stdout)
      && /lookupRecoveryEvidence/.test(stdout)
      && /verify\.sh docs/.test(stdout);
    // Exercise the interface exactly as a fresh-context/restarted agent in this
    // worktree would. The store the kernel wrote lives under the worktree; the
    // adapter reads it regardless of process. A named incident is required:
    // lookupRecoveryEvidence only resolves a named incident, so the incidentId
    // is taken from the durable list the kernel populated (without it the call
    // always returns `missing`).
    const ref = listRecoveryEvidence({ cwd: worktree, fs: recoveryEvidenceFileSystem })[0];
    if (ref) {
      const lookup = lookupRecoveryEvidence({ cwd: worktree, incidentId: ref.incidentId, fs: recoveryEvidenceFileSystem });
      if (lookup.ok && lookup.evidence) {
        const streams = readStreamFiles(lookup.evidence);
        retrieval.retrieved = true;
        const tokenMatch = streams.match(causeTokenPattern);
        causeToken = tokenMatch ? tokenMatch[1] : null;
        // The delivered evidence must carry the actual stranded cause token, not
        // a placeholder — the failure behind the passing prefix is retrievable.
        retrieval.hiddenFailureDelivered = causeToken != null;
      }
    }
    // The inline prompt must not hand the agent the cause on a plate: the parent
    // CLI output must not contain the actual cause token. If it did, the agent
    // could fix the fixture without using the retrieval route.
    retrieval.meansInsufficient = causeToken != null && !stdout.includes(`ACTION_TOKEN=${causeToken}`);
    // The cause token must NOT exist anywhere in the tracked repository before the
    // agent acts. This is the reviewer's guard against "alternate repository
    // evidence": if the token were a pre-existing tracked file, the agent could
    // have read it directly and retrieval would be inferred, not proven. The
    // only remaining source is the recovered-evidence route, so a correct fix
    // proves the agent retrieved the hidden failure.
    if (causeToken != null) {
      const tracked = (runGit(worktree, ['ls-files']).split('\n') || []).map((f) => f.trim()).filter(Boolean);
      let leaked = false;
      for (const rel of tracked) {
        // Skip the repair artifact itself: the agent writes the retrieved token
        // into marker.txt, so it legitimately appears there after the fix.
        if (path.basename(rel) === 'marker.txt') { continue; }
        try {
          if (fs.readFileSync(path.join(worktree, rel), { encoding: 'utf8' }).includes(`ACTION_TOKEN=${causeToken}`)) {
            leaked = true; break;
          }
        } catch { /* unreadable tracked file: not a leak source */ }
      }
      retrieval.noRepoLeak = !leaked;
    }
  } catch { /* evaluation itself must not throw away the outcomes */ }

  // The repair target: did the agent actually identify and clear the failing
  // gate's cause? A passing run is not enough — assert the gate's marker file is
  // now in the correct state, so the agent fixed the real target (writing the
  // evidence-derived cause token) rather than the run merely exiting zero for
  // another reason.
  let repairTargetCleared = false;
  try {
    const marker = fs.readFileSync(path.join(worktree, 'marker.txt'), { encoding: 'utf8' });
    const markerMatch = marker.match(/ACTION_TOKEN=([A-F0-9]{16})/);
    // marker.txt must carry the exact cause token the recovered evidence
    // supplies (the fixture commits no token, and noRepoLeak proves the token
    // is not in the repository), so a match proves the agent repaired from
    // retrieval rather than from a committed or inline value.
    repairTargetCleared = causeToken != null && markerMatch != null && markerMatch[1] === causeToken;
  } catch { /* outcome reported, never fatal */ }

  // Context cost: tokens the bounded evaluation consumed, read from the same
  // measurement authority the product uses, reported not asserted.
  let contextCost = null;
  try {
    const db = path.join(repo.stateHome, 'parallix.db');
    // eslint-disable-next-line no-console
    console.error('[recovery-e2e-debug] db path', db, 'exists', fs.existsSync(db));
    if (fs.existsSync(db)) {
      const authority = new DatabaseSync(db, { readOnly: true });
      try {
        const rows = authority.prepare(
          "SELECT provider, model, input_tokens, output_tokens FROM usage_statistics WHERE mission = ? ORDER BY date"
        ).all(slug);
        contextCost = {
          provider: rows[0]?.provider ?? null,
          model: rows[0]?.model ?? null,
          totalInputTokens: rows.reduce((sum, r) => sum + Number(r.input_tokens ?? 0), 0),
          totalOutputTokens: rows.reduce((sum, r) => sum + Number(r.output_tokens ?? 0), 0),
          sessions: rows.length,
        };
      } finally { authority.close(); }
    }
  } catch { /* cost is reported, never fatal */ }

  return { retrieval, repairOutcome, contextCost };
}

test('task-2642: a bounded configured agent retrieves the hidden failure and names the repair target', {
  skip: SMOKE_AGENT !== 'codex',
}, async () => {
  const repo = setupRepository();
  const env = envFor(repo);
  try {
    const { slug, active, worktree } = driveToRecovery(repo, env);
    const result = evaluate({ slug, active, worktree, repo, env });

    // Capability: the retrieval interface actually delivers the hidden failure
    // from durable storage (criterion 6). Asserted as a property of the
    // interface, never as a stand-in for the agent's own action.
    assert.ok(result.retrieval.meansPresent, '[recovery-e2e] repair prompt must carry a working recovery evidence route');
    assert.ok(result.retrieval.retrieved, '[recovery-e2e] the retrieval interface must deliver the hidden failure from durable recovery evidence');
    assert.ok(result.retrieval.hiddenFailureDelivered, '[recovery-e2e] the delivered evidence must carry the stranded hidden failure text');
    // Agent retrieval: the inline prompt must NOT have revealed the cause
    // (meansInsufficient), the cause must not exist in the tracked repository
    // (noRepoLeak), and the agent must have cleared the correct target
    // (repairTargetCleared). Only the conjunction rules out fixing the fixture
    // from the inline diagnostic or a repository file alone — the agent had to
    // retrieve the retained output to know what to fix.
    assert.ok(result.retrieval.meansInsufficient, '[recovery-e2e] inline repair prompt must not reveal the hidden failure; the agent must retrieve it');
    assert.ok(result.retrieval.noRepoLeak, '[recovery-e2e] the cause must not exist in the tracked repository; the agent must retrieve it from the recovered-evidence route, not read it from a repo file');
    assert.ok(result.repairTargetCleared, '[recovery-e2e] the agent must identify and clear the gate\'s failing target (marker.txt carrying the evidence-derived cause token) — proving it retrieved the failure beyond the inline prompt and repository');

    // Report the three outcomes separately, never collapsed into one boolean.
    console.log(JSON.stringify({
      task: 'task-2642',
      retrievalSuccess:
        result.retrieval.meansPresent && result.retrieval.retrieved && result.retrieval.hiddenFailureDelivered
        && result.retrieval.meansInsufficient && result.repairTargetCleared,
      retrieval: result.retrieval,
      repairTargetCleared: result.repairTargetCleared,
      repairOutcome: result.repairOutcome,
      contextCost: result.contextCost,
    }, null, 2));
  } finally {
    if (!KEEP_TMP) {
      fs.rmSync(repo.tmpRoot, { recursive: true, force: true });
    }
    tempRootRegistry.release(repo.tmpRoot);
  }
});
