/**
 * Operator recovery guidance for an integration checkout blocked by Git state.
 *
 * One owner for the wording shared by the integration preflight and the
 * post-landing stash-restore report, so a state is described identically
 * wherever it is found. Every command is read-only except the clearly
 * labelled staging step; nothing here deletes, resets or discards.
 */

/** Quote one word for a POSIX shell; plain path characters stay readable. */
export function quoteShellWord(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * `git -C <root> --literal-pathspecs <args>`: a conflicted file named like pathspec magic
 * (`:(glob)*`) must name only itself, never a set of unrelated paths.
 */
function literalGit(root: string, args: string): string {
  return `git -C ${root} --literal-pathspecs ${args}`;
}

export interface CheckoutIdentity {
  readonly baseWorktree: string;
  readonly baseBranch: string;
  /** Branch observed in the receiving checkout; empty when HEAD is detached. */
  readonly observedBranch?: string | null;
}

/** One line naming the resolved receiving checkout and its branch. */
export function receivingCheckoutLine(identity: CheckoutIdentity): string {
  const observed = identity.observedBranch === undefined ? identity.baseBranch : (identity.observedBranch || '(detached HEAD)');
  const expected = observed === identity.baseBranch ? '' : ` (expected ${identity.baseBranch})`;
  return `Receiving checkout: ${identity.baseWorktree} on branch ${observed}${expected}`;
}

/**
 * Guidance for unmerged index entries. `rebaseMetadata` is true only when
 * Git's own rebase directory exists; unmerged entries alone prove neither a
 * rebase, committed conflict markers, a completed landing nor a stash origin.
 */
export function unresolvedIndexGuidance(baseWorktree: string, files: readonly string[], { rebaseMetadata }: { rebaseMetadata: boolean }): string[] {
  const root = quoteShellWord(baseWorktree);
  const paths = files.map(quoteShellWord).join(' ');
  const lines = [
    rebaseMetadata
      ? 'These entries belong to the paused rebase above; resolve them with the rebase steps.'
      : 'No rebase metadata was found, so this is unresolved index state, not a rebase. Its origin (for example a failed stash restore) is not proven by the entries alone.',
    'Inspect without changing anything:',
    `  git -C ${root} status --short`,
    `  ${literalGit(root, `ls-files -u -- ${paths}`)}`,
    'Edit each path so it keeps the intended content from both sides and no conflict markers remain, then stage the reviewed result:',
    ...files.map(file => `  ${literalGit(root, `add -- ${quoteShellWord(file)}`)}`),
    'Only if removing a path is the intended outcome, stage that deletion deliberately instead:',
    ...files.map(file => `  ${literalGit(root, `rm -- ${quoteShellWord(file)}`)}`),
  ];
  return lines;
}

/** Continue, abort and skip for a genuine paused rebase, each with its consequence. */
export function pausedRebaseGuidance(baseWorktree: string): string[] {
  const root = quoteShellWord(baseWorktree);
  return [
    'Resolve and stage each path, then choose one (they have different consequences):',
    'Continue: replays the remaining commits using your staged resolutions.',
    `  git -C ${root} rebase --continue`,
    'Abort: discards the rebase progress and restores the branch to its pre-rebase state; staged resolutions are lost.',
    `  git -C ${root} rebase --abort`,
    'Skip: drops the commit currently being replayed together with its changes.',
    `  git -C ${root} rebase --skip`,
  ];
}

/** The one integration stash proven responsible: reference, object identity and marker all matched. */
export interface ResponsibleStash {
  readonly ref: string;
  readonly objectId: string;
  readonly marker: string;
}

/**
 * Locate the responsible stash in `git stash list --format=%gd%x00%H%x00%gs`
 * output. Only an entry whose object is the recorded one and whose subject
 * carries the marker qualifies; anything else stays unowned.
 */
export function findResponsibleStash(listOutput: string, expected: { objectId?: string; marker: string }): ResponsibleStash | null {
  if (!expected.objectId) { return null; }
  for (const line of listOutput.split('\n')) {
    const [ref, objectId, subject = ''] = line.split('\0');
    if (ref && objectId === expected.objectId && subject.endsWith(expected.marker)) {
      return { ref, objectId, marker: expected.marker };
    }
  }
  return null;
}

/**
 * Cleanup guidance for the stash left after a failed restore. Without a
 * verified owner every stash is retained; with one, removal is guarded so a
 * shifted reference can never drop a different entry.
 */
export function stashCleanupGuidance(baseWorktree: string, stash: ResponsibleStash | null): string[] {
  const root = quoteShellWord(baseWorktree);
  if (!stash) {
    return [
      'Stash ownership could not be verified (no entry matched the recorded object and marker). Every stash is retained; none is suggested for removal.',
      'Inspect read-only:',
      `  git -C ${root} stash list`,
    ];
  }
  const ref = quoteShellWord(stash.ref);
  return [
    `Responsible integration stash: ${stash.ref} (object ${stash.objectId}, marker "${stash.marker}"). Other stashes are unrelated and must stay untouched.`,
    'Before any cleanup, verify its contents were recovered in the checkout:',
    `  git -C ${root} stash show --stat --include-untracked ${stash.objectId}`,
    `  git -C ${root} status --short`,
    'Only once every stashed change is present, remove exactly this entry; the guard refuses if the reference now names a different object:',
    `  test "$(git -C ${root} rev-parse --verify -q ${ref})" = ${stash.objectId} && git -C ${root} stash drop ${ref}`,
  ];
}
