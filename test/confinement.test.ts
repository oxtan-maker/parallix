import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectConfinement,
  supportsNativeSandbox,
  ConfinementBlockedError
} from '../src/adapters/process/confinement.js';

// selectConfinement: Bubblewrap is selected for a mutating launch when bwrap is
// available (SC 1), with coverage for every other decision outcome.
test('selectConfinement selects bubblewrap when available for a mutating launch', () => {
  assert.equal(
    selectConfinement({ mutating: true, bubblewrapAvailable: true, nativeSandboxSupported: false, operatorConsent: false }),
    'bubblewrap'
  );
});

test('selectConfinement selects native sandbox when bwrap missing but family supports it', () => {
  assert.equal(
    selectConfinement({ mutating: true, bubblewrapAvailable: false, nativeSandboxSupported: true, operatorConsent: false }),
    'native-sandbox'
  );
});

test('selectConfinement blocks when bwrap missing, no native sandbox, and no consent', () => {
  assert.equal(
    selectConfinement({ mutating: true, bubblewrapAvailable: false, nativeSandboxSupported: false, operatorConsent: false }),
    'blocked'
  );
});

test('selectConfinement allows unsandboxed execution only on explicit consent', () => {
  assert.equal(
    selectConfinement({ mutating: true, bubblewrapAvailable: false, nativeSandboxSupported: false, operatorConsent: true }),
    'unsandboxed-consented'
  );
  // Consent is not implicit: without it the same inputs block.
  assert.equal(
    selectConfinement({ mutating: true, bubblewrapAvailable: false, nativeSandboxSupported: false, operatorConsent: false }),
    'blocked'
  );
});

test('selectConfinement never gates a read-only (non-mutating) launch', () => {
  assert.equal(
    selectConfinement({ mutating: false, bubblewrapAvailable: false, nativeSandboxSupported: false, operatorConsent: false }),
    'bubblewrap'
  );
});

// supportsNativeSandbox: only families with a documented launch-layer sandbox
// reports support (SC 2). Codex exposes --sandbox and qwen exposes -s/--sandbox;
// the rest do not.
test('supportsNativeSandbox reports true for codex and qwen', () => {
  assert.equal(supportsNativeSandbox('codex'), true);
  assert.equal(supportsNativeSandbox('qwen'), true);
  for (const family of ['claude', 'vibe', 'opencode', 'pi', 'custom', 'gemini']) {
    assert.equal(supportsNativeSandbox(family), false, `${family} must not claim native sandboxing`);
  }
  assert.equal(supportsNativeSandbox(null), false);
  assert.equal(supportsNativeSandbox(undefined), false);
});

// ConfinementBlockedError carries a machine-readable code so callers can
// distinguish a deliberate block from a runtime launch failure.
test('ConfinementBlockedError exposes the CONFINEMENT_BLOCKED code', () => {
  const error = new ConfinementBlockedError('claude', 'no confinement available');
  assert.equal(error.code, 'CONFINEMENT_BLOCKED');
  assert.equal(error.name, 'ConfinementBlockedError');
  assert.match(error.message, /cannot run unsandboxed/);
  assert.match(error.message, /Consent to unsandboxed execution explicitly/);
});
