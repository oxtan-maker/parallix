/**
 * Rebase workflow policy (TASK-2332.12).
 *
 * Owns every decision the `px rebase` command used to make inline: selected
 * mission root, base-branch ancestry postcondition, conflict classification and
 * auto-resolution, git-hook failure rebounce, agent-assisted resolution, review
 * push, and the next-step hints. All external effects go through
 * `RebaseWorkflowPort`; this module imports no adapter.
 */
import * as fmt from './presentation/cli-format.js';
import type {
  GitCommandResult,
  GitRunner,
  MissionConflictClassification,
  RebaseWorkflowPort,
} from './ports/rebase-workflow.js';

/**
 * Classify git hook failure from command output.
 * Detects pre-commit, pre-push, post-commit, and generic hook failures.
 */
export function classifyHookFailure(output: string): { isHookFailure: boolean; hookType: string | null } {
  if (!output) {
    return { isHookFailure: false, hookType: null };
  }
  const lower = output.toLowerCase();
  // Check specific hook types first (more specific match wins)
  if (/pre-commit/i.test(lower)) {
    return { isHookFailure: true, hookType: 'pre-commit' };
  }
  if (/pre-push/i.test(lower)) {
    return { isHookFailure: true, hookType: 'pre-push' };
  }
  if (/post-commit/i.test(lower)) {
    return { isHookFailure: true, hookType: 'post-commit' };
  }
  // Generic hook keyword match — require failure phrasing to avoid
  // false positives from paths like "post-integrate-hook.ts"
  if (/hook.*(failed|failure|error)/i.test(lower)) {
    return { isHookFailure: true, hookType: 'hook' };
  }
  return { isHookFailure: false, hookType: null };
}

/** Max retries for hook failure auto-bounce. */
export const MAX_HOOK_RETRY = 2;

/** Subset of the workflow port the hook rebounce policy depends on. */
export type HookRebouncePort = Pick<RebaseWorkflowPort,
  'startAgent' | 'readReviewState' | 'writeReviewState' | 'persistReviewState' | 'exit'
  | 'transitionTask' | 'applyAgentFallback' | 'selectAgent' | 'workflowLauncherStatus'
  | 'resolveTaskFile' | 'getTaskImplementer'>;

/**
 * Handle git hook failure with auto-bounce to implementer.
 * Returns true if auto-bounced (caller should retry), false if stranded.
 */
export async function handleHookFailureAutoBounce(
  slug: string,
  worktree: string,
  hookOutput: string,
  classification: { hookType: string | null },
  port: HookRebouncePort,
  { missionStore = null }: { missionStore?: unknown } = {},
): Promise<boolean> {
  // Read persisted retry count
  const persisted = await Promise.resolve(port.readReviewState(slug, worktree, missionStore)) as any;
  const retryCount = persisted && persisted.metadata && typeof persisted.metadata === 'object'
    ? (Number((persisted.metadata as any).hookFailureRetryCount) || 0)
    : 0;

  if (retryCount >= MAX_HOOK_RETRY) {
    fmt.log.fail(`Hook failure: max retries exceeded (${MAX_HOOK_RETRY}). Mission stranded for ${slug}.`);
    fmt.log.fail(`Hook ${classification.hookType || 'failure'} failed ${retryCount} times. Human intervention required.`);
    fmt.log.fail(`Hook output:\n${hookOutput}`);
    return false;
  }

  const newRetryCount = retryCount + 1;

  // Build fix prompt
  const fixPrompt = [
    `GIT HOOK FAILURE — FIX REQUIRED`,
    ``,
    `Mission: ${slug}`,
    `Hook type: ${classification.hookType || 'unknown'}`,
    ``,
    `Hook output (use this to diagnose and fix):`,
    `---`,
    hookOutput,
    `---`,
    ``,
    `Retry attempt: ${newRetryCount}/${MAX_HOOK_RETRY}`,
    ``,
    `Fix the underlying issue so the git hook passes.`,
    `After fixing, the rebase will be retried automatically.`,
  ].join('\n');

  // Update retry count in metadata
  const metadata: Record<string, unknown> = persisted && persisted.metadata && typeof persisted.metadata === 'object'
    ? { ...persisted.metadata }
    : {};
  metadata.hookFailureRetryCount = newRetryCount;

  try {
    if (persisted) {
      await port.persistReviewState(slug, { ...persisted, metadata }, worktree, missionStore);
    } else {
      await port.persistReviewState(slug, { metadata }, worktree, missionStore);
    }
  } catch (err: any) {
    fmt.log.fail(`Could not persist hook retry state: ${err.message || String(err)}. Falling back to manual recovery.`);
    return false;
  }

  // Resolve implementer
  const taskResolution = port.resolveTaskFile(slug, worktree) as any;
  let implementer = taskResolution.ok && taskResolution.task ? port.getTaskImplementer(taskResolution.task) : null;

  if (!implementer) {
    const status = port.workflowLauncherStatus?.() ?? { available: false, agent: null };
    if (status.available && status.agent) {
      implementer = port.selectAgent?.({ role: 'implementer' }) || status.agent;
    }
  }

  if (!implementer) {
    fmt.log.fail(`Could not determine implementer for ${slug}. Cannot auto-bounce.`);
    return false;
  }

  // Transition task back to active (implementer phase) without consuming reviewer cycle
  await port.transitionTask(slug, 'active', { rootDir: worktree, log: fmt.log.plain });
  fmt.log.info(`Auto-bouncing to implementer (${implementer}) with hook fix prompt. Retry ${newRetryCount}/${MAX_HOOK_RETRY}.`);

  // Launch implementer with the fix prompt
  try {
    const launchResult = await port.startAgent('act-on-review', {
      agent: implementer,
      prompt: fixPrompt,
      worktree,
      slug,
      role: 'implementer',
      exclude: [],
    });

    // Apply any agent fallback if needed
    await port.applyAgentFallback({
      role: 'implementer',
      original: implementer,
      launchResult,
      state: persisted || {},
      slug,
      worktree,
      taskResolution: { ok: taskResolution.ok, taskFile: taskResolution.taskFile },
      log: fmt.log.plain,
      writeReviewStateFn: port.writeReviewState,
      missionStore,
    });

    if (launchResult.result && launchResult.result.status !== 0) {
      fmt.log.fail(`Implementer (${launchResult.agent}) exited with status ${launchResult.result.status}. Mission stranded.`);
      return false;
    }
  } catch (err: any) {
    fmt.log.fail(`Could not launch implementer for hook fix: ${err.message || String(err)}. Falling back to hint.`);
    fmt.log.fail(`Hint: A git hook failed. Fix the issues reported above and try again.`);
    fmt.log.fail(`Recovery: ${fmt.command('git rebase --abort')}`);
    port.exit(1);
    return false;
  }

  return true;
}

