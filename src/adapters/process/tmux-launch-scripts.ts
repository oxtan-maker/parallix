import path from 'node:path';

/** Single-quote one value for POSIX `sh`. */
export function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** Record the command identity, then preserve its PID by replacing both shells. */
export function commandScript(socketPath: string, scratch: string, command: string, args: readonly string[], hasInput: boolean): string {
  const input = shellQuote(path.join(scratch, 'stdin'));
  return [
    '#!/bin/sh',
    `{ printf '%s\\n' "$$"; if [ -r /proc/$$/stat ]; then cat /proc/$$/stat; else ps -p "$$" -o lstart=; fi; } > ${shellQuote(path.join(scratch, 'command.identity.tmp'))}`,
    `mv ${shellQuote(path.join(scratch, 'command.identity.tmp'))} ${shellQuote(path.join(scratch, 'command.identity'))}`,
    `printf '%s' "$$" > ${shellQuote(path.join(scratch, 'command.pid'))}`,
    `tmux -S ${shellQuote(socketPath)} set-option -w -t "$TMUX_PANE" @px_command_pid "$$"`,
    ...(hasInput ? [`exec 3< ${input} || exit 66`, `rm -f ${input}`] : []),
    `exec ${[command, ...args].map(shellQuote).join(' ')}${hasInput ? ' <&3 3<&-' : ''}`,
    '',
  ].join('\n');
}

/**
 * An unpresented pane replaces its shell with the command so tmux retains the
 * unambiguous dead status or signal. Presented agent output still drains its
 * renderer before the pane reports the numeric provider status.
 */
export function paneScript(socketPath: string, windowName: string, scratch: string, presenter?: { readonly command: string; readonly args: readonly string[] }): string {
  const t = `tmux -S ${shellQuote(socketPath)}`;
  const setup = [
    '#!/bin/sh',
    `${t} wait-for ${shellQuote(`${windowName}-go`)}`,
    `. ${shellQuote(path.join(scratch, 'pane.env'))}`,
    `rm -f ${shellQuote(path.join(scratch, 'pane.env'))}`,
  ];
  if (!presenter) {
    return [...setup, `exec sh ${shellQuote(path.join(scratch, 'command.sh'))}`, ''].join('\n');
  }
  const agentOut = shellQuote(path.join(scratch, 'agent.out'));
  return [...setup,
    `mkfifo ${agentOut}`,
    `tee ${shellQuote(path.join(scratch, 'raw'))} < ${agentOut} | ${[presenter.command, ...presenter.args].map(shellQuote).join(' ')} &`,
    'presenter=$!',
    `sh ${shellQuote(path.join(scratch, 'command.sh'))} > ${agentOut} 2>&1`,
    'status=$?',
    'wait "$presenter"',
    `printf '%s' "$status" > ${shellQuote(path.join(scratch, 'status'))}`,
    `${t} set-option -w -t "$TMUX_PANE" @px_host_pid ''`,
    `${t} set-option -w -t "$TMUX_PANE" @px_supervisor_pid ''`,
    `${t} set-option -w -t "$TMUX_PANE" @px_command_pid ''`,
    `${t} wait-for ${shellQuote(`${windowName}-done`)}`,
    'exit "$status"',
    '',
  ].join('\n');
}
