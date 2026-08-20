/**
 * module-mock.ts — ESM-native test seam (TASK-2328).
 *
 * Replaces the retired `.test-runtime/` CommonJS tree. Native ESM namespaces
 * are immutable, so `mock.method(namespace, 'fn')` cannot patch a dependency
 * the way a CommonJS `exports` object allowed. This helper registers a
 * delegating facade for a module URL through `node:test`'s module mocking and
 * hands the test a plain, mutable object with the same shape.
 *
 * Semantics deliberately match what the CommonJS test runtime provided:
 *   - cross-module calls (`git.getCurrentBranch()` made from another module)
 *     route through the facade and observe `mock.method()` replacements;
 *   - intra-module calls (a function calling a sibling in the same file) bind
 *     directly and are not intercepted, exactly as transpiled CJS behaved.
 *
 * Usage:
 *   const git = mockModule<typeof import('../src/adapters/git/git.js')>(
 *     '../src/adapters/git/git.js', import.meta.url);
 *   const handoff = mockModule<typeof import('../src/adapters/cli/commands/handoff.js')>(
 *     '../src/adapters/cli/commands/handoff.js', import.meta.url);
 *   await installModuleMocks();
 *
 *   mock.method(git, 'getCurrentBranch', () => 'mission/task-1');
 *   handoff.performHandoff(...);
 *
 * Declaration order is irrelevant: `installModuleMocks()` registers every
 * facade first and only then re-links the implementations, so a module always
 * sees the mocked form of its dependencies.
 *
 * Only declare modules you actually patch. Re-linking evaluates a module a
 * second time, so a module's *non-function* exports (frozen sentinels such as
 * `POLL_TIMEOUT`, mutable logger objects such as `fmt.log`) exist twice: the
 * facade publishes the first instance's value while the handle holds the
 * second's. For a module you only read from, a plain `import` keeps a single
 * instance and therefore a single identity — see
 * `test/task-2233-reviewer-non-submission-bounce.test.ts` and
 * `test/coverage-gate.test.ts` for that pattern.
 */
import { mock } from 'node:test';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type ModuleState = Record<string, unknown>;

interface PendingRegistration {
  url: string;
  state: ModuleState;
}

const pending: PendingRegistration[] = [];
const installed = new Map<string, ModuleState>();
let freshCounter = 0;

