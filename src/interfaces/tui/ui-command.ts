import React from 'react';
import { render, renderToString } from 'ink';
import type { MissionDetail } from '../../application/projections/mission-detail.js';
import type { TuiCapabilities } from '../../application/tui-capabilities.js';
import { BoardShell } from './shell.js';

/**
 * Render the static Ink TUI shell.
 *
 * Obtains one BoardProjection from the composition root using concrete read
 * adapters, renders it with the BoardShell component, and exits cleanly on
 * 'q' keypress or Ctrl+C.
 *
 * Called by the command dispatcher. Uses process.cwd() as the target
 * repository root (set by the px.ts entry before dispatch).
 */
export async function runUiCommand(capabilities: TuiCapabilities, _args: string[] = []): Promise<number> {
  void _args; // intentionally unused — part of public API signature
  const projection = await capabilities.boardProjection.build();
  const missionDetails: ReadonlyMap<string, MissionDetail> = await capabilities.missionDetails.allDetails();
  const refreshProjection = () => capabilities.boardProjection.build();

  // A piped CLI invocation has no keyboard source. Render one static frame and
  // return so shipped-artifact/headless callers cannot wait forever for `q`.
  if (!process.stdin.isTTY && !process.stdout.isTTY) {
    process.stdout.write(renderToString(React.createElement(BoardShell, { projection, missionDetails, commandControllerFactory: capabilities.commandControllerFactory, refreshProjection })));
    return 0;
  }

  const { waitUntilExit } = render(
    React.createElement(BoardShell, { projection, missionDetails, commandControllerFactory: capabilities.commandControllerFactory, refreshProjection }),
    {
      exitOnCtrlC: true,
    },
  );

  const exitCode = await waitUntilExit();
  return typeof exitCode === 'number' ? exitCode : 0;
}
