import { spawnSync } from 'node:child_process';
import { __setSdkForTest } from '../../../src/adapters/agents/pi-session-runtime.js';
import { runPiWorker } from '../../../src/composition/pi-worker.js';

let mode = 'new';
__setSdkForTest({
  SessionManager: {
    create: () => { mode = 'new'; return {}; },
    list: () => [{ id: 'existing', path: '/fixture/existing' }],
    open: () => { mode = 'resumed'; return {}; },
    continueRecent: () => { mode = 'recent'; return {}; },
  },
  createAgentSession: async () => {
    let text = '';
    return { session: {
      sessionId: 'worker-session', model: { id: 'fixture-model' },
      getSessionStats: () => ({ tokens: { input: text ? 4 : 0, output: text ? 2 : 0, total: text ? 6 : 0 }, cost: 0, toolCalls: 0 }),
      getActiveToolNames: () => [], subscribe: () => () => {}, dispose() {},
      getLastAssistantText: () => text,
      async prompt(prompt: string) {
        if (prompt === 'hang') { await new Promise(() => {}); return; }
        const tool = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.env.PI_WORKER_TEST_VALUE || "missing")'], { encoding: 'utf8' });
        text = `${mode}:${process.env.PI_WORKER_TEST_VALUE}:${tool.stdout}:${process.env.TYPESAFE_API_KEY ?? 'stripped'}`;
        process.stdout.write('streamed-before-result\n');
        await new Promise(resolve => setTimeout(resolve, 10));
      },
    } };
  },
});
runPiWorker();
