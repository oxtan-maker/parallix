#!/usr/bin/env node

import { run } from '../composition/create-cli.js';
import { cliInvocation, pinChildCli } from '../composition/child-cli.js';
import { resolveProcessConfiguration } from '../composition/config.js';
import { runPiWorker } from '../composition/pi-worker.js';

export * from '../composition/create-cli.js';

if (process.argv[2] === '--pi-session-worker') {
  runPiWorker();
} else {
  const configuration = resolveProcessConfiguration();
  const childEnvironment = { ...configuration.forwardedEnvironment };
  pinChildCli(process.argv[1], { configuration, env: childEnvironment });

  // stdout/stderr are synchronous for a TTY but async for a pipe. `process.exit()`
  // kills the process before pending pipe writes flush, truncating CLI output.
  // Waiting for the event loop to drain, or for `finish` (only emitted after
  // `end()`), hangs whenever a ref'd loop anchor survives the command (a
  // kept-alive socket, an agent SDK handle), and a fixed deadline discards output
  // under pipe backpressure. A write callback fires once every earlier buffered
  // write has reached the pipe (or the stream errored, e.g. EPIPE), so exit from
  // there: no output is lost and no anchor can hold the process open.
  const terminate = (code: number): void => {
    const pending = [process.stdout, process.stderr].filter(
      stream => stream.writableLength > 0,
    );
    if (pending.length === 0) { process.exit(code); return; }
    let remaining = pending.length;
    const flushed = () => { if (--remaining === 0) { process.exit(code); } };
    for (const stream of pending) { stream.write('', flushed); }
  };

  run(process.argv.slice(2), { environment: childEnvironment, cliInvocation: cliInvocation(process.argv[1]) }).then(code => {
    // The command has already closed its owned services by the time `run()`
    // resolves or rejects, but a completed operation can still leave loop anchors
    // behind (a kept-alive Forgejo socket, an agent SDK handle, a borrowed graph
    // connection). Setting `process.exitCode` alone returns control to the shell
    // only when the event loop drains naturally, so a successful operation that
    // leaves any ref'd anchor hangs and hides the exit status. Terminate with the
    // operation's status on success or failure so `npm run dev` always returns.
    terminate(code);
  }, error => {
    console.error(error);
    terminate(1);
  });
}
