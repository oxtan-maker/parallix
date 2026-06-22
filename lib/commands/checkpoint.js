const { git, run, getCurrentBranch } = require('../core/git');
const { findMissionDir, findMissionArea, inferSlug } = require('../core/mission-utils');
const path = require('path');
const fmt = require('../core/fmt');
const { formatVerificationCommand, runVerificationGate } = require('../core/verification');

function checkpoint(args) {
  const flags = args.filter(a => a.startsWith('--'));
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
    fmt.log.fail('Usage: node parallix checkpoint [<slug>] <cp-name> "<next-action>" [--no-gate]');
    process.exit(1);
  }

  const missionDir = findMissionDir(slug);
  if (!missionDir) {
    fmt.log.fail(`Mission directory not found for slug: ${fmt.slug(slug)}`);
    process.exit(1);
  }

  const area = findMissionArea(missionDir);
  const skipGate = flags.includes('--no-gate');

  fmt.log.info(`Running checkpoint for mission: ${fmt.slug(slug)}, checkpoint: ${fmt.bold(cpName)}`);

  // Step 1: Verify
  if (skipGate) {
    fmt.log.warn('Step 1: Skipping verification gate (--no-gate)');
  } else {
    fmt.log.info(`Step 1: Running verification gate for area: ${fmt.bold(area)}...`);
    const verifyResult = runVerificationGate(area, { rootDir: process.cwd(), stdio: 'inherit', runFn: run });
    if (verifyResult.status !== 0) {
      fmt.log.fail(`Verification gate failed for area: ${fmt.bold(area)}. Fix errors and retry ${fmt.command(formatVerificationCommand(area))} or use --no-gate.`);
      process.exit(1);
    }
    fmt.log.pass(`Verification gate passed for area: ${fmt.bold(area)}`);
  }

  // Step 2: Stage
  fmt.log.info('Step 2: Staging all tracked changes...');
  git(['add', '-A']);

  // Step 3: Commit
  fmt.log.info('Step 3: Committing checkpoint...');
  const commitMsg = `checkpoint(${slug}): ${cpName}`;
  const commitBody = `Next action: ${nextAction}`;
  const commitResult = git(['commit', '-m', commitMsg, '-m', commitBody]);
  if (commitResult.status !== 0) {
    fmt.log.fail('Commit failed.');
    process.exit(1);
  }

  // Step 4: Push
  const branch = getCurrentBranch();
  fmt.log.info(`Step 4: Pushing to origin/${fmt.branch(branch)}...`);
  const pushResult = git(['push', 'origin', branch]);
  if (pushResult.status !== 0) {
    fmt.log.fail('Push failed.');
    process.exit(1);
  }

  fmt.log.pass('Checkpoint complete and pushed.');
}

module.exports = checkpoint;
