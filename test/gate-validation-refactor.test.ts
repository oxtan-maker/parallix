// Focused regression coverage for the validateDeclaredGates refactor (S3776
// slice). Each test pins one extracted branch: prose detection, unclosed-quote
// detection, the merged delimiter-balance helper, and missing-file detection.
// The refactor relocated the control flow into private helpers; these cases
// assert the observable behavior of every changed branch is unchanged.
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { HandoffCommandUseCase } from '../src/application/handoff-command-use-case.js';

const rootDir = path.join(import.meta.dirname, '..');
const verifyPath = path.join(rootDir, 'scripts', 'verify-local.sh');

function useCaseWithExisting(existing: string[]) {
  const set = new Set(existing);
  const fileSystem = { existsSync: (p: string) => set.has(p) };
  return new HandoffCommandUseCase({ fileSystem } as never);
}

test('refactor proseError branch rejects markdown-span-with-suffix declaration', () => {
  const uc = useCaseWithExisting([]);
  const result = uc.validateDeclaredGates(['`./scripts/verify-local.sh all` passes on the final tree'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
  assert.match(result.error || '', /exact runnable command only/);
});

test('refactor proseError branch rejects outcome-language suffix', () => {
  const uc = useCaseWithExisting([]);
  const result = uc.validateDeclaredGates(['./scripts/verify-local.sh all passes'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'validation-failed');
});

test('refactor quoteError branch rejects unclosed single quote', () => {
  const uc = useCaseWithExisting([]);
  const result = uc.validateDeclaredGates(["echo 'unclosed"], rootDir);
  assert.strictEqual(result.ok, false);
  assert.ok((result as { error?: string }).error?.includes('unclosed single quotes'));
});

test('refactor quoteError branch rejects unclosed double quote', () => {
  const uc = useCaseWithExisting([]);
  const result = uc.validateDeclaredGates(['echo "unclosed'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.ok((result as { error?: string }).error?.includes('unclosed double quotes'));
});

test('refactor quoteError branch allows apostrophe inside double quotes', () => {
  const uc = useCaseWithExisting([]);
  const result = uc.validateDeclaredGates(["echo \"it's fine\""], rootDir);
  assert.notStrictEqual(result.ok, false, 'balanced quotes must not trigger the quote-error branch');
});

test('refactor firstUnbalancedDelimiter branch rejects unmatched parentheses', () => {
  const uc = useCaseWithExisting([]);
  const result = uc.validateDeclaredGates(['echo (hello'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.ok((result as { error?: string }).error?.includes('unmatched parentheses'));
});

test('refactor firstUnbalancedDelimiter branch rejects unmatched braces', () => {
  const uc = useCaseWithExisting([]);
  const result = uc.validateDeclaredGates(['echo {hello'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.ok((result as { error?: string }).error?.includes('unmatched braces'));
});

test('refactor firstUnbalancedDelimiter branch rejects unmatched brackets', () => {
  const uc = useCaseWithExisting([]);
  const result = uc.validateDeclaredGates(['echo [hello'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.ok((result as { error?: string }).error?.includes('unmatched brackets'));
});

test('refactor firstUnbalancedDelimiter branch allows balanced mixed delimiters', () => {
  const uc = useCaseWithExisting([path.join(rootDir, 'scripts')]);
  const result = uc.validateDeclaredGates(['ls ./scripts/ (ok) {done} [yes]'], rootDir);
  const imbalance = (result as { error?: string }).error ?? '';
  assert.doesNotMatch(imbalance, /unmatched (parentheses|braces|brackets)/);
});

test('refactor missingFileError branch rejects a non-existent relative path token', () => {
  const uc = useCaseWithExisting([]);
  const result = uc.validateDeclaredGates(['./scripts/nonexistent.sh'], rootDir);
  assert.strictEqual(result.ok, false);
  assert.match(result.error || '', /non-existent file/);
});

test('refactor missingFileError branch skips URLs, flags, and globs', () => {
  const uc = useCaseWithExisting([]);
  const result = uc.validateDeclaredGates(['curl https://example.com', 'npm run test --*', 'node --version'], rootDir);
  assert.strictEqual(result.ok, true, 'URLs/flags/globs must not be treated as file paths');
});

test('refactor success branch returns all-gates-valid for runnable commands', () => {
  const uc = useCaseWithExisting([verifyPath]);
  const result = uc.validateDeclaredGates([`cat ${verifyPath}`], rootDir);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'all-gates-valid');
});
