import type { PolicyArtifact, PolicyRejection } from '../verification-policy/policy-artifact.js';

export interface VerificationPolicyConfiguration {
  readonly mode: 'off' | 'shadow' | 'pilot';
  readonly artifact?: string;
}
export type PolicyLoadResult =
  | { readonly mode: 'off' }
  | { readonly mode: 'shadow'; readonly hash: string; readonly artifact: PolicyArtifact }
  | { readonly mode: 'fixed'; readonly reason: 'missing' | 'invalid' | 'unreadable' | 'hash-mismatch'; readonly rejection?: PolicyRejection };
/** One loader per mission entry; callers retain its canonical pin across observations. */
export type PolicyArtifactLoader = (expectedHash?: string) => PolicyLoadResult;
