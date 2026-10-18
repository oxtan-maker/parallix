import { git } from '../git/git.js';
import { verificationToolchainIdentity } from './verification-proof-inputs.js';

/** One board read's immutable view of checkout inputs, never shared across builds. */
export class VerificationReadSnapshot {
  private readonly _values = new Map<string, unknown>();

  constructor(private readonly _git: typeof git = git) {}

  memo<T>(key: string, read: () => T): T {
    if (!this._values.has(key)) { this._values.set(key, read()); }
    return this._values.get(key) as T;
  }

  readonly git: typeof git = (args, options) => this.memo(
    JSON.stringify(['git', args, options]), () => this._git(args, options),
  );

  toolchain(searchPath: string): string {
    return this.memo(JSON.stringify(['toolchain', searchPath]), () => verificationToolchainIdentity(searchPath));
  }
}
