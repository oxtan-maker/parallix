import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parsePolicyArtifact } from '../../application/verification-policy/policy-artifact.js';
import type { PolicyArtifactLoader, PolicyLoadResult, VerificationPolicyConfiguration } from '../../application/ports/verification-policy.js';

export function verificationPolicyConfig(value: unknown, report: (message: string) => void): VerificationPolicyConfiguration {
  if (value === undefined) { return {}; }
  const config = value as { readonly artifact?: unknown } | null;
  if (config && typeof config === 'object' && !Array.isArray(config)
    && (config.artifact === undefined || (typeof config.artifact === 'string' && config.artifact.trim().length > 0))) {
    return config.artifact ? { artifact: config.artifact } : {};
  }
  report('verificationPolicy is invalid; using fixed policy.');
  return {};
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
  let pinned: Extract<PolicyLoadResult, { kind: 'artifact' }> | undefined;
  return expectedHash => {
    if (!pinned) {
      if (!config.artifact) { return { kind: 'fixed', reason: 'missing' }; }
      let input: string;
      try { input = read(path.resolve(rootDir, config.artifact)); }
      catch (error) { return { kind: 'fixed', reason: (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'missing' : 'unreadable' }; }
      const parsed = parsePolicyArtifact(input);
      if (!parsed.ok) { return { kind: 'fixed', reason: 'invalid', rejection: parsed.rejection }; }
      let hash: string;
      try { hash = createHash('sha256').update(canonical(JSON.parse(input))).digest('hex'); }
      catch { // the identity covers the whole document, so an unbounded ignored field must degrade to a typed result, not a crash
        return { kind: 'fixed', reason: 'invalid', rejection: { code: 'unreadable', path: 'artifact', message: 'artifact identity could not be computed' } };
      }
      if (expectedHash !== undefined && hash !== expectedHash) { return { kind: 'fixed', reason: 'hash-mismatch' }; }
      pinned = { kind: 'artifact', hash, artifact: parsed.artifact };
    }
    return expectedHash !== undefined && pinned.hash !== expectedHash ? { kind: 'fixed', reason: 'hash-mismatch' } : pinned;
  };
}
