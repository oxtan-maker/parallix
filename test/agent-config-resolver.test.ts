import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveKnownAgentFamilies } from '../src/interfaces/tui/agent-config-resolver.js';

// ---------------------------------------------------------------------------
// resolveKnownAgentFamilies — family derivation for the board's agent strip.
// Precedence: explicit `families` array, else the sorted union of
// `steps.<step>.eligible`. Invalid entries are dropped; a missing or malformed
// config yields an empty list without throwing.
// ---------------------------------------------------------------------------

/** Create a temp root, optionally writing raw config/agents.json contents. */
function tempRoot(contents?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-resolver-'));
  if (contents !== undefined) {
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config', 'agents.json'), contents);
  }
  return root;
}

function withRoot(contents: string | undefined, assertions: (_root: string) => void): void {
  const root = tempRoot(contents);
  try {
    assertions(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('resolveKnownAgentFamilies returns the explicit families array when the config declares one', () => {
  withRoot(
    JSON.stringify({
      families: ['vibe', 'claude'],
      steps: { draft: { eligible: ['codex'] } },
    }),
    (root) => {
      assert.deepEqual(
        [...resolveKnownAgentFamilies(root)],
        ['vibe', 'claude'],
        'an explicit families array must take precedence over steps.*.eligible',
      );
    },
  );
});

test('resolveKnownAgentFamilies falls back to the sorted union of steps.*.eligible', () => {
  withRoot(
    JSON.stringify({
      steps: {
        draft: { eligible: ['codex', 'custom', 'vibe'], selection: 'random' },
        active: { eligible: ['codex', 'claude', 'custom', 'vibe'], selection: 'random' },
        review: { eligible: ['codex', 'claude'], selection: 'random' },
      },
    }),
    (root) => {
      assert.deepEqual(
        [...resolveKnownAgentFamilies(root)],
        ['claude', 'codex', 'custom', 'vibe'],
        'the fallback must be the de-duplicated, sorted union of every eligible list',
      );
    },
  );
});

test('resolveKnownAgentFamilies returns an empty list when config/agents.json is missing', () => {
  withRoot(undefined, (root) => {
    assert.deepEqual([...resolveKnownAgentFamilies(root)], [], 'a missing config must fail soft');
  });
});

test('resolveKnownAgentFamilies returns an empty list for non-JSON config contents', () => {
  withRoot('not json at all {', (root) => {
    assert.deepEqual([...resolveKnownAgentFamilies(root)], [], 'unparsable config must fail soft');
  });
});

test('resolveKnownAgentFamilies returns an empty list when the config has neither families nor steps', () => {
  withRoot(JSON.stringify({ overrides: { _comment: 'nothing useful here' } }), (root) => {
    assert.deepEqual(
      [...resolveKnownAgentFamilies(root)],
      [],
      'a config without families or steps must fail soft',
    );
  });
});

test('resolveKnownAgentFamilies drops entries that fail agentFamily() validation', () => {
  withRoot(
    JSON.stringify({ families: ['claude', 'Claude Opus', '', 'codex', 42, null, '-bad'] }),
    (root) => {
      assert.deepEqual(
        [...resolveKnownAgentFamilies(root)],
        ['claude', 'codex'],
        'invalid family values must be dropped rather than cast to AgentFamily',
      );
    },
  );

  withRoot(
    JSON.stringify({ steps: { draft: { eligible: ['vibe', 'Claude Opus', ''] } } }),
    (root) => {
      assert.deepEqual(
        [...resolveKnownAgentFamilies(root)],
        ['vibe'],
        'invalid eligible values must be dropped from the steps fallback too',
      );
    },
  );
});

test('resolveKnownAgentFamilies ignores steps whose eligible field is missing or not an array', () => {
  withRoot(
    JSON.stringify({
      steps: {
        draft: { selection: 'random' },
        active: { eligible: 'codex' },
        review: { eligible: ['codex'] },
      },
    }),
    (root) => {
      assert.deepEqual(
        [...resolveKnownAgentFamilies(root)],
        ['codex'],
        'malformed step entries must not break the union',
      );
    },
  );
});
