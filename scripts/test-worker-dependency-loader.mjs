// TASK-2622.02: diagnostic ESM loader. It observes resolution/loading only;
// it never supplies a module, so it cannot become a test-selection authority.
import fs from 'node:fs';

const output = process.env.PARALLIX_WORKER_DEPENDENCY_TRACE;
function record(value) {
  if (output) fs.appendFileSync(output, `${JSON.stringify(value)}\n`);
}

export async function resolve(specifier, context, nextResolve) {
  try {
    const resolved = await nextResolve(specifier, context);
    record({ type: 'resolve', specifier, parent: context.parentURL || null, url: resolved.url });
    return resolved;
  } catch (error) {
    record({ type: 'unresolved', specifier, parent: context.parentURL || null, error: String(error) });
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  record({ type: 'load', url, format: loaded.format });
  return loaded;
}
