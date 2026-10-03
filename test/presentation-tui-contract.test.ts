// TASK-2622.15: Stable hermetic Ink/TUI behavior suite; case filenames preserve provenance.
import test from 'node:test';
import assert from 'node:assert/strict';
import './tui-action-bar.cases.js';
import './tui-characterization-cp1.cases.js';
import './tui-command-guardrail.cases.js';
import './tui-confirmation.cases.js';
import './tui-headless-isolation.cases.js';
import './tui-import-boundary.cases.js';
import './tui-lane-columns.cases.js';
import './tui-navigation.cases.js';
import './tui-outcome-banner.cases.js';
import './tui-responsive-layout.cases.js';
import './tui-rollback-proof.cases.js';
import './tui-shell-component.cases.js';
import './tui-wave-3-component.cases.js';
import './tui-wave-4-attention.cases.js';
import './task-2377-sigint-pty-repro.cases.js';

test('presentation TUI contract entrypoint registers its behavior cases', () => {
  assert.ok(true, 'the static case-module imports above are evaluated before this entrypoint test');
});
