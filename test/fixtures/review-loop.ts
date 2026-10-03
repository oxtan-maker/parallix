/** Fresh observations and request-injected output ports for each loop invocation. */
export function reviewLoopOutput() {
  const logs: string[] = [];
  const errors: string[] = [];
  const exitCodes: number[] = [];
  const output = {
    log: (message: string) => { logs.push(message); },
    error: (message: string) => { errors.push(message); },
    exit: (code: number) => { exitCodes.push(code); },
  };
  return { logs, errors, exitCodes, output };
}
