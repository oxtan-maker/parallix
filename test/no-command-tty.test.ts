import test from 'node:test';
import assert from 'node:assert/strict';
import { main, printUsage, shouldLaunchDefaultUi } from '../src/interfaces/cli/runtime.js';

type MainOverrides = Parameters<typeof main>[1];

function captureBareInvocation(overrides: MainOverrides = {}) {
  const calls: Array<string | [string, number | undefined]> = [];
  return {
    calls,
    options: {
      ...overrides,
      printUsageFn: () => calls.push('usage bytes'),
      exitFn: ((code?: number) => { calls.push(['exit', code]); }) as (_code?: number) => never,
      errorFn: () => { calls.push('error'); return ''; },
    } satisfies MainOverrides,
  };
}

test('no-command TTY dispatches the same ui command as explicit px ui', async () => {
  const calls: Array<[string, string[], { command: string }]> = [];
  const commandFns = {
    ui: async (args: string[], options: { command: string }) => calls.push(['ui', args, options]),
  };

  await main([], {
    commandFns,
    isInteractiveTTYFn: () => true,
    environment: {},
    printUsageFn: () => assert.fail('TTY default must not print usage'),
    exitFn: (() => assert.fail('TTY default must not exit through usage')) as never,
  });
  await main(['ui'], { commandFns });

  assert.deepEqual(calls, [
    ['ui', [], { command: 'ui' }],
    ['ui', [], { command: 'ui' }],
  ]);
});

test('no-command non-TTY scenarios preserve legacy usage bytes, exit code, and UI isolation', async () => {
  const baseline = captureBareInvocation({ isInteractiveTTYFn: () => false, environment: {} });
  await main([], baseline.options);

  const scenarios = [
    ['pipe', false, {}],
    ['redirected stdout', false, {}],
    ['CI', true, { CI: '1' }],
  ] as const;

  for (const [name, isInteractiveTTY, environment] of scenarios) {
    const scenario = captureBareInvocation({
      isInteractiveTTYFn: () => isInteractiveTTY,
      environment,
      commandFns: {
        ui: async () => assert.fail(`${name} must not import or initialize the UI command`),
      },
    });
    await main([], scenario.options);
    assert.deepEqual(scenario.calls, baseline.calls, `${name} must retain exact legacy usage bytes and exit code`);
  }
});

test('PARALLIX_NO_TUI=1 restores legacy bare-command behavior on a TTY', async () => {
  const baseline = captureBareInvocation({ isInteractiveTTYFn: () => false, environment: {} });
  await main([], baseline.options);

  const optedOut = captureBareInvocation({
    isInteractiveTTYFn: () => true,
    environment: { PARALLIX_NO_TUI: '1' },
    commandFns: {
      ui: async () => assert.fail('PARALLIX_NO_TUI=1 must prevent UI dispatch'),
    },
  });
  await main([], optedOut.options);

  assert.deepEqual(optedOut.calls, baseline.calls);
});

test('TTY default policy requires both terminal streams, no CI marker, and no opt-out', () => {
  assert.equal(shouldLaunchDefaultUi({ stdinIsTTY: true, stdoutIsTTY: true, environment: {} }), true);
  assert.equal(shouldLaunchDefaultUi({ stdinIsTTY: false, stdoutIsTTY: true, environment: {} }), false);
  assert.equal(shouldLaunchDefaultUi({ stdinIsTTY: true, stdoutIsTTY: false, environment: {} }), false);
  assert.equal(shouldLaunchDefaultUi({ stdinIsTTY: true, stdoutIsTTY: true, environment: { CI: 'true' } }), false);
  assert.equal(shouldLaunchDefaultUi({ stdinIsTTY: true, stdoutIsTTY: true, environment: { PARALLIX_NO_TUI: '1' } }), false);
});

test('help documents the TTY default, explicit ui command, and opt-out', () => {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (line: string) => lines.push(line);
  try {
    printUsage();
  } finally {
    console.log = originalLog;
  }

  const help = lines.join('\n');
  assert.match(help, /running `px` with no command opens the board/i);
  assert.match(help, /`px ui` remains available explicitly/i);
  assert.match(help, /PARALLIX_NO_TUI=1/);
});
