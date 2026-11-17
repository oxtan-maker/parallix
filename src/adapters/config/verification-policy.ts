import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parsePolicyArtifact } from '../../application/verification-policy/policy-artifact.js';
import type { PolicyArtifactLoader, PolicyLoadResult, VerificationPolicyConfiguration } from '../../application/ports/verification-policy.js';

export function verificationPolicyConfig(value: unknown, report: (message: string) => void): VerificationPolicyConfiguration {
  if (value === undefined) { return { mode: 'off' }; }
  const config = value as Partial<VerificationPolicyConfiguration> | null;
  if (config && typeof config === 'object' && !Array.isArray(config)
    && (config.mode === undefined || ['off', 'shadow', 'pilot'].includes(config.mode))
    && (config.artifact === undefined || (typeof config.artifact === 'string' && config.artifact.trim().length > 0))
    && (!config.mode || config.mode === 'off' || config.artifact)) {
    return { mode: config.mode ?? 'off', ...(config.artifact ? { artifact: config.artifact } : {}) };
  }
  report('verificationPolicy is invalid; disabled (fixed policy).');
  return { mode: 'off' };
}

/** Canonical JSON: recursively sorted object keys, array order preserved, UTF-8 without whitespace. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) { return `[${value.map(canonical).join(',')}]`; }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function createPolicyArtifactLoader(rootDir: string, config: VerificationPolicyConfiguration,
  read: (file: string) => string = file => fs.readFileSync(file, 'utf8')): PolicyArtifactLoader {
  let pinned: Extract<PolicyLoadResult, { mode: 'shadow' }> | undefined;
  return expectedHash => {
    if (config.mode === 'off') { return { mode: 'off' }; }
    if (!pinned) {
      if (!config.artifact) { return { mode: 'fixed', reason: 'missing' }; }
      let input: string;
      try { input = read(path.resolve(rootDir, config.artifact)); }
      catch (error) { return { mode: 'fixed', reason: (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'missing' : 'unreadable' }; }
      const parsed = parsePolicyArtifact(input);
      if (!parsed.ok) { return { mode: 'fixed', reason: 'invalid', rejection: parsed.rejection }; }
      const hash = createHash('sha256').update(canonical(parsed.artifact)).digest('hex');
      if (expectedHash !== undefined && hash !== expectedHash) { return { mode: 'fixed', reason: 'hash-mismatch' }; }
      pinned = { mode: 'shadow', hash, artifact: parsed.artifact };
    }
    return expectedHash !== undefined && pinned.hash !== expectedHash ? { mode: 'fixed', reason: 'hash-mismatch' } : pinned;
  };
}
