// @ts-nocheck
import { findIgnoredSourceFiles, git, run } from '../../git/git.js';
import { findMissionDir, findMissionArea, inferSlug, resolveWorktree } from '../../filesystem/mission-utils.js';
import * as fmt from '../../../application/presentation/cli-format.js';
import { formatVerificationCommand, runVerificationGate } from '../../verification/verification.js';

/** @param {string[]} args */
function checkpoint(args) {
  /** @param {string} a */
  const params = args.filter(a => !a.startsWith('--'));

  let [explicitSlug, cpName, nextAction] = params;

  // Shift if slug is inferred
  let slug = inferSlug(explicitSlug);
  if (slug && explicitSlug !== slug) {
    // Slug was inferred, so explicitSlug is actually cpName
    nextAction = cpName;
    cpName = explicitSlug;
  }

  if (!slug || !cpName || !nextAction) {
    fmt.log.fail('Usage: node parallix checkpoint [<slug>] <cp-name> "<next-action>"');
    process.exit(1);
  }

  // Capture the launch directory once, while selecting the target. Every
  // operation below receives the selected worktree explicitly; a later child
  // process must never rediscover an ambient or primary checkout.
  const launchRoot = process.cwd();
  const rootDir = resolveWorktree(slug, { cwd: launchRoot }) || launchRoot;
  const missionDir = findMissionDir(slug, rootDir);
  if (!missionDir) {
    fmt.log.fail(`Mission directory not found for slug: ${fmt.slug(slug)}`);
    process.exit(1);
  }

  const area = findMissionArea(missionDir);
  fmt.log.info(`Running checkpoint for mission: ${fmt.slug(slug)}, checkpoint: ${fmt.bold(cpName)}`);

  // Step 1: Verify
  fmt.log.info(`Step 1: Running verification gate for area: ${fmt.bold(area)}...`);
  const verifyResult = runVerificationGate(area, { rootDir, stdio: 'inherit', runFn: run });
  if (verifyResult.status !== 0) {
    fmt.log.fail(`Verification gate failed for area: ${fmt.bold(area)}. Fix errors and retry ${fmt.command(formatVerificationCommand(area, rootDir))}.`);
    process.exit(1);
  }
  fmt.log.pass(`Verification gate passed for area: ${fmt.bold(area)}`);

  // Step 2: Stage
  fmt.log.info('Step 2: Staging all tracked changes...');
  git(['-C', rootDir, 'add', '-A']);

  const ignoredSourceFiles = findIgnoredSourceFiles(rootDir);
  if (ignoredSourceFiles.length > 0) {
    fmt.log.fail(
      `Checkpoint refused: source files are ignored and would be absent from the commit: ${ignoredSourceFiles.join(', ')}. `
      + 'Fix .gitignore or add the intended files explicitly, then retry.'
    );
    process.exit(1);
  }

  // Step 3: Commit
  fmt.log.info('Step 3: Committing checkpoint...');
  const commitMsg = `checkpoint(${slug}): ${cpName}`;
  const commitBody = `Next action: ${nextAction}`;
  const commitResult = git(['-C', rootDir, 'commit', '-m', commitMsg, '-m', commitBody]);
  if (commitResult.status !== 0) {
    fmt.log.fail('Commit failed.');
    process.exit(1);
  }

  fmt.log.pass('Checkpoint complete (local-only — branch not pushed to origin).');
}

export default checkpoint;

// CJS compat: ensure require() returns the function directly
declare const module: { exports: any } | undefined;
if (typeof module !== 'undefined') {
  module.exports = checkpoint;
  module.exports.default = checkpoint;
}
