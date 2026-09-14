import child_process from 'node:child_process';

export interface ExpectedGithubPr {
  readonly number?: number;
  readonly head: string;
  readonly base: string;
  readonly candidateSha: string;
}

export type GithubPr = { number: number; state: string; merged?: boolean; mergedAt?: string | null; merge_commit_sha?: string | null; mergeCommit?: { oid?: string | null } | null; head: { ref: string; sha: string }; base: { ref: string } };

export type GithubPrObservation =
  | { kind: 'pending'; number: number; base: string }
  | { kind: 'merged'; number: number; base: string; resultingSha: string }
  | { kind: 'closed-unmerged'; number: number; base: string }
  | { kind: 'target-changed'; expected: string; actual: string }
  | { kind: 'unexpected-tree'; number: number; base: string }
  | { kind: 'unavailable'; error: string };

/** Classify a fresh GitHub PR read; callers decide whether a merged result closes a mission. */
export function observeGithubPr(expected: ExpectedGithubPr, read: () => GithubPr, treesMatch: (_candidate: string, _resulting: string) => boolean): GithubPrObservation {
  try {
    const pr = read();
    if (pr.base.ref !== expected.base) { return { kind: 'target-changed', expected: expected.base, actual: pr.base.ref }; }
    if (!pr.merged && !pr.mergedAt) {
      return pr.state === 'CLOSED'
        ? { kind: 'closed-unmerged', number: pr.number, base: pr.base.ref }
        : { kind: 'pending', number: pr.number, base: pr.base.ref };
    }
    const resultingSha = pr.merge_commit_sha || pr.mergeCommit?.oid || pr.head.sha;
    if (!resultingSha || !treesMatch(expected.candidateSha, resultingSha)) {
      return { kind: 'unexpected-tree', number: pr.number, base: pr.base.ref };
    }
    return { kind: 'merged', number: pr.number, base: pr.base.ref, resultingSha };
  } catch (error: any) {
    return { kind: 'unavailable', error: error?.message || String(error) };
  }
}

function run(command: string, args: string[], rootDir: string) {
  const result = child_process.spawnSync(command, args, { cwd: rootDir, encoding: 'utf8' });
  if (result.status !== 0) { throw new Error(String(result.stderr || result.stdout || `${command} failed`).trim()); }
  return String(result.stdout || '').trim();
}

function repo(rootDir: string) {
  const remote = run('git', ['remote', 'get-url', 'origin'], rootDir).replace(/\.git$/, '');
  const match = remote.match(/github\.com[:/]([^/]+\/[^/]+)$/);
  if (!match) { throw new Error('origin is not a GitHub repository'); }
  return match[1];
}

/** Push the reviewed branch and create or read its GitHub PR. GitHub remains merge authority. */
export function submitOrObserveGithubPr(expected: ExpectedGithubPr, rootDir: string): GithubPrObservation {
  try {
    const repository = repo(rootDir);
    run('git', ['push', 'origin', `HEAD:refs/heads/${expected.head}`], rootDir);
    let pr: GithubPr;
    try {
      pr = JSON.parse(run('gh', ['pr', 'view', expected.head, '--repo', repository, '--json', 'number,state,mergedAt,mergeCommit,headRefName,headRefOid,baseRefName'], rootDir));
    } catch {
      pr = JSON.parse(run('gh', ['pr', 'create', '--repo', repository, '--head', expected.head, '--base', expected.base, '--fill', '--json', 'number,state,mergedAt,mergeCommit,headRefName,headRefOid,baseRefName'], rootDir));
    }
    const normalized = {
      number: pr.number, state: pr.state, mergedAt: pr.mergedAt, mergeCommit: pr.mergeCommit,
      head: { ref: (pr as any).headRefName, sha: (pr as any).headRefOid }, base: { ref: (pr as any).baseRefName },
    } as GithubPr;
    return observeGithubPr(expected, () => normalized, (candidate, resulting) => {
      const candidateTree = run('gh', ['api', `repos/${repository}/git/commits/${candidate}`, '--jq', '.tree.sha'], rootDir);
      const resultingTree = run('gh', ['api', `repos/${repository}/git/commits/${resulting}`, '--jq', '.tree.sha'], rootDir);
      return candidateTree === resultingTree;
    });
  } catch (error: any) {
    return { kind: 'unavailable', error: error?.message || String(error) };
  }
}
