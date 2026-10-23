/** Shared review CLI vocabulary and independent operator purposes. */
export const REVIEW_OPTIONS = {
  '--status': { value: null, purpose: 'Inspect the recorded Review without running agents.' },
  '--verify': { value: null, purpose: 'Check handoff readiness without submitting.' },
  '--submit': { value: null, purpose: 'Perform handoff without entering the autonomous loop.' },
  '--push': { value: null, purpose: 'Push the current review branch and refresh its PR.' },
  '--force': { value: null, purpose: 'Allow an explicit force push with --push.' },
  '--comments': { value: null, purpose: 'Read provider comments.' },
  '--comment': { value: 'text', purpose: 'Post a provider comment.' },
  '--comment-file': { value: 'path', purpose: 'Read a provider comment from a file.' },
  '--submit-review': { value: 'outcome', purpose: 'Submit an explicit provider review outcome and enforce approval gates.' },
  '--message': { value: 'text', purpose: 'Supply the explicit provider review summary.' },
  '--message-file': { value: 'path', purpose: 'Read the explicit provider review summary from a file.' },
  '--close': { value: null, purpose: 'Close the mission PR without merging.' },
  '--implementer': { value: 'agent', purpose: 'Override the implementer for this review.' },
  '--reviewer': { value: 'agent', purpose: 'Override the independently selected reviewer.' },
  '--focus': { value: 'focus', purpose: 'Choose the reviewer prompt focus.' },
  '--max-attempts': { value: 'n', purpose: 'Bound the round count for this invocation.' },
  '--poll-timeout-seconds': { value: 'seconds', purpose: 'Bound provider polling for this invocation.' },
  '--dry-run': { value: null, purpose: 'Preview without launching agents or acknowledging recovery.' },
  '--reset': { value: null, purpose: 'Explicitly reset recorded loop state before review.' },
  '--verbose': { value: null, purpose: 'Print detailed review and polling diagnostics.' },
  '--actor': { value: 'name', purpose: 'Attribute direct operator recovery to a named operator.' },
  '--no-gate': { value: null, purpose: 'Use the explicit readiness/submit gate bypass supported by those operations.' },
  '--backfill-review': { value: null, purpose: 'Migrate a pre-cutover review-state file into a Review.' },
  '--reconcile-review': { value: null, purpose: 'Reconcile an interrupted first handoff using explicit PR identity.' },
  '--branch': { value: 'branch', purpose: 'Name the interrupted handoff branch.' },
  '--target': { value: 'branch', purpose: 'Name the interrupted handoff target.' },
  '--revision': { value: 'revision', purpose: 'Pin the interrupted handoff revision.' },
  '--eligible-reviewer': { value: 'agent', purpose: 'Supply an eligible reviewer when reconciling handoff.' },
} as const;

export const REVIEW_FLAGS: ReadonlySet<string> = new Set(Object.keys(REVIEW_OPTIONS));
export const REVIEW_VALUE_FLAGS: ReadonlySet<string> = new Set(Object.entries(REVIEW_OPTIONS).filter(([, option]) => option.value !== null).map(([flag]) => flag));
const reviewOptionUsage = Object.entries(REVIEW_OPTIONS).map(([flag, option]) => `[${flag}${option.value ? ` <${option.value}>` : ''}]`);
export const REVIEW_USAGE = reviewOptionUsage.reduce((usage, option) => {
  const lastLine = usage.slice(usage.lastIndexOf('\n') + 1);
  return `${usage}${lastLine.length + option.length + 1 > 100 ? '\n    ' : ' '}${option}`;
}, 'px review');

/** Find the slug without mistaking a selector value for a positional argument. */
export function reviewExplicitSlug(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) { return arg; }
    if (!arg.includes('=') && REVIEW_VALUE_FLAGS.has(arg)) { index++; }
  }
  return undefined;
}
