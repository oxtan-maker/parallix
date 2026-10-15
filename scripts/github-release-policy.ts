import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Use PR provenance, not the actor who clicked Merge or re-ran the workflow.
export async function isGithubReleaseEligible(options: {
  repository: string;
  sha: string;
  request: (path: string) => Promise<unknown>;
}): Promise<boolean> {
  if (!options.repository || !options.sha) throw new Error('Release policy requires a repository and exact SHA.');
  for (let page = 1; ; page += 1) {
    const data = await options.request(`/repos/${options.repository}/commits/${encodeURIComponent(options.sha)}/pulls?per_page=100&page=${page}`);
    if (!Array.isArray(data)) throw new Error('Release policy received invalid pull-request data.');
    for (const value of data) {
      if (!value || typeof value !== 'object') throw new Error('Release policy received an invalid pull request.');
      const pr = value as { merged_at?: string | null; merge_commit_sha?: string; user?: { login?: string }; base?: { ref?: string; repo?: { full_name?: string } } };
      if (!pr.user?.login || !pr.base?.ref || !pr.base.repo?.full_name || !('merged_at' in pr)) {
        throw new Error('Release policy received incomplete pull-request provenance.');
      }
      if (pr.merged_at && pr.merge_commit_sha === options.sha && pr.base.ref === 'main' &&
          pr.base.repo.full_name === options.repository && pr.user.login === 'dependabot[bot]') return false;
    }
    if (data.length < 100) return true;
  }
}

async function main(): Promise<void> {
  const token = process.env.GH_TOKEN;
  const output = process.env.GITHUB_OUTPUT;
  if (!token || !output) throw new Error('Release policy requires GH_TOKEN and GITHUB_OUTPUT.');
  // Native Node executes this entrypoint without compiled JavaScript siblings.
  const apiModule = './verify-github-publication-proof.ts';
  const { githubApiRequest } = await import(apiModule);
  const eligible = await isGithubReleaseEligible({
    repository: process.env.GITHUB_REPOSITORY || '',
    sha: process.env.GITHUB_SHA || '',
    request: githubApiRequest(token),
  });
  appendFileSync(output, `eligible=${eligible}\n`);
  console.log(eligible ? 'Main commit is eligible for release after verification.' : 'Dependabot merge: verification remains required; package release is skipped.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