/**
 * Parse conflict file paths from git status --porcelain output
 * when a rebase is in progress. Handles all unmerged states:
 * UU (unmerged), DU/UD (modify/delete), AU/UA (add/add), AA (add/add).
 */
export function parseConflictFilesFromGitStatus(worktreePath: string, gitFn: GitRunner): string[] {
  const statusResult = gitFn(['-C', worktreePath, 'status', '--porcelain']);
  const files: string[] = [];
  const unmergedStates = new Set(['UU', 'DU', 'UD', 'AU', 'UA', 'AA']);
  for (const line of (statusResult.stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {continue;}
    const match = trimmed.match(/^([A-Z]{2})\s+(.+)$/);
    if (match) {
      const code = match[1];
      if (!unmergedStates.has(code)) {continue;}
      let file = match[2].trim();
      // Remove surrounding quotes if present
      if ((file.startsWith('"') && file.endsWith('"')) || (file.startsWith("'") && file.endsWith("'"))) {
        file = file.slice(1, -1);
      }
      if (file) {files.push(file);}
    }
  }
  return [...new Set(files)];
}

/**
 * Parse conflict file paths from git rebase output.
 * Similar to parseConflictFilesFromMergeOutput but handles rebase-specific output.
 */
export function parseConflictFilesFromRebaseOutput(output: string): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for ( const line of output.split('\n')) {
    if (!/CONFLICT|KONFLIKT/i.test(line)) {continue;}
    // English: "Merge conflict in <file>"
    const inMatch = line.match(/Merge conflict in (.+)$/);
    if (inMatch) {
      let f = inMatch[1].trim();
      // Strip modify/delete description (e.g. ": deleted by master, modified by HEAD")
      f = f.replace(/\s*:\s*(deleted|modified|added|removed|renamed|both|ours|yours|theirs|by\s*\w+,\s*(modified|deleted)\b).*$/i, '').trim();
      if (f && !seen.has(f)) { seen.add(f); files.push(f); }
      continue;
    }
    // Swedish: "Sammanslagningskonflikt i <file>"
    const svMatch = line.match(/Sammanslagningskonflikt\s+i\s+(.+)$/);
    if (svMatch) {
      let f = svMatch[1].trim();
      // Strip modify/delete description (e.g. ": deleted/raderad av master, modified/ändrad av HEAD")
      f = f.replace(/\s*:\s*(deleted|modified|added|removed|renamed|both|ours|yours|theirs|raderad|ändrad|lagd till|borttagen|by|av|av\s*\w+,\s*(modified|ändrad|deleted|raderad)\b).*$/i, '').trim();
      if (f && !seen.has(f)) { seen.add(f); files.push(f); }
      continue;
    }
   // Swedish modify/delete: "KONFLIKT (ändra/radera): <file> raderad i <commit> ... och ändrad i HEAD"
     const svModDelMatch = line.match(/^KONFLIKT\s+\(ändra\/radera\)\s*:\s*(.+)$/i);
     if (svModDelMatch) {
       let f = svModDelMatch[1].trim();
       // Strip trailing "Versionen HEAD av <file> lämnad i trädet." sentence (real git output)
       // Must come before raderad/ändrad stripping since the trailing sentence contains "ändrad"
       f = f.replace(/\s+Versionen\s+HEAD[\s\S]*$/i, '').trim();
       // Strip "raderad i <commit> ... och ändrad i HEAD" (Swedish modify/delete description)
       f = f.replace(/\s+raderad\s+i\s+\S+(?:\s*\([^)]*\))?\s+(?:och|and)\s+ändrad\s+i\s+\S+\.?\s*$/i, '').trim();
       // Also handle "raderad i <commit> och ändrad i HEAD" without trailing period
       f = f.replace(/\s+raderad\s+i\s+\S+(?:\s*\([^)]*\))?\s+och\s+ändrad\s+i\s+\S+\s*$/i, '').trim();
       if (f && !seen.has(f)) { seen.add(f); files.push(f); }
       continue;
     }

    // Generic: try to extract a file path from the line using colon-delimited segments.
    // Common patterns:
    //   "CONFLICT (content): Merge conflict in <file>"  -> handled above
    //   "<file>: <description>"                          -> generic fallback
    //   "CONFLICT (content): <file>: <description>"      -> nested colons
    //   "CONFLICT (modify/delete): <file>: deleted by ..., modified by ..." -> modify/delete
    //   "CONFLICT (modify/delete): <file>: ..."          -> modify/delete header
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const beforeColon = line.slice(0, colonIdx).trim();
      const afterColon = line.slice(colonIdx + 1).trim();
      const isNonPathPrefix = /^(CONFLICT|KONFLIKT|CONFLICTS|Merge conflict|Sammanslagningskonflikt|Automatic merge|Auto-merging|resolved|merged|deleted|added|changed|modified|rejected|skipped|dropped|superseded|discarded|kept|stashed|applied|already|would|both|ours|yours|their|his|her|its|your|my|us|we|they|he|she|it|a|an|the|but|and|or|for|nor|not|so|yet)\b/i.test(beforeColon);
      if (!isNonPathPrefix) {
        // Skip known advice/hint labels — the rest of the line is not a path.
        if (/^(tips|hint|note)\b/i.test(beforeColon)) {continue;}
        const f = beforeColon;
        if (f && !seen.has(f)) { seen.add(f); files.push(f); }
      } else if (afterColon) {
        // Skip the prefix and look for a path after the first colon.
        // If there's a second colon, take the segment before it as the path.
        const secondColonIdx = afterColon.indexOf(':');
        if (secondColonIdx !== -1) {
          let f = afterColon.slice(0, secondColonIdx).trim();
          // Strip modify/delete description (e.g. ": deleted by master, modified by HEAD")
          f = f.replace(/\s*:\s*(deleted|modified|added|removed|renamed|both|ours|yours|theirs|raderad|ändrad|lagd till|borttagen|by|av|av\s*\w+,\s*(modified|ändrad|deleted|raderad)\b).*$/i, '');
          f = f.trim();
          if (f && !seen.has(f)) { seen.add(f); files.push(f); }
        } else {
          // No second colon — take everything after the first colon as the path.
          const f = afterColon;
          if (f && !seen.has(f)) { seen.add(f); files.push(f); }
        }
      }
    }
  }
  return files;
}

