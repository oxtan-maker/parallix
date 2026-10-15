import type { TestContext } from 'node:test';

/** Keep fixture cleanup attached until test teardown, including abort and signals. */
export function registerFixtureCleanup(context: TestContext, cleanup: () => void): void {
  const interrupt = () => { cleanup(); process.exit(130); };
  process.prependOnceListener('SIGTERM', cleanup);
  process.once('SIGINT', interrupt);
  context.signal.addEventListener('abort', cleanup, { once: true });
  process.once('exit', cleanup);
  context.after(() => {
    context.signal.removeEventListener('abort', cleanup);
    process.removeListener('exit', cleanup);
    process.removeListener('SIGTERM', cleanup);
    process.removeListener('SIGINT', interrupt);
    cleanup();
  });
}
