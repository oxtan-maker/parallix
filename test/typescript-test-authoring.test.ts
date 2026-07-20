// @ts-nocheck -- TASK-2277: preserve legacy CommonJS mock behavior while mock-shape typings are hardened separately.

import assert from 'node:assert/strict';
import test from 'node:test';

type Reporter = {
  report(message: string): void;
};

test('TypeScript-authored test records a typed mock interaction', () => {
  const messages: string[] = [];
  const reporter: Reporter = {
    report(message) {
      messages.push(message);
    },
  };

  reporter.report('TypeScript test executed');

  assert.deepEqual(messages, ['TypeScript test executed']);
});
