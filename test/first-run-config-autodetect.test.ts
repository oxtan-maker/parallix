import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ensureFirstRunAgentConfig,
  writeAutodetectedAgentConfig,
} from '../src/adapters/agents/first-run-config.js';
import {
  setCommandPathProbe,
  setLauncherHealthProbe,
} from '../src/adapters/agents/launcher-selection.js';
import { readAgentConfig } from '../src/adapters/agents/agent-config.js';
import { eligibleAgentsForStep } from '../src/adapters/agents/launcher-selection.js';

const CONFIG_REL = 'config/agents.json';

function withTempDir(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'first-run-config-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Inject the launcher seam so no real CLI is spawned. `available` lists the
 * resolved command names (family name, or the runner name for `custom`).
 * Resolvers return bare names for some families (commandInPath seam) and
 * absolute paths for others (fs.existsSync); matching on basename keeps the
 * decision in the seam for both shapes without touching the real filesystem.
 */
function setAvailability(available: string[]) {
  const set = new Set(available);
  const base = (value: string) => value.slice(value.lastIndexOf('/') + 1);
  setCommandPathProbe((name: string) => (set.has(base(name)) ? `/fakebin/${base(name)}` : null));
  setLauncherHealthProbe((command: string) =>
    set.has(base(command)) ? { ok: true } : { ok: false, reason: 'unavailable' },
  );
}

function clearSeams() {
  setCommandPathProbe(null);
  setLauncherHealthProbe(null);
}

test('writes a filtered config on first run containing only available families', () => {
  return withTempDir(async (root) => {
    setAvailability(['codex', 'vibe', 'opencode']); // custom -> opencode available
    try {
      const result = ensureFirstRunAgentConfig({ rootDir: root, worktree: root });
      assert.equal(result.written, true);

      const writtenPath = path.join(root, CONFIG_REL);
      assert.equal(fs.existsSync(writtenPath), true);

      const written = JSON.parse(fs.readFileSync(writtenPath, 'utf8'));
      for (const step of ['draft', 'active', 'review']) {
        const eligible = written.steps[step].eligible;
        // codex, vibe present; claude + qwen absent; custom kept (opencode available)
        assert.deepEqual(eligible.sort(), ['codex', 'custom', 'vibe'].sort());
      }
      // documentation keys preserved from the shipped default
      assert.ok(typeof written._comment === 'string');
      assert.ok(typeof written._weights_comment === 'string');
    } finally {
      clearSeams();
    }
  });
});

test('absent family never appears in any eligible array; present family does', () => {
  return withTempDir(async (root) => {
    setAvailability(['claude']); // only claude installed
    try {
      ensureFirstRunAgentConfig({ rootDir: root, worktree: root });
      const written = JSON.parse(fs.readFileSync(path.join(root, CONFIG_REL), 'utf8'));
      for (const step of ['draft', 'active', 'review']) {
        assert.deepEqual(written.steps[step].eligible, ['claude']);
        assert.equal(written.steps[step].eligible.includes('codex'), false);
        assert.equal(written.steps[step].eligible.includes('qwen'), false);
        assert.equal(written.steps[step].eligible.includes('vibe'), false);
        assert.equal(written.steps[step].eligible.includes('custom'), false);
      }
    } finally {
      clearSeams();
    }
  });
});

test('judges the custom family against its configured runner', () => {
  return withTempDir(async (root) => {
    // custom -> pi
    fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'workflow.config.json'),
      JSON.stringify({ adapters: { agents: { runners: { custom: 'pi' } } } }),
    );
    // pi unavailable -> custom dropped from eligible
    setAvailability(['codex']);
    try {
      ensureFirstRunAgentConfig({ rootDir: root, worktree: root });
      const written = JSON.parse(fs.readFileSync(path.join(root, CONFIG_REL), 'utf8'));
      assert.equal(written.steps.active.eligible.includes('custom'), false);
    } finally {
      clearSeams();
    }
  });
});

test('keeps custom in eligible when its configured runner is available', () => {
  return withTempDir(async (root) => {
    fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'workflow.config.json'),
      JSON.stringify({ adapters: { agents: { runners: { custom: 'pi' } } } }),
    );
    setAvailability(['codex', 'pi']);
    try {
      ensureFirstRunAgentConfig({ rootDir: root, worktree: root });
      const written = JSON.parse(fs.readFileSync(path.join(root, CONFIG_REL), 'utf8'));
      assert.equal(written.steps.active.eligible.includes('custom'), true);
    } finally {
      clearSeams();
    }
  });
});

