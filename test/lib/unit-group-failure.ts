import { elideBounceOutput } from '../../src/application/output-elision.js';

/** Reprint failed assertions after both parallel groups settle so bounce tails retain them. */
export function unitGroupFailure(name: string, code: number | null, signal: string | null, stdout: string, stderr: string): Error {
  const failures = stdout.lastIndexOf('✖ failing tests:');
  const diagnostic = failures >= 0 ? stdout.slice(failures) : stdout;
  return new Error([
    `${name} unit group failed: exit=${code} signal=${signal}`,
    elideBounceOutput(diagnostic, 8_000),
    elideBounceOutput(stderr, 6_000),
  ].filter(Boolean).join('\n'));
}
