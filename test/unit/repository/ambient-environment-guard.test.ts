/**
 * TASK-2668.05 — environment variables are interpreted only in
 * src/composition/config.ts. Production code may still spread the host
 * environment into a child-process environment (`...process.env`), but must not
 * read an individual variable. Files listed below are pre-existing debt being
 * migrated to typed configuration slices; the stale-entry test fails once a
 * file is clean so the list only shrinks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'src');
const CONFIG_MODULE = 'src/composition/config.ts';

const AMBIENT_READ = /\bprocess\.env\b/;
const FORWARDING = /\.\.\.\s*\(?[^)\n]*process\.env\b/;
const INJECTED_VARIABLE = /\b(?:env|environment|processEnv|inheritEnv|baseEnv)\??\.[A-Z][A-Z0-9_]{2,}\b|\b(?:env|environment)\[\s*['"A-Z]/;

const PENDING_MIGRATION: readonly string[] = [
  'src/adapters/agents/agent-stream-view.ts',
  'src/adapters/agents/agents.ts',
  'src/adapters/agents/claude-stream-view.ts',
  'src/adapters/agents/codex.ts',
  'src/adapters/agents/launcher-selection.ts',
  'src/adapters/agents/opencode-export.ts',
  'src/adapters/agents/opencode.ts',
  'src/adapters/agents/pi.ts',
  'src/adapters/agents/run-session.ts',
  'src/adapters/cli/commands/draft-stats.ts',
  'src/adapters/cli/commands/status-adapter.ts',
  'src/adapters/cli/commands/status.ts',
  'src/adapters/config/product-config.ts',
  'src/adapters/config/repository-gates.ts',
  'src/adapters/config/state-homes.ts',
  'src/adapters/filesystem/mission-graphify.ts',
  'src/adapters/filesystem/mission-paths.ts',
  'src/adapters/forgejo/forgejo-auth.ts',
  'src/adapters/git/worktree.ts',
  'src/adapters/process/bubblewrap.ts',
  'src/adapters/process/terminal-state-root.ts',
  'src/adapters/process/tmux-host.ts',
  'src/adapters/review/review-adapter.ts',
  'src/adapters/review/review-event-handlers.ts',
  'src/adapters/review/review-loop.ts',
  'src/adapters/review/review-polling.ts',
  'src/adapters/review/review-submit-round.ts',
  'src/adapters/review/setup-review.ts',
  'src/adapters/sqlite/adapter-factory.ts',
  'src/adapters/sqlite/database-adapter.ts',
  'src/adapters/storage/child-cli.ts',
  'src/adapters/storage/storage.ts',
  'src/adapters/verification/gatekeeper.ts',
  'src/adapters/verification/verification.ts',
  'src/application/integrate/preflight.ts',
  'src/application/integrate/support.ts',
  'src/application/integrate-workflow.ts',
  'src/application/presentation/cli-format.ts',
  'src/application/recovery-evidence.ts',
  'src/composition/mission-terminal.ts',
  'src/interfaces/cli/integrate.ts',
];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { return sourceFiles(full); }
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : [];
  });
}

function code(line: string): string {
  return line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
}

function interpretedReads(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split('\n').flatMap((raw, index) => {
    const line = code(raw);
    const ambient = AMBIENT_READ.test(line) && !FORWARDING.test(line);
    return ambient || INJECTED_VARIABLE.test(line) ? [`${path.relative(ROOT, file)}:${index + 1}`] : [];
  });
}

const offenders = new Map<string, string[]>();
for (const file of sourceFiles(SRC)) {
  const rel = path.relative(ROOT, file);
  if (rel === CONFIG_MODULE) { continue; }
  const reads = interpretedReads(file);
  if (reads.length) { offenders.set(rel, reads); }
}

test('production code interprets environment variables only in the composition config module (TASK-2668.05)', () => {
  const unlisted = [...offenders].filter(([file]) => !PENDING_MIGRATION.includes(file));
  assert.deepEqual(
    unlisted.map(([file, reads]) => `${file}: ${reads.join(', ')}`),
    [],
    'Read the variable in src/composition/config.ts and pass the typed slice inward; spreading process.env into a child environment is the only other allowed use.',
  );
});

test('pending-migration list names only files that still interpret the environment (TASK-2668.05)', () => {
  const stale = PENDING_MIGRATION.filter(file => !offenders.has(file));
  assert.deepEqual(stale, [], 'Remove migrated files from PENDING_MIGRATION.');
});
