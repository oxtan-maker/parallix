import { spawnSync } from 'node:child_process';
import { __setSdkForTest } from '../../../src/adapters/agents/pi-session-runtime.js';
import { runPiWorker } from '../../../src/composition/pi-worker.js';

let mode = 'new';
__setSdkForTest({
  SessionManager: {
    create: () => { mode = 'new'; return {}; },
    list: async () => [{ id: 'existing', path: '/fixture/existing' }],
    open: () => { mode = 'resumed'; return {}; },
    continueRecent: () => { mode = 'recent'; return {}; },
  },
  createAgentSession: async () => {
    let text = '';
    let releaseHang: (() => void) | null = null;
    let abortReleases = true;
    return { session: {
      sessionId: 'worker-session', model: { id: 'fixture-model' },
      getSessionStats: () => ({ tokens: { input: text ? 4 : 0, output: text ? 2 : 0, total: text ? 6 : 0 }, cost: 0, toolCalls: 0 }),
      getActiveToolNames: () => [], subscribe: () => () => {}, dispose() {},
      getLastAssistantText: () => text,
      // A stopped worker aborts the live session; the fixture releases its hang.
      abort() { if (abortReleases) { releaseHang?.(); } },
      async prompt(prompt: string) {
        if (prompt === 'hang' || prompt === 'hang without abort') {
          // Written after the runtime has published its observation, so a parent
          // that sees this marker knows the worker already sent it.
          process.stdout.write('session-created\n');
          // 'hang without abort' keeps the run unsettled, so only the worker's
          // own flush-bound reap can end it.
          abortReleases = prompt === 'hang';
          await new Promise<void>(resolve => { releaseHang = resolve; });
          throw new Error('fixture session aborted');
        }
        const tool = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.env.PI_WORKER_TEST_VALUE || "missing")'], { encoding: 'utf8' });
        text = `${mode}:${process.env.PI_WORKER_TEST_VALUE}:${tool.stdout}:${process.env.TYPESAFE_API_KEY ?? 'stripped'}`;
        process.stdout.write('streamed-before-result\n');
        await new Promise(resolve => setTimeout(resolve, 10));
      },
    } };
  },
});
runPiWorker();
