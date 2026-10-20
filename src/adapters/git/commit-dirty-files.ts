type GitRunner = (_args: string[]) => { status: number | null; stdout?: string; stderr?: string };
type CommitResult = {
  repaired: boolean; blocker: string | null; dirty?: boolean;
  conflicts?: string[]; operation?: 'status' | 'stage' | 'commit'; output?: string;
};
type CommitSelection = {
  accepts: (_file: string) => boolean;
  message: string;
};

type Scan = { selected: string[]; commitPaths: string[] } | { blocker: string; detail: Partial<CommitResult> };

const CONFLICT_STATES = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'];
const INVALID_STATUS = 'Cannot auto-commit handoff changes: invalid Git status output. Inspect git status and retry handoff.';
const MISSING_SOURCE = 'Cannot auto-commit handoff changes: missing rename source in Git status. Inspect git status and retry handoff.';

function scanRecords(records: string[], rootDir: string, selection?: CommitSelection): Scan {
  const selected: string[] = [];
  const commitPaths: string[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const state = record.slice(0, 2);
    const file = record.slice(3);
    if (CONFLICT_STATES.includes(state)) {
      return { blocker: `Cannot auto-commit handoff changes: unresolved conflict in ${file}. Resolve conflicts in ${rootDir} and retry handoff.`, detail: { dirty: true, conflicts: [file] } };
    }
    if (!file || record[2] !== ' ') { return { blocker: INVALID_STATUS, detail: {} }; }
    const paths = [file];
    if (/[RC]/.test(state)) {
      const source = records[++index];
      if (!source) { return { blocker: MISSING_SOURCE, detail: {} }; }
      paths.push(source);
    }
    if (!selection || paths.every(selection.accepts)) {
      // A staged deletion is already absent from the index; adding it again fails.
      if (state !== 'D ') { selected.push(file); }
      commitPaths.push(...paths);
    }
  }
  return { selected, commitPaths };
}

/** Existing handoff repair commit mechanism, shared with pre-review artifact cleanup. */
export function commitDirtyFiles(rootDir: string, slug: string, git: GitRunner, log: (_message: string) => void, error: (_message: string) => void, selection?: CommitSelection): CommitResult {
  const blocked = (blocker: string, detail: Partial<CommitResult> = {}): CommitResult => { error(blocker); return { repaired: false, blocker, ...detail }; };
  try {
    const status = git(['-C', rootDir, 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
    if (status.status !== 0) { return blocked(failure('read worktree status', status), { operation: 'status' }); }
    const records = (status.stdout || '').split('\0').filter(Boolean);
    const scan = scanRecords(records, rootDir, selection);
    if ('blocker' in scan) { return blocked(scan.blocker, scan.detail); }
    if (!records.length) { return { repaired: false, blocker: null }; }
    if (!scan.commitPaths.length) { return { repaired: false, blocker: null, dirty: true }; }
    log(selection ? `Auto-committing safe mission artifacts for mission/${slug} before rebase...` : 'Auto-committing dirty files:');
    const failed = stageAndCommit(rootDir, slug, git, scan, selection);
    if (failed) { return blocked(failed.blocker, failed.detail); }
    log(selection ? 'Mission artifacts committed.' : 'Mission changes committed before handoff verification and rebase.');
    return { repaired: true, blocker: null };
  } catch (err) {
    return blocked(`Cannot auto-commit handoff changes: ${err instanceof Error ? err.message : String(err)}. Inspect git status in ${rootDir} and retry handoff.`);
  }
}

function stageAndCommit(rootDir: string, slug: string, git: GitRunner, scan: { selected: string[]; commitPaths: string[] }, selection?: CommitSelection): { blocker: string; detail: Partial<CommitResult> } | null {
  // Stage the checkout root: already staged deletions/renames may no longer
  // have their old path in the index, so restaging each status path can fail.
  const stagePaths = selection ? scan.selected : ['.'];
  for (const file of stagePaths) {
    const staged = git(['-C', rootDir, 'add', '--all', '--', file]);
    if (staged.status !== 0) { return { blocker: failure('stage mission changes', staged), detail: { dirty: true, operation: 'stage' } }; }
  }
  const message = selection?.message ?? `workflow(${slug}): auto-commit mission artifacts before handoff`;
  const commitArgs = selection ? ['commit', '--only', '-m', message, '--', ...new Set(scan.commitPaths)] : ['commit', '-m', message];
  const committed = git(['-C', rootDir, ...commitArgs]);
  if (committed.status === 0) { return null; }
  return { blocker: failure('commit mission changes', committed), detail: { dirty: true, operation: 'commit', output: [committed.stderr, committed.stdout].filter(Boolean).join('\n').trim() } };
}

function failure(operation: string, result: { stdout?: string; stderr?: string }): string {
  const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
  return `Cannot ${operation} before handoff${detail ? `: ${detail}` : ''}. Resolve the Git error and retry handoff.`;
}
