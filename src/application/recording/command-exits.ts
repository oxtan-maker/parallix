/** Observe injected exits, retaining their control token identity through cleanup. */
export function observeCommandExits(options: Record<string, unknown>) {
  let code: number | null = null;
  let termination: { error: unknown } | null = null;
  const observed: Record<string, unknown> = {};
  for (const key of ['exit', 'exitFn'] as const) {
    const exit = options[key];
    if (typeof exit !== 'function') { continue; }
    observed[key] = (value?: number) => {
      if (value) { code = value; }
      try {
        return (exit as (_code?: number) => unknown)(value);
      } catch (error) {
        termination = { error };
        throw error;
      }
    };
  }
  return { options: observed, failure: () => code, terminatedWith: (error: unknown) => termination !== null && termination.error === error };
}
