import type { PiSdk } from '../../src/adapters/agents/pi-sdk-types.js';

/** Cases supply the SDK operations they exercise; other calls fail immediately. */
export function piSdkFixture(overrides: Partial<Omit<PiSdk, 'SessionManager'>> & {
  SessionManager?: Partial<PiSdk['SessionManager']>;
} = {}): PiSdk {
  return {
    createAgentSession: () => { throw new Error('Unexpected Pi session creation'); },
    ...overrides,
    SessionManager: {
      list: () => { throw new Error('Unexpected Pi session listing'); },
      open: () => { throw new Error('Unexpected Pi session open'); },
      create: () => { throw new Error('Unexpected Pi manager creation'); },
      continueRecent: () => { throw new Error('Unexpected Pi session continuation'); },
      ...overrides.SessionManager,
    },
  };
}
