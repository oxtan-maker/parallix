import test from 'node:test';
import assert from 'node:assert/strict';
import { HandoffCommandUseCase } from '../src/application/handoff-command-use-case.js';

test('recorded gate rejects prose-appended commands before execution', () => {
  const command = '`./scripts/verify-local.sh all` passes on the final tree.';
  const useCase = new HandoffCommandUseCase({ fileSystem: { existsSync: () => true } } as any);
  const result = useCase.validateDeclaredGates([command], '/repo');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'validation-failed');
  assert.equal(result.gate, command);
  assert.match(result.error ?? '', /exact runnable command/i);
});
