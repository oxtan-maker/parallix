/**
 * TASK-2521.03 — discovery of the Mission read and write surface from `px --help`.
 *
 * AC #1/#2: the help a fresh agent reads must name the command that reports
 * complete Mission state and the typed commands that change it, and must not
 * point the agent at a mission document or a checkpoint file as the authority.
 * The discovery chain asserted here is the one an agent actually walks: read
 * `px --help`, extract a command name, confirm it dispatches.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { KNOWN_COMMANDS, printUsage } from '../src/interfaces/cli/runtime.js';
import {
  ASSIGN_HELP,
  CHECKPOINT_HELP,
  GATE_HELP,
  GOAL_HELP,
  SCOPE_HELP,
} from '../src/interfaces/cli/mission-writes.js';

function captureUsage(): string {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (_c: string) => boolean }).write = (chunk: string) => {
    chunks.push(String(chunk));
    return true;
  };
  try { printUsage(); } finally {
    (process.stdout as unknown as { write: typeof original }).write = original;
  }
  return chunks.join('');
}

/** The only inputs a fresh agent is given: a Mission slug and `px --help`. */
function discoverReadCommand(help: string): string | null {
  const line = help
    .split('\n')
    .find((candidate) => /\bstatus\b/.test(candidate) && /--json/.test(candidate));
  return line ? (line.trim().split(/\s+/)[0] ?? null) : null;
}

test('fresh agent discovers the Mission read command from px --help alone', () => {
  const help = captureUsage();
  const discovered = discoverReadCommand(help);
  assert.equal(discovered, 'status', 'px --help must name the command that reports Mission state');
  assert.ok(KNOWN_COMMANDS.includes(discovered!), 'the discovered name must be a dispatchable command');
  assert.match(help, /--json/, 'px --help must show the machine-readable form');
});

test('AC #2: px --help names a typed write command for every mutable domain part', () => {
  const help = captureUsage();
  for (const [command, pattern] of [
    ['goal', /goal set .*--goal/],
    ['scope', /scope set .*--scope/],
    ['gate', /gate add\|remove .*--command/],
    ['criterion', /criterion add\|remove .*--text/],
    ['checkpoint', /checkpoint plan\|unplan\|record .*--name/],
    ['nel', /nel set .*--predicted/],
    ['assign', /assign --agent/],
  ] as const) {
    assert.match(help, pattern, `px --help must describe the ${command} write`);
    assert.ok(KNOWN_COMMANDS.includes(command), `${command} must be dispatchable`);
  }
  // The version an agent must supply is discoverable from the same help.
  assert.match(help, /--expected-version/, 'px --help must state that writes take a version');
});

test('px --help never points an agent at MISSION.md or CP-N.md as authority', () => {
  const help = captureUsage();
  assert.ok(!/MISSION\.md/.test(help), 'px --help must not name the mission document');
  assert.ok(!/CP-[\dN]\.md|CP-\*\.md/.test(help), 'px --help must not name checkpoint documents');
});

test('AC #11/#13: every write help uses typed flags, never a JSON request blob', () => {
  for (const help of [GOAL_HELP, SCOPE_HELP, GATE_HELP, CHECKPOINT_HELP, ASSIGN_HELP]) {
    assert.match(help, /--expected-version <n>/, 'every write documents its version flag');
    assert.doesNotMatch(help, /--data\b|--data-stdin|<json>/, 'no write takes a JSON request blob');
    assert.doesNotMatch(help, /MISSION\.md|CP-\d+\.md/, 'no write help names a workflow file');
  }
  // The slug is inferred, so the agent is never asked to thread it through.
  assert.match(GOAL_HELP, /\[--slug <slug>\]/);
});
