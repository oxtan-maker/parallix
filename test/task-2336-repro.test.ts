import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentFamily } from '../src/domain/agents.js';
import { resolveKnownAgentFamilies } from '../src/interfaces/tui/agent-config-resolver.js';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// task-2336 reproduction — the px board agent strip renders the literal
// fallback "agents: unavailable" because resolveKnownAgentFamilies only reads a
// top-level `families` array, which the shipped config/agents.json does not
// declare. With zero known families the availability list is empty and both the
// agent strip and the FLOW panel degrade to the placeholder.
// ---------------------------------------------------------------------------

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const plain = (value: string): string => value.replace(ANSI, '');

const repoRoot = path.resolve(__dirname, '..');

/** Copy the repository's real config/agents.json into a temp root. */
function tempRootWithShippedConfig(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2336-repro-'));
  fs.mkdirSync(path.join(tempRoot, 'config'), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, 'config', 'agents.json'),
    path.join(tempRoot, 'config', 'agents.json'),
  );
  return tempRoot;
}

test('resolveKnownAgentFamilies returns the steps.*.eligible union for the shipped config', () => {
  const tempRoot = tempRootWithShippedConfig();
  try {
    const families = resolveKnownAgentFamilies(tempRoot);

    assert.ok(
      families.length > 0,
      `known agent families must not be empty for the shipped config. Got: ${JSON.stringify(families)}`,
    );
    assert.deepEqual(
      [...families],
      ['claude', 'codex', 'custom', 'qwen', 'vibe'],
      'known agent families must equal the sorted union of steps.*.eligible',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('AgentStrip does not render "agents: unavailable" for the shipped config families', async () => {
  const tempRoot = tempRootWithShippedConfig();
  try {
    const families = resolveKnownAgentFamilies(tempRoot);
    const agentAvailability = families.map((family) => ({
      family,
      available: true,
      blockedForMs: 0,
    }));

    const ink = await import('ink');
    const React = await import('react');
    const { AgentStrip } = await import('../src/interfaces/tui/agent-strip.js');
    const frame = plain(ink.renderToString(
      React.createElement(AgentStrip, { agentAvailability }),
      { columns: 120 },
    ));

    assert.ok(
      !frame.includes('agents: unavailable'),
      `AgentStrip must not fall back to the unavailable placeholder. Got: ${frame}`,
    );
    for (const expected of ['claude', 'codex', 'custom', 'qwen', 'vibe']) {
      assert.ok(frame.includes(expected), `AgentStrip must list ${expected}. Got: ${frame}`);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('shipped config/agents.json declares no top-level families key', () => {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config', 'agents.json'), 'utf8'));
  assert.equal(
    config.families,
    undefined,
    'the shipped config must keep deriving families from steps.*.eligible',
  );
  assert.ok(
    agentFamily('claude') === 'claude',
    'agentFamily must accept the families used by the shipped config',
  );
});
