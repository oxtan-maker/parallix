import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type WorkflowRun = {
  id?: number;
  path?: string;
  event?: string;
  head_sha?: string;
  head_branch?: string;
  status?: string;
  conclusion?: string | null;
  created_at?: string;
  updated_at?: string;
};

type WorkflowJob = {
  name?: string;
  status?: string;
  conclusion?: string | null;
  completed_at?: string | null;
};

type GitHubRequest = (path: string) => Promise<unknown>;

const workflowPath = '.github/workflows/ci-required.yml';
const requiredJobName = 'ci-required';

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`GitHub publication proof cannot run: ${name} is unavailable.`);
  return value;
}

function timestamp(value: string | null | undefined, description: string): number {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new Error(`GitHub publication proof is invalid: ${description} timestamp is unavailable.`);
  }
  return Date.parse(value);
}

function asRun(value: unknown, description: string): WorkflowRun {
  if (!value || typeof value !== 'object') throw new Error(`GitHub publication proof API returned invalid ${description} data.`);
  return value as WorkflowRun;
}

function asRuns(value: unknown): WorkflowRun[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { workflow_runs?: unknown }).workflow_runs)) {
    throw new Error('GitHub publication proof API returned invalid workflow-run data.');
  }
  return (value as { workflow_runs: WorkflowRun[] }).workflow_runs;
}

function asJobs(value: unknown): WorkflowJob[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { jobs?: unknown }).jobs)) {
    throw new Error('GitHub publication proof API returned invalid job data.');
  }
  return (value as { jobs: WorkflowJob[] }).jobs;
}

function candidateFailure(run: WorkflowRun, sha: string, mainStartedAt: number): string | null {
  if (run.path?.split('@')[0] !== workflowPath) return `workflow path is not ${workflowPath}`;
  if (run.event !== 'push') return 'event is not push';
  if (run.head_sha !== sha) return 'head SHA does not match the current main SHA';
  if (run.head_branch !== `github-publish/${sha}`) return 'head branch is not the exact github-publish SHA ref';
  if (run.status !== 'completed' || run.conclusion !== 'success') return 'workflow run is not a successful completed run';
  if (timestamp(run.updated_at, 'publication proof update') >= mainStartedAt) return 'workflow run did not complete before the current main workflow began';
  return null;
}

function assertCurrentMainRun(run: WorkflowRun, sha: string): number {
  if (run.path?.split('@')[0] !== workflowPath) throw new Error(`GitHub publication proof is invalid: current workflow path is not ${workflowPath}.`);
  if (run.event !== 'push' || run.head_branch !== 'main' || run.head_sha !== sha) {
    throw new Error('GitHub publication proof is invalid: it must run only for the current main push and exact SHA.');
  }
  return timestamp(run.created_at, 'current main workflow start');
}

export async function findGithubPublicationProof(options: {
  repository: string;
  sha: string;
  currentRunId: string;
  request: GitHubRequest;
}): Promise<{ runId: number } | null> {
  const repository = required(options.repository, 'GITHUB_REPOSITORY');
  const sha = required(options.sha, 'GITHUB_SHA');
  const currentRunId = required(options.currentRunId, 'GITHUB_RUN_ID');
  let current: WorkflowRun;
  let candidates: WorkflowRun[];
  try {
    current = asRun(await options.request(`/repos/${repository}/actions/runs/${encodeURIComponent(currentRunId)}`), 'current workflow-run');
    candidates = asRuns(await options.request(`/repos/${repository}/actions/workflows/ci-required.yml/runs?event=push&head_sha=${encodeURIComponent(sha)}&status=completed&per_page=100`));
  } catch (error) {
    throw new Error(`GitHub publication proof lookup failed: ${(error as Error).message}`);
  }
  const mainStartedAt = assertCurrentMainRun(current, sha);
  for (const run of candidates) {
    const failure = candidateFailure(run, sha, mainStartedAt);
    if (failure) continue;
    if (typeof run.id !== 'number') throw new Error('GitHub publication proof run ID is unavailable.');
    let jobs: WorkflowJob[];
    try {
      jobs = asJobs(await options.request(`/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`));
    } catch (error) {
      throw new Error(`GitHub publication proof job lookup failed: ${(error as Error).message}`);
    }
    const requiredJob = jobs.find((job) => job.name === requiredJobName);
    if (!requiredJob || requiredJob.status !== 'completed' || requiredJob.conclusion !== 'success') {
      continue;
    }
    if (timestamp(requiredJob.completed_at, 'ci-required job completion') >= mainStartedAt) {
      continue;
    }
    return { runId: run.id };
  }
  return null;
}

export async function assertGithubPublicationProof(options: Parameters<typeof findGithubPublicationProof>[0]): Promise<{ runId: number }> {
  const proof = await findGithubPublicationProof(options);
  if (!proof) throw new Error(`GitHub publication proof was not found for exact SHA ${options.sha}.`);
  return proof;
}

export function githubApiRequest(token: string, request: typeof fetch = fetch): GitHubRequest {
  return async (apiPath: string): Promise<unknown> => {
    let response: Response;
    try {
      response = await request(`https://api.github.com${apiPath}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    } catch (error) {
      throw new Error(`GitHub Actions API is unavailable: ${(error as Error).message}`);
    }
    if (!response.ok) throw new Error(`GitHub Actions API returned HTTP ${response.status}.`);
    try { return await response.json(); } catch { throw new Error('GitHub Actions API returned malformed JSON.'); }
  };
}

async function main(): Promise<void> {
  const token = required(process.env.GITHUB_TOKEN || process.env.GH_TOKEN, 'GITHUB_TOKEN');
  const result = await findGithubPublicationProof({
    repository: required(process.env.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY'),
    sha: required(process.env.GITHUB_SHA, 'GITHUB_SHA'),
    currentRunId: required(process.env.GITHUB_RUN_ID, 'GITHUB_RUN_ID'),
    request: githubApiRequest(token),
  });
  appendFileSync(required(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT'), `verified=${result !== null}\n`);
  console.log(result ? `Verified prior github-publish proof from workflow run ${result.runId}.` : 'No reusable publication proof; full main verification is required.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