export interface RebasePromptRequest {
  slug: string;
  area: string;
  worktreePath: string;
  missionSpecificFiles: string[];
  sharedFiles: string[];
  /** Base branch the mission rebases onto; must not throw. */
  resolveBaseBranch: (_slug: string, _worktreePath: string) => string;
  formatVerificationCommand: (_area: string, _worktreePath: string) => string;
}

/** Build the prompt for the agent during shared-file conflict resolution. */
export function buildRebasePrompt({
  slug, area, worktreePath, missionSpecificFiles, sharedFiles, resolveBaseBranch, formatVerificationCommand,
}: RebasePromptRequest): string {
  const missionFileCommands = missionSpecificFiles
    .map(f => `  git checkout --theirs "${f}" && git add "${f}"`)
    .join('\n');
  const sharedFileList = sharedFiles.map(f => `  - ${f}`).join('\n');
  const primaryBranch = resolveBaseBranch(slug, worktreePath);

  return [
    'Mode: rebase conflict-resolution.',
    '',
    `Mission: ${slug}`,
    `Mission worktree: ${worktreePath}`,
    '',
    `Rebase onto ${primaryBranch} paused on conflicts.`,
    '',
    'Step 1 — Resolve mission-specific conflicts (--theirs):',
    missionFileCommands.length > 0
      ? missionFileCommands
      : '  (none — all conflicts are shared files)',
    '',
    'Step 2 — Resolve shared-file conflicts:',
    sharedFileList,
    '',
    'Step 3 — After resolving each shared file:',
    '  git add <resolved-files>',
    '  git rebase --continue',
    '',
    'Step 4 — Repeat Steps 1-3 until rebase completes.',
    '',
    'Step 5 — Verify:',
    `  ${formatVerificationCommand(area, worktreePath)}`,
    `  px integrate ${slug} --dry-run`,
    '',
    'Rules:',
    '- Take --theirs for every mission-specific file listed above.',
    '- For shared files, inspect the conflict markers and resolve sensibly.',
    '- If rebase pauses again, repeat the process.',
    '- If any command fails, stop and report the failure.',
  ].join('\n');
}

