/** Bound command termination to its invocation, allowing owner cleanup to run. */
export async function commandInvocation(
  invoke: (_exit: (_code?: number) => never) => unknown,
): Promise<number> {
  const stopped = Object.freeze({ kind: 'command-exit' });
  let status = 0;
  const exit = (code = 0): never => {
    status = code;
    throw stopped;
  };
  try {
    await invoke(exit);
  } catch (error) {
    if (error !== stopped) { throw error; }
  }
  return status;
}