test('leaves a pre-existing working-tree config byte-for-byte on a second run', () => {
  return withTempDir(async (root) => {
    const configDir = path.join(root, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    const authored = JSON.stringify(
      {
        _comment: 'user authored',
        _weights_comment: 'weights here',
        steps: {
          draft: { eligible: ['claude'], selection: 'weighted', weights: { claude: 3 } },
          active: { eligible: ['codex', 'claude'] },
          review: { eligible: ['vibe'] },
        },
        overrides: { _comment: 'keep me' },
      },
      null,
      2,
    ) + '\n';
    fs.writeFileSync(path.join(root, CONFIG_REL), authored);
    const before = fs.readFileSync(path.join(root, CONFIG_REL));

    setAvailability(['codex', 'vibe', 'opencode']);
    try {
      const result = ensureFirstRunAgentConfig({ rootDir: root, worktree: root });
      assert.equal(result.written, false);
      const after = fs.readFileSync(path.join(root, CONFIG_REL));
      assert.deepEqual(after, before); // byte-for-byte identical
    } finally {
      clearSeams();
    }
  });
});

test('written config feeds readAgentConfig and eligibleAgentsForStep', () => {
  return withTempDir(async (root) => {
    setAvailability(['codex', 'vibe', 'opencode']);
    try {
      ensureFirstRunAgentConfig({ rootDir: root, worktree: root });
      const config = readAgentConfig(path.join(root, CONFIG_REL), { mergeLocal: false });
      const eligible = eligibleAgentsForStep('active', { configPath: path.join(root, CONFIG_REL) });
      assert.deepEqual(eligible.sort(), ['codex', 'custom', 'vibe'].sort());
      // documentation keys do not leak into eligible parsing
      assert.equal(eligible.includes('_comment'), false);
    } finally {
      clearSeams();
    }
  });
});

test('writeAutodetectedAgentConfig returns written=false when a working-tree file already exists', () => {
  return withTempDir(async (root) => {
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, CONFIG_REL), '{}\n');
    setAvailability(['codex']);
    try {
      const result = writeAutodetectedAgentConfig({ rootDir: root, worktree: root });
      assert.equal(result.written, false);
    } finally {
      clearSeams();
    }
  });
});

test('does not persist an all-probes-fail detection; falls back to shipped default', () => {
  return withTempDir(async (root) => {
    setAvailability([]); // no family available
    try {
      const result = ensureFirstRunAgentConfig({ rootDir: root, worktree: root });
      assert.equal(result.written, false);
      assert.equal(result.emptyDetection, true);
      // No working-tree file written, so selection falls back to the shipped
      // default (all families) instead of a pinned empty list.
      assert.equal(fs.existsSync(path.join(root, CONFIG_REL)), false);
      const eligible = eligibleAgentsForStep('active', { configPath: path.join(root, CONFIG_REL) });
      assert.equal(eligible.length > 0, true);
    } finally {
      clearSeams();
    }
  });
});

test('force regenerates an existing working-tree config (px config --write refresh)', () => {
  return withTempDir(async (root) => {
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    const stale = JSON.stringify({
      _comment: 'stale',
      steps: { draft: { eligible: [] }, active: { eligible: [] }, review: { eligible: [] } },
    }, null, 2);
    fs.writeFileSync(path.join(root, CONFIG_REL), stale);
    setAvailability(['codex', 'vibe']);
    try {
      const result = ensureFirstRunAgentConfig({ rootDir: root, worktree: root, force: true });
      assert.equal(result.written, true);
      const written = JSON.parse(fs.readFileSync(path.join(root, CONFIG_REL), 'utf8'));
      for (const step of ['draft', 'active', 'review']) {
        assert.deepEqual(written.steps[step].eligible.sort(), ['codex', 'vibe'].sort());
      }
    } finally {
      clearSeams();
    }
  });
});

test('force skips an empty detection instead of overwriting a live config', () => {
  return withTempDir(async (root) => {
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    const authored = JSON.stringify({
      _comment: 'user config',
      steps: { draft: { eligible: ['claude'] }, active: { eligible: ['claude'] }, review: { eligible: ['claude'] } },
    }, null, 2);
    fs.writeFileSync(path.join(root, CONFIG_REL), authored);
    const before = fs.readFileSync(path.join(root, CONFIG_REL));
    setAvailability([]); // no family available
    try {
      const result = ensureFirstRunAgentConfig({ rootDir: root, worktree: root, force: true });
      assert.equal(result.written, false);
      assert.equal(result.emptyDetection, true);
      const after = fs.readFileSync(path.join(root, CONFIG_REL));
      assert.deepEqual(after, before); // do not clobber user config on empty detection
    } finally {
      clearSeams();
    }
  });
});
