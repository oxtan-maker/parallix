import React from 'react';
import { render, renderToString } from 'ink';
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
  const projection = await capabilities.boardProjection.build();
  const refreshProjection = () => capabilities.boardProjection.build();

  // A piped CLI invocation has no keyboard source. Render one static frame and
  // return so shipped-artifact/headless callers cannot wait forever for `q`.
  if (!process.stdin.isTTY && !process.stdout.isTTY) {
    process.stdout.write(renderToString(React.createElement(BoardShell, { projection, commandControllerFactory: capabilities.commandControllerFactory, refreshProjection })));
    return 0;
  }

  const { waitUntilExit } = render(
    React.createElement(BoardShell, {
      projection,
      commandControllerFactory: capabilities.commandControllerFactory,
      refreshProjection,
      subscribeProjection: (onChange) => subscribeToBoardProjection(
        () => capabilities.boardProjection.build(),
        onChange,
      ),
    }),
    {
      exitOnCtrlC: true,
    },
  );

  const exitCode = await waitUntilExit();
  return typeof exitCode === 'number' ? exitCode : 0;
}