/**
 * Rebase a mission branch onto its local base branch, auto-resolving
 * mission-specific conflicts and launching an agent for shared-file conflicts.
 *
 * Usage: px rebase [<slug>] [--push]
 */
export async function runRebaseWorkflow(args: string[], port: RebaseWorkflowPort): Promise<void> {
  const gitFn: GitRunner = port.git;
  const bounceHookFailure = port.handleHookFailureAutoBounce
    ?? ((slug: string, worktree: string, output: string, classification: { hookType: string | null }, options: { missionStore?: unknown }) =>
      handleHookFailureAutoBounce(slug, worktree, output, classification, port, options));

  const flags = args.filter(a => a.startsWith('--'));
  const params = args.filter(a => !a.startsWith('--'));
  const isPush = flags.includes('--push');
  const explicitSlug = params[0];
  const slug = port.inferSlug(explicitSlug);
  if (!slug) {
    fmt.log.fail('Usage: px rebase [<slug>] [--push]');
    port.exit(1);
    return;
  }

  // Select the mission root exactly once at the command boundary. All later
  // lifecycle, Git, proof, and publication calls use this value explicitly.
  const launchRoot = port.cwd();
  const executionRoot = port.resolveWorktree(slug, { cwd: launchRoot }) || launchRoot;
  const missionDir = port.findMissionDir(slug, executionRoot);
  const area = missionDir ? port.findMissionArea(missionDir) : 'docs';
  const branch = port.missionBranchName(slug, executionRoot);

  const existingRebase = port.detectRebaseState(executionRoot);
  if (existingRebase.inProgress) {
    fmt.log.fail(`Rebase already in progress for ${fmt.branch(branch)}.`);
    if (existingRebase.rebaseHead) {
      fmt.log.info(`Current rebase head: ${existingRebase.rebaseHead}`);
    }
    if (existingRebase.unmergedFiles.length > 0) {
      fmt.log.info('Unmerged files:');
      existingRebase.unmergedFiles.forEach((file: string) => fmt.log.info(`  - ${file}`));
    }
    fmt.log.info('Recovery commands:');
    fmt.log.info(`  ${fmt.command('git rebase --continue')}`);
    fmt.log.info(`  ${fmt.command('git rebase --abort')}`);
    fmt.log.info(`  ${fmt.command('git rebase --skip')}`);
    port.exit(1);
    return;
  }

  const performPush = async () => {
    if (!isPush) {return;}
    if (!port.isForgejoReviewEnabled(executionRoot)) {
      fmt.log.info(`Skipping Forgejo push (review provider is not forgejo).`);
      return;
    }
    fmt.log.info(`--push detected. Updating Forgejo PR for ${fmt.branch(branch)}...`);

    const reviewIdentity = port.resolveReviewIdentity(slug, executionRoot);
    let forgejoUser: string | null | undefined = reviewIdentity.forgejoUser;
    if (!forgejoUser) {
      const taskResolution = port.resolveTaskFile(slug, executionRoot);
      if (taskResolution.ok) {
        forgejoUser = port.getTaskImplementer(taskResolution.taskFile);
      }
    }
    forgejoUser = port.resolveForgejoUser(forgejoUser ?? null);

    const token = port.readToken(forgejoUser || 'default');
    if (!token) {
      fmt.log.fail(`No Forgejo token found for user "${fmt.agent(forgejoUser || 'default')}". Push failed.`);
      port.exit(1);
      return;
    }
    const result = port.createPr(branch, forgejoUser || 'default', token, { rootDir: executionRoot, forceWithLease: true });
    if (!result.ok) {
      fmt.log.fail(`Push to Forgejo failed: ${result.error}`);
      port.exit(1);
      return;
    }
    fmt.log.pass(`Branch pushed and PR updated for ${fmt.branch(branch)}.`);
  };

  // Verify we are on the correct branch
  const currentBranch = port.getCurrentBranch(executionRoot);
  if (currentBranch !== branch) {
    fmt.log.fail(`Expected branch ${fmt.branch(branch)}, found ${fmt.branch(currentBranch)}`);
    fmt.log.info(`Switch to the mission branch first: ${fmt.command(`git checkout ${branch}`)}`);
    port.exit(1);
    return;
  }

  // Honor the mission's recorded base branch (a feature-branch mission rebases
  // onto its base, e.g. skunkworks — not the primary branch). Falls back to the
  // primary branch for every mission without a recorded Base-Branch.
  const baseBranch = port.resolveMissionBaseBranch(slug, executionRoot, { gitFn });
  fmt.log.info(`Rebasing ${fmt.branch(branch)} onto local ${fmt.branch(baseBranch)}...`);

  // Postcondition shared by every success path: the resolved *local* base must
  // be an ancestor of the mission HEAD. Reporting a successful rebase without
  // this guarantee is a silent false success (architecture migration). Returns false after
  // emitting diagnostics and calling exit(1); callers must return at once.
  const verifyBaseAncestry = () => {
    const ancestry = gitFn(['-C', executionRoot, 'merge-base', '--is-ancestor', baseBranch, 'HEAD']);
    if (ancestry.status === 0) {return true;}
    const headSha = (gitFn(['-C', executionRoot, 'rev-parse', 'HEAD']).stdout || '').trim() || '(unknown)';
    fmt.log.fail('Rebase postcondition failed: the local base branch is not an ancestor of the mission HEAD.');
    fmt.log.fail(`Resolved local base branch: ${baseBranch}`);
    fmt.log.fail(`Mission HEAD: ${headSha}`);
    fmt.log.fail('This is local-base ancestry, not origin/mission/* tracking divergence.');
    fmt.log.fail(`Recovery: ${fmt.command('git rebase --abort')}`);
    port.exit(1);
    return false;
  };

  const rebaseResult = gitFn(['-C', executionRoot, '-c', 'core.editor=true', '-c', 'merge.autoedit=no', 'rebase', baseBranch]);

  // Rebase succeeded (status 0) or was already up to date
  // Also handle "Already up to date" variants
  if (rebaseResult.status === 0 || /up to date|Already up to date/i.test(rebaseResult.stdout + rebaseResult.stderr)) {
    const rebaseStatus = gitFn(['-C', executionRoot, 'rebase', '--show-current']);
    // If no rebase is in progress, we're done
    const rebaseInProg = rebaseStatus.stdout.trim().length > 0;
    if (rebaseInProg) {
      // rebase --show-current returned something but status was 0 — treat as incomplete
      fmt.log.pass('Rebase round completed.');
      fmt.log.warn('Rebase is still in progress (non-empty --show-current). Skipping automatic push.');
      fmt.log.info(`Next: ${fmt.command(port.formatVerificationCommand(area, executionRoot))}`);
      fmt.log.info(`Next: ${fmt.command('git rebase --continue')}`);
      port.exit(0);
      return;
    }

    if (!verifyBaseAncestry()) {return;}

    fmt.log.pass('Rebase completed cleanly.');
    await performPush();
    fmt.log.info(`Next: ${fmt.command(port.formatVerificationCommand(area, executionRoot))}`);
    fmt.log.info(`Next: ${fmt.command(`px integrate ${slug} --dry-run`)}`);
    port.exit(0);
    return;
  }

  // Rebase paused on conflicts — classify and resolve
  const rebaseOutput = [rebaseResult.stdout, rebaseResult.stderr].filter(Boolean).join('\n').trim();

  // Check if this is actually a conflict (contains CONFLICT lines) or another error
  // Also handle localized output (e.g. Swedish "KONFLIKT")
  const isConflict = /CONFLICT|KONFLIKT/i.test(rebaseOutput);
  if (!isConflict) {
    fmt.log.fail('Rebase failed with a non-conflict error.');
    if (rebaseOutput) {
      fmt.log.fail('--- Git Output ---');
      fmt.log.fail(rebaseOutput);
      fmt.log.fail('------------------');
    }
    if (rebaseResult.status === 128) {
      fmt.log.fail('Hint: This might be a repository lock or an invalid upstream branch.');
      fmt.log.fail(`Recovery: ${fmt.command('git rebase --abort')}`);
      port.exit(1);
      return;
    }

    // Classify hook failure and auto-bounce to implementer
    const hookClassification = classifyHookFailure(rebaseOutput);
    if (hookClassification.isHookFailure && typeof port.missionServices === 'function') {
      const rebaseMissionStore = (await port.missionServices(executionRoot)).store;
      const shouldRetry = await bounceHookFailure(slug, executionRoot, rebaseOutput, hookClassification, {
        missionStore: rebaseMissionStore,
      });
      if (shouldRetry) {
        fmt.log.info('Retrying rebase after implementer fix...');
        // A failed hook leaves the rebase in progress. Keep continuing it until
        // the shared persisted retry budget is exhausted, rather than treating a
        // second hook failure as an unrelated manual-recovery error.
        let retryResult = gitFn(['-C', executionRoot, '-c', 'core.editor=true', '-c', 'merge.autoedit=no', 'rebase', '--continue']);
        while (retryResult.status !== 0) {
          const retryOutput = [retryResult.stdout, retryResult.stderr].filter(Boolean).join('\n').trim();
          const retryClassification = classifyHookFailure(retryOutput);
          if (!retryClassification.isHookFailure) {break;}
          const retryAgain = await bounceHookFailure(slug, executionRoot, retryOutput, retryClassification, {
            missionStore: rebaseMissionStore,
          });
          if (!retryAgain) {break;}
          fmt.log.info('Retrying rebase after implementer hook fix...');
          gitFn(['-C', executionRoot, 'add', '-A']);
          retryResult = gitFn(['-C', executionRoot, '-c', 'core.editor=true', '-c', 'merge.autoedit=no', 'rebase', '--continue']);
        }
        if (retryResult.status === 0 || /up to date|Already up to date/i.test(retryResult.stdout + retryResult.stderr)) {
          if (!verifyBaseAncestry()) { return; }
          fmt.log.pass('Rebase completed after hook fix.');
          await performPush();
          fmt.log.info(`Next: ${fmt.command(port.formatVerificationCommand(area, executionRoot))}`);
          fmt.log.info(`Next: ${fmt.command(`px integrate ${slug} --dry-run`)}`);
          port.exit(0);
          return;
        }
        fmt.log.fail('Rebase still failed after implementer hook fix. Manual intervention required.');
      }
    } else if (hookClassification.isHookFailure) {
      // Keep the established diagnostic for direct callers that have not
      // composed the mission persistence services required for rebounce.
      fmt.log.fail('Hint: A git hook failed. Fix the issues reported above.');
    }

    fmt.log.fail(`Recovery: ${fmt.command('git rebase --abort')}`);
    port.exit(1);
    return;
  }

  fmt.log.warn('Rebase paused on conflicts. Classifying...');

  // Resolve the worktree for conflict classification
  const worktreePath = executionRoot;

  const conflictOpts: {worktreePathOverride?: string} = { worktreePathOverride: worktreePath };
  const conflictResult = port.resolveConflictsForMission(slug, area, conflictOpts) as MissionConflictClassification;

  // When rebase is in progress in the worktree, dry merge may fail.
  // Fall back to parsing the rebase output directly.
  if (conflictResult.ok === false && conflictResult.error === 'merge-failed') {
    fmt.log.info('Dry merge failed (rebase in progress). Parsing rebase output directly...');
    // Prefer git status --porcelain (authoritative index entries) over localized
    // rebase text, which can contain advice prefixes that parse as false paths.
    const statusFiles = parseConflictFilesFromGitStatus(worktreePath, gitFn);
    const conflictFiles = statusFiles.length > 0
      ? statusFiles
      : parseConflictFilesFromRebaseOutput(rebaseOutput);

    // Classify using mission-specific patterns
    const missionDocPrefix = port.missionConflictPathPrefix(slug, worktreePath);
    const taskPattern = new RegExp(`backlog/(?:tasks|completed)/[^/]*${slug}`);
    const missionSpecificFiles = conflictFiles.filter((f: string) =>
      f.startsWith(missionDocPrefix) || taskPattern.test(f)
    );
    const sharedFiles = conflictFiles.filter((f: string) => !missionSpecificFiles.includes(f));

    Object.assign(conflictResult, {
      ok: true,
      conflictFiles,
      missionSpecificFiles,
      sharedFiles,
    });
  } else if (!conflictResult.ok) {
    if (conflictResult.error === 'worktree-missing') {
      fmt.log.fail(`Mission worktree not found: ${fmt.path(worktreePath)}`);
      fmt.log.info(`Ensure the worktree is registered: ${fmt.command(`git worktree add ${port.conventionalWorktreePath(slug, executionRoot)} ${branch}`)}`);
      port.exit(1);
      return;
    }
    fmt.log.fail('Conflict detection failed.');
    fmt.log.info(`Check rebase state: ${fmt.command('git status')}`);
    port.exit(1);
    return;
  }

  // No conflicts detected by classification but rebase reported CONFLICT —
  // fall through to shared-file handling with whatever git reports
  const conflictFiles = conflictResult.conflictFiles.length > 0
    ? conflictResult.conflictFiles
    : parseConflictFilesFromRebaseOutput(rebaseOutput);

  // Only treat unclassified conflict files as shared-file conflicts
  if (conflictResult.sharedFiles.length === 0 && conflictFiles.length > 0) {
    const classified = new Set([...conflictResult.missionSpecificFiles]);
    const unclassified = conflictFiles.filter((f: string) => !classified.has(f));
    if (unclassified.length > 0) {
      conflictResult.sharedFiles = unclassified;
    }
  }

  // All conflicts are mission-specific — auto-resolve with --theirs
  if (conflictResult.sharedFiles.length === 0) {
    fmt.log.info(`All ${conflictResult.missionSpecificFiles.length} conflict(s) are mission-specific. Auto-resolving...`);
    const maxContinueAttempts = 3;
    let continueAttempts = 0;
    const continueRebase = (opts: {stdio?: string} = {}) => {
      continueAttempts += 1;
      return gitFn(['-C', executionRoot, '-c', 'core.editor=true', '-c', 'merge.autoedit=no', 'rebase', '--continue'], opts);
    };
    const reportContinueFailure = (result: GitCommandResult) => {
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      fmt.log.fail(`git rebase --continue failed (status ${result.status}).`);
      if (output) {
        fmt.log.fail('--- Git Output ---');
        fmt.log.fail(output);
        fmt.log.fail('------------------');
      }
      if (output.toLowerCase().includes('pre-commit') || output.toLowerCase().includes('hook')) {
        fmt.log.fail('Hint: A git hook failed. Fix the issues reported above.');
      }
      fmt.log.fail(`Check rebase state: ${fmt.command('git status')}`);
      fmt.log.fail(`Recovery: ${fmt.command('git rebase --abort')}`);
    };

    const failContinueBudget = (branchName: string) => {
      fmt.log.fail(`Rebase still in progress on branch ${fmt.branch(branchName || slug)} after ${continueAttempts} failed --continue attempt(s).`);
      fmt.log.fail(`Check rebase state: ${fmt.command('git status')}`);
      fmt.log.fail(`Next: ${fmt.command('git rebase --continue')}`);
      fmt.log.fail(`If the current commit is empty: ${fmt.command('git rebase --skip')}`);
      fmt.log.fail(`If recovery is needed: ${fmt.command('git rebase --abort')}`);
      port.exit(1);
    };

    for (const file of conflictResult.missionSpecificFiles) {
      fmt.log.info(`Resolving: ${fmt.path(file)}`);
      const checkoutResult = gitFn(['-C', executionRoot, 'checkout', '--theirs', file]);
      if (checkoutResult.status !== 0) {
        // Try add -u as fallback (file may have been added/deleted)
        gitFn(['-C', executionRoot, 'add', file]);
      }
      const addResult = gitFn(['-C', executionRoot, 'add', file]);
      if (addResult.status !== 0) {
        fmt.log.warn(`Could not add ${fmt.path(file)} for rebase continue.`);
      }
    }

    fmt.log.info('Continuing rebase...');
    let rebaseCompleted = false;
    let continueResult = continueRebase();
    const recoverHookFailureFromContinue = async (result: GitCommandResult) => {
      let recovered = result;
      while (recovered.status !== 0) {
        const output = [recovered.stdout, recovered.stderr].filter(Boolean).join('\n').trim();
        const classification = classifyHookFailure(output);
        if (!classification.isHookFailure) {break;}
        // Direct callers without composed mission services retain the legacy
        // hint-and-exit path; the production CLI always supplies this seam.
        if (typeof port.missionServices !== 'function') {break;}
        const continueStore = (await port.missionServices(executionRoot)).store;
        const shouldRetry = await bounceHookFailure(slug, executionRoot, output, classification, {
          missionStore: continueStore,
        });
        if (!shouldRetry) {return { result: recovered, stranded: true };}
        fmt.log.info('Retrying rebase --continue after implementer hook fix...');
        gitFn(['-C', executionRoot, 'add', '-A']);
        recovered = continueRebase();
      }
      return { result: recovered, stranded: false };
    };
    const initialHookRecovery = await recoverHookFailureFromContinue(continueResult);
    if (initialHookRecovery.stranded) {return;}
    continueResult = initialHookRecovery.result;
    if (continueResult.status !== 0) {
      // Might have pre-commit hook or editor — check for more conflicts
      const moreOutput = [continueResult.stdout, continueResult.stderr].filter(Boolean).join('\n').trim();

      if (/CONFLICT|KONFLIKT/i.test(moreOutput)) {
        fmt.log.info('More conflicts found. Re-running classification...');
        // Recurse once more for chained conflicts, preserving flags and ports
        await runRebaseWorkflow(args, port);
        return;
      }
      // Could be editor opening — check if rebase is still in progress
      const statusResult = gitFn(['-C', executionRoot, 'status', '--porcelain']);
      if (statusResult.stdout.trim()) {
        fmt.log.info('More changes detected. Continuing rebase...');
        gitFn(['-C', executionRoot, 'add', '-A']);
        if (continueAttempts >= maxContinueAttempts) {
          const rebaseCheck = gitFn(['-C', executionRoot, 'rebase', '--show-current']);
          failContinueBudget(rebaseCheck.stdout.trim());
          return;
        }
        let cont2 = continueRebase();
        if (cont2.status !== 0) {
          const hookRecovery = await recoverHookFailureFromContinue(cont2);
          if (hookRecovery.stranded) {return;}
          cont2 = hookRecovery.result;
        }
        if (cont2.status !== 0) {
          // Verify whether a rebase is still in progress
          const rebaseCheck = gitFn(['-C', executionRoot, 'rebase', '--show-current']);
          if (rebaseCheck.stdout.trim().length > 0) {
            if (continueAttempts >= maxContinueAttempts) {
              failContinueBudget(rebaseCheck.stdout.trim());
            } else {
              reportContinueFailure(cont2);
              port.exit(1);
            }
            return;
          }
          reportContinueFailure(cont2);
          port.exit(1);
          return;
        }
        rebaseCompleted = true;
      } else {
        // No staged changes and --continue failed but no conflict — rebase may have completed
        const rebaseCheck = gitFn(['-C', executionRoot, 'rebase', '--show-current']);
        if (rebaseCheck.stdout.trim().length === 0) {
          rebaseCompleted = true;
        } else {
          // Rebase still in progress with no unresolved conflicts: likely a hook
          // failure or empty pick. Retry --continue with GIT_EDITOR=true to avoid
          // spawning an interactive editor.
          fmt.log.info('No unresolved conflicts; rebase still in progress. Retrying --continue (hook/empty-pick)...');
          if (continueAttempts >= maxContinueAttempts) {
            failContinueBudget(slug);
            return;
          }
          let retryResult = continueRebase();
          if (retryResult.status !== 0) {
            const hookRecovery = await recoverHookFailureFromContinue(retryResult);
            if (hookRecovery.stranded) {return;}
            retryResult = hookRecovery.result;
          }
          if (retryResult.status !== 0) {
            const retryOutput = [retryResult.stdout, retryResult.stderr].filter(Boolean).join('\n').trim();
            if (/CONFLICT|KONFLIKT/i.test(retryOutput)) {
              fmt.log.info('More conflicts found after retry. Re-running classification...');
              await runRebaseWorkflow(args, port);
              return;
            }
            // Another empty-pick or hook — verify again
            const recheck = gitFn(['-C', executionRoot, 'rebase', '--show-current']);
            if (recheck.stdout.trim().length > 0) {
              fmt.log.info('Empty pick detected; continuing to next commit...');
              if (continueAttempts >= maxContinueAttempts) {
                failContinueBudget(recheck.stdout.trim());
                return;
              }
              let cont3 = continueRebase();
              if (cont3.status === 0) {
                rebaseCompleted = true;
              } else {
                const hookRecovery = await recoverHookFailureFromContinue(cont3);
                if (hookRecovery.stranded) {return;}
                cont3 = hookRecovery.result;
                if (cont3.status === 0) {
                  rebaseCompleted = true;
                } else {
                  const recheck2 = gitFn(['-C', executionRoot, 'rebase', '--show-current']);
                  if (recheck2.stdout.trim().length === 0) {
                    rebaseCompleted = true;
                  } else {
                    if (continueAttempts >= maxContinueAttempts) {
                      failContinueBudget(recheck2.stdout.trim());
                    } else {
                      reportContinueFailure(cont3);
                      port.exit(1);
                    }
                    return;
                  }
                }
              }
            } else {
              rebaseCompleted = true;
            }
          } else {
            rebaseCompleted = true;
          }
        }
      }
    } else {
      rebaseCompleted = true;
    }

    if (rebaseCompleted) {
      if (!verifyBaseAncestry()) {return;}
      fmt.log.pass('Mission-specific conflicts resolved. Rebase completed.');
      await performPush();
      fmt.log.info(`Next: ${fmt.command(port.formatVerificationCommand(area, executionRoot))}`);
      fmt.log.info(`Next: ${fmt.command(`px integrate ${slug} --dry-run`)}`);
      port.exit(0);
      return;
    }
  }

  // Shared-file conflicts exist — launch agent to resolve them
  fmt.log.info(`${conflictResult.sharedFiles.length} shared file(s) require agent-assisted resolution:`);
  conflictResult.sharedFiles.forEach((f: string) => fmt.log.info(`  - ${fmt.path(f)}`));

  const prompt = buildRebasePrompt({
    slug,
    area,
    worktreePath,
    missionSpecificFiles: conflictResult.missionSpecificFiles,
    sharedFiles: conflictResult.sharedFiles,
    resolveBaseBranch: (promptSlug, promptRoot) => port.resolvePromptBaseBranch(promptSlug, promptRoot, gitFn),
    formatVerificationCommand: (promptArea, promptRoot) => port.formatVerificationCommand(promptArea, promptRoot),
  });

  fmt.log.info('Launching agent for conflict resolution...');
  const { agent, result: agentResult } = await port.startAgent('conflict-resolution', {
    prompt,
    worktree: worktreePath,
  });

  if (agentResult.status !== 0) {
    fmt.log.fail(`Agent (${fmt.agent(agent)}) exited with status ${agentResult.status}.`);
    fmt.log.info(`You may need to abort the rebase: ${fmt.command('git rebase --abort')}`);
    port.exit(agentResult.status || 1);
    return;
  }

  // Verify rebase is actually complete before pushing
  const finalRebaseCheck = gitFn(['-C', executionRoot, 'rebase', '--show-current']);
  if (finalRebaseCheck.stdout.trim().length > 0) {
    fmt.log.pass(`Agent (${fmt.agent(agent)}) completed their round.`);
    fmt.log.warn('Rebase is still in progress. Skipping automatic push.');
    fmt.log.info('Next: Resolve remaining conflicts or continue rebase.');
    port.exit(0);
    return;
  }

  if (!verifyBaseAncestry()) {return;}

  fmt.log.pass(`Agent (${fmt.agent(agent)}) completed conflict resolution.`);
  await performPush();
  fmt.log.info(`Next: ${fmt.command(port.formatVerificationCommand(area, executionRoot))}`);
  fmt.log.info(`Next: ${fmt.command(`px integrate ${slug} --dry-run`)}`);
  port.exit(0);
}
