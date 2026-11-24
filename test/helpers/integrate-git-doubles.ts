type GitResult = { signal: null; status: number; stdout: string; stderr: string };

/** Complete persisted gate receipt used by integration consumers in unit fixtures. */
export function recordedGateRun(gates: readonly { key: string; command: string }[], options: {
  id?: string; revision?: string; status?: 'passed' | 'failed';
  /** Adapter currency verdict: the run covers the target revision, an equivalent input or a completed rebase. */
  current?: boolean; carried?: ReadonlyArray<{ from: string; to: string }>;
} = {}) {
  const status = options.status ?? 'passed';
  return { gateRunId: options.id ?? 'run-1', revision: options.revision ?? 'candidate', status,
    current: options.current ?? true, carried: options.carried ?? null,
    gates: gates.map(({ key, command }) => ({ key, command })),
    outcomes: gates.map(({ key, command }) => ({ key, command, exitCode: status === 'passed' ? 0 : 1 })) };
}

/** Stateful task-2506 Git seam: landing conflicts until the integration rebase runs. */
export function behindPrimaryGitDouble(slug: string, rebased: { value: boolean }, unreadableApproval = false) {
  return (args: string[]): GitResult => {
    if (unreadableApproval && args.includes('cat-file')) {
      return { signal: null, status: 1, stdout: '', stderr: 'missing approved commit' };
    }
    if (args.includes('rebase')) {
      if (args.includes('--show-current') || args.includes('--continue')) {
        return { signal: null, status: 0, stdout: '', stderr: '' };
      }
      rebased.value = true;
      return { signal: null, status: 0, stdout: '', stderr: '' };
    }
    const joined = args.join(' ');
    if (joined.includes('merge-base') && joined.includes('--is-ancestor')) {
      return { signal: null, status: 0, stdout: '', stderr: '' };
    }
    if (joined.includes('merge-base') || args.includes('rev-parse')) {
      return { signal: null, status: 0, stdout: 'landed-sha', stderr: '' };
    }
    if (args.includes('show')) {
      return { signal: null, status: 0, stdout: '2026-05-15T12:00:00+00:00', stderr: '' };
    }
    if (joined.includes('merge') && joined.includes('--no-commit')) {
      return rebased.value
        ? { signal: null, status: 0, stdout: '', stderr: '' }
        : { signal: null, status: 1, stdout: 'CONFLICT (content): Merge conflict in src/app.ts\n', stderr: '' };
    }
    if (joined.includes('merge') && joined.includes('--abort')) {
      return rebased.value
        ? { signal: null, status: 0, stdout: '', stderr: '' }
        : { signal: null, status: 1, stdout: 'fatal: There is no merge to abort\n', stderr: '' };
    }
    if (joined.includes('diff') && joined.includes('--cached')) {
      return { signal: null, status: 0, stdout: 'src/app.ts\n', stderr: '' };
    }
    if (joined.includes('symbolic-ref')) {
      return { signal: null, status: 0, stdout: `mission/${slug}`, stderr: '' };
    }
    if (joined.includes('branch')) {
      return { signal: null, status: 0, stdout: 'main\n', stderr: '' };
    }
    return { signal: null, status: 0, stdout: '', stderr: '' };
  };
}

/** Read-only task-2506 prediction seam: main advanced without a conflicting tree. */
export function behindPrimaryDryRunGitDouble(slug: string, calls: string[][]) {
  return (args: string[]): GitResult => {
    calls.push(args.slice());
    const joined = args.join(' ');
    if (joined.includes('rev-parse') && joined.includes(`mission/${slug}`)) {
      return { signal: null, status: 0, stdout: 'mission-sha', stderr: '' };
    }
    if (joined.includes('rev-parse')) {
      return { signal: null, status: 0, stdout: 'base-sha', stderr: '' };
    }
    if (joined.includes('merge-base')) {
      return { signal: null, status: 0, stdout: 'other-sha', stderr: '' };
    }
    if (joined.includes('merge-tree')) {
      return { signal: null, status: 0, stdout: '', stderr: '' };
    }
    if (joined.includes('branch')) {
      return { signal: null, status: 0, stdout: 'main\n', stderr: '' };
    }
    return { signal: null, status: 0, stdout: '', stderr: '' };
  };
}
