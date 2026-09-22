/**
 * TASK-2521.03 SC6 / AC #5 — prompt authority.
 *
 * The runtime prompts must route Mission context and checkpoint evidence
 * through supported `px` commands, and must not present repository workflow
 * metadata as the Mission database. These assertions are red against the
 * pre-mission prompts (which instructed agents to write `CP-N.md` as durable
 * evidence and to execute "per the contract in MISSION.md") and green after.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const promptDir = path.join(process.cwd(), 'prompts');

function prompt(name: string): string {
  return fs.readFileSync(path.join(promptDir, name), 'utf8');
}

function runtimePrompts(): { name: string; source: string }[] {
  return fs.readdirSync(promptDir)
    .filter((file) => file.endsWith('.md'))
    .map((name) => ({ name, source: prompt(name) }));
}

test('no runtime prompt instructs an agent to write a CP-N.md file as durable evidence', () => {
  for (const { name, source } of runtimePrompts()) {
    assert.ok(!/write `CP-N\.md`/.test(source), `${name} must not instruct writing CP-N.md as durable evidence`);
    assert.ok(
      !/create.{0,40}`?CP-\d*N?\.md`?.{0,40}(durable|evidence)/i.test(source),
      `${name} must not instruct creating a CP file as durable evidence`,
    );
  }
});

test('no runtime prompt presents repository workflow metadata as the Mission database', () => {
  for (const { name, source } of runtimePrompts()) {
    for (const match of source.matchAll(/^.*Mission database.*$/gm)) {
      assert.match(
        match[0],
        /is not the Mission database/,
        `${name} may only mention the Mission database to deny that workflow metadata is it`,
      );
    }
  }
});

test('the execute prompt reads Mission state and records only checkpoints', () => {
  const source = prompt('execute-core.md');
  assert.match(source, /px status \{\{slug\}\}/);
  assert.match(source, /px checkpoint record --name/);
  // An executing agent must not be able to rewrite the contract it is judged
  // against: goal, scope and gates are settled at draft.
  for (const write of [/px goal set/, /px scope set/, /px gate add/, /px gate remove/]) {
    assert.doesNotMatch(source, write, 'execute must not advertise a mission write');
  }
  assert.doesNotMatch(source, /--data <json>|--data-stdin/, 'no JSON request blob may be advertised');
  // AC #10: where the version comes from, and that a stale write changes nothing.
  assert.match(source, /--expected-version/);
  assert.match(source, /rejected with an explicit conflict and changes nothing/);
  // Lifecycle and review writes stay with the workflow, not the implementer.
  assert.match(source, /do not run .*`px active`.*`px review`/);
});

test('no runtime prompt tells an agent to read or write a workflow file for Mission state', () => {
  for (const { name, source } of runtimePrompts()) {
    assert.doesNotMatch(source, /px context/, `${name} must not name the retired context command`);
    assert.doesNotMatch(source, /px mission /, `${name} must not name the retired px mission namespace`);
    // Naming a workflow file even to deny it authority keeps it in the agent's
    // head as a place Mission state might live. The prompts must not mention
    // one at all.
    for (const file of [/MISSION\.md/, /\{\{missionPath\}\}/, /CP-\*\.md/, /review-state\.json/, /review-events/]) {
      assert.doesNotMatch(source, file, `${name} must not name a workflow file`);
    }
  }
});

test('the review and act-on-review prompts take Mission and review state from px status', () => {
  for (const name of ['review-core.md', 'act-on-review-core.md']) {
    const source = prompt(name);
    assert.match(source, /px status \{\{slug\}\}/, `${name} must name the supported read`);
  }
});
