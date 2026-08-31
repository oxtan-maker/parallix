import React from 'react';
import { render, renderToString, type Instance } from 'ink';
import type { TuiCapabilities } from '../../application/tui-capabilities.js';
import { BoardShell } from './shell.js';
import { subscribeToBoardProjection } from '../../application/projections/board-subscription.js';

/**
 * Render the static Ink TUI shell.
 *
 * Receives application capabilities from the host, renders one projection
 * with the BoardShell component, and exits cleanly on 'q' or Ctrl+C.
 *
 * Called by the command dispatcher. Uses process.cwd() as the target
 * repository root (set by the px.ts entry before dispatch).
 */
export async function runUiCommand(capabilities: TuiCapabilities, _args: string[] = []): Promise<number> {
  void _args; // intentionally unused — part of public API signature

  // Ink's `exitOnCtrlC` only recognises the 0x03 *byte* on stdin, which it can
  // only see once its own raw-mode effect has run — one frame after the first
  // render, and long after this command starts building the projection. Until
  // then the terminal's line discipline is still cooked, so Ctrl+C arrives as a
  // SIGINT to the foreground process group and, with no handler registered,
  // kills the board outright: no unmount, no raw-mode restore, death by signal.
  // `docs/tui-board.md` documents Ctrl+C as a board exit key, so the signal
  // takes the same clean path as the key: unmount the app, let Ink restore the
  // terminal, and return a numeric exit code. Repeated signals are harmless —
  // Ink's `unmount` is a no-op once the app has exited.
  let instance: Instance | null = null;
  let exitRequested = false;
  // Once a signal-initiated shutdown is under way, every further SIGINT is
  // absorbed for the rest of the process's life. Without this, a second Ctrl+C
  // landing after the app has unmounted but before the process has finished
  // winding down would hit SIGINT's default action and turn an already-clean
  // shutdown into death by signal.
  const absorbRepeatedSignals = () => {};
  const requestExit = () => {
    if (!exitRequested) { process.on('SIGINT', absorbRepeatedSignals); }
    exitRequested = true;
    instance?.unmount();
  };
  process.on('SIGINT', requestExit);
  try {
    const projection = await capabilities.boardProjection.build();
    const refreshProjection = () => capabilities.boardProjection.build();

    // A piped CLI invocation has no keyboard source. Render one static frame and
    // return so shipped-artifact/headless callers cannot wait forever for `q`.
    if (!process.stdin.isTTY && !process.stdout.isTTY) {
      process.stdout.write(renderToString(React.createElement(BoardShell, { projection, commandControllerFactory: capabilities.commandControllerFactory, refreshProjection })));
      return 0;
    }

    // Signalled before anything took the terminal: there is nothing to unmount
    // and nothing to restore, so exit with a code rather than paint a frame.
    if (exitRequested) { return 0; }

    instance = render(
      React.createElement(BoardShell, {
        projection,
        commandControllerFactory: capabilities.commandControllerFactory,
        refreshProjection,
        subscribeProjection: (onChange) => subscribeToBoardProjection(
          () => capabilities.boardProjection.build(),
          onChange,
          // The Ink board renders the coarse day/hour/minute label, so its
          // refresh must compare the displayed countdown (task-2442). The web
          // host keeps the default raw comparison for its own finer display.
          { displayedCountdown: true },
        ),
      }),
      {
        exitOnCtrlC: true,
      },
    );
    // The signal can land between `render` returning and the handler above
    // having an instance to unmount.
    if (exitRequested) { instance.unmount(); }

    const exitCode = await instance.waitUntilExit();
    return typeof exitCode === 'number' ? exitCode : 0;
  } finally {
    process.removeListener('SIGINT', requestExit);
  }
}