function isClass(value: unknown): value is new (..._args: unknown[]) => unknown {
  return typeof value === 'function'
    && /^class[\s{]/.test(Function.prototype.toString.call(value));
}

function buildClassFacade(state: ModuleState, key: string): unknown {
  const original = state[key] as new (..._args: unknown[]) => unknown;
  return new Proxy(original, {
    construct: (_target, args, newTarget) =>
      Reflect.construct(state[key] as new (..._a: unknown[]) => unknown, args, newTarget),
    get(target, prop, receiver) {
      const descriptor = Object.getOwnPropertyDescriptor(target, prop);
      // Proxy invariants forbid reporting a different value for a
      // non-configurable, non-writable own property (a class's `prototype`).
      if (descriptor && !descriptor.configurable && !descriptor.writable) {
        return Reflect.get(target, prop, receiver);
      }
      return Reflect.get(state[key] as object, prop);
    },
    set(_target, prop, value) {
      (state[key] as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
  });
}

function buildFacade(state: ModuleState): Record<string, unknown> {
  const facade: Record<string, unknown> = {};
  for (const key of Object.keys(state)) {
    if (isClass(state[key])) {
      // Class exports must stay constructible (`new ReviewState(...)`) and keep
      // their statics (`ReviewState.from(...)`) live under `mock.method`. A
      // plain delegating function loses both, so proxy the class itself.
      facade[key] = buildClassFacade(state, key);
    } else if (typeof state[key] === 'function') {
      const delegated = function delegated(this: unknown, ...args: unknown[]): unknown {
        return (state[key] as (..._callArgs: unknown[]) => unknown).apply(this, args);
      };
      // Callable exports frequently carry helpers as own properties
      // (`_internals` bags and the like). The delegate must expose them, and
      // expose them live, so a later `mock.method(handle, ...)` on the
      // underlying function is observed.
      for (const prop of Object.keys(state[key] as object)) {
        Object.defineProperty(delegated, prop, {
          configurable: true,
          enumerable: true,
          // For the default export the transpiled CommonJS tree handed tests and
          // production the *same* object, so `mock.method(handle, 'fn')` also
          // patched `handle.default.fn`. Preserve that by reading the named
          // export first when one exists under the same name.
          get: () => (key === 'default' && prop in state
            ? state[prop]
            : (state[key] as Record<string, unknown>)[prop]),
          set: (value: unknown) => {
            if (key === 'default' && prop in state) { state[prop] = value; return; }
            (state[key] as Record<string, unknown>)[prop] = value;
          },
        });
      }
      facade[key] = delegated;
    } else if (key === 'default' && state[key] !== null && typeof state[key] === 'object') {
      // Object default exports (the `export default stats` helper namespace in
      // stats.ts) carry the same helpers as the named exports. Route property
      // reads and writes through the module state so production seams like
      // `(stats as any).recordIntegrationStats` observe `mock.method(handle, ...)`
      // exactly like the callable-default form they replaced.
      const target = state[key] as Record<string | symbol, unknown>;
      facade[key] = new Proxy(target, {
        get: (_target, prop) => (typeof prop === 'string' && prop in state
          ? state[prop]
          : Reflect.get(target, prop)),
        set: (_target, prop, value) => {
          if (typeof prop === 'string' && prop in state) { state[prop] = value; return true; }
          return Reflect.set(target, prop, value);
        },
      });
    } else {
      facade[key] = state[key];
    }
  }
  return facade;
}

/**
 * Declare a module that this test file wants to observe or patch. Returns the
 * mutable handle immediately; it is populated by `installModuleMocks()`.
 */
export function mockModule<T>(specifier: string, parentUrl: string): Mutable<T> {
  const url = specifier.startsWith('node:') ? specifier : new URL(specifier, parentUrl).href;
  const already = installed.get(url);
  if (already) { return already as Mutable<T>; }
  const existing = pending.find(entry => entry.url === url);
  if (existing) { return existing.state as Mutable<T>; }
  const state: ModuleState = {};
  pending.push({ url, state });
  return state as Mutable<T>;
}

/**
 * Register every declared module's facade, then re-link each module so its own
 * imports resolve to those facades. Await this before using any handle.
 */
export async function installModuleMocks(): Promise<void> {
  const batch = pending.splice(0, pending.length);
  if (batch.length === 0) { return; }

  // Pass 1 — discover the export shape and register a facade per module URL.
  for (const entry of batch) {
    const builtin = entry.url.startsWith('node:');
    const initial = (await import(entry.url)) as Record<string, unknown>;
    for (const key of Object.keys(initial)) {
      if (builtin && key === 'default') { continue; }
      entry.state[key] = initial[key];
    }
    // Mirror properties from the default export onto the facade so that
    // CJS-style patterns like `module._internals` (where _internals is
    // attached to the default export) work identically to the ESM namespace
    // proxy that module-mock produces. Object default exports (helper
    // namespaces such as stats.ts's `export default stats`) are included so
    // their properties route through the same state as the named exports.
    if (initial.default !== null && initial.default !== undefined && (typeof initial.default === 'function' || typeof initial.default === 'object')) {
      for (const key of Object.keys(initial.default)) {
        if (!(key in entry.state)) {
          entry.state[key] = (initial.default as unknown as Record<string, unknown>)[key];
        }
      }
    }
    const facade = buildFacade(entry.state);
    if (builtin) {
      // A core module's default export is its CJS namespace object. Point it
      // at the facade so `import fs from 'node:fs'` consumers are patched too.
      facade.default = facade;
    }
    mock.module(entry.url, { exports: facade });
    installed.set(entry.url, entry.state);
  }

  // Pass 2 — reload each module past the ESM cache so its dependency bindings
  // resolve to the facades registered above, then repoint the handle at those
  // implementations. Core modules have no project dependencies to re-link.
  freshCounter += 1;
  for (const entry of batch) {
    if (entry.url.startsWith('node:')) { continue; }
    const relinked = (await import(`${entry.url}?module-mock=${freshCounter}`)) as Record<string, unknown>;
    for (const key of Object.keys(entry.state)) {
      if (typeof relinked[key] === 'function') {
        entry.state[key] = relinked[key];
      }
    }
  }
}

/**
 * Load a module past the ESM cache, for tests that need it to re-evaluate
 * after mutating the environment it reads at load time. This is the ESM-native
 * replacement for `delete require.cache[...]`.
 */
export async function importFresh<T>(specifier: string, parentUrl: string): Promise<Mutable<T>> {
  freshCounter += 1;
  const url = new URL(specifier, parentUrl).href;
  const loaded = (await import(`${url}?module-mock-fresh=${freshCounter}`)) as Record<string, unknown>;
  return { ...loaded } as Mutable<T>;
}
