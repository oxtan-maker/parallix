"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const git_js_1 = require("../core/git.js");
const mission_utils_js_1 = require("../core/mission-utils.js");
const fmt = __importStar(require("../core/fmt.js"));
const verification_js_1 = require("../core/verification.js");
/** @param {string[]} args */
function checkpoint(args) {
    /** @param {string} a */
    const flags = args.filter(a => a.startsWith('--'));
    /** @param {string} a */
    const params = args.filter(a => !a.startsWith('--'));
    let [explicitSlug, cpName, nextAction] = params;
    // Shift if slug is inferred
    let slug = (0, mission_utils_js_1.inferSlug)(explicitSlug);
    if (slug && explicitSlug !== slug) {
        // Slug was inferred, so explicitSlug is actually cpName
        nextAction = cpName;
        cpName = explicitSlug;
    }
    if (!slug || !cpName || !nextAction) {
        fmt.log.fail('Usage: node parallix checkpoint [<slug>] <cp-name> "<next-action>" [--no-gate]');
        process.exit(1);
    }
    const missionDir = (0, mission_utils_js_1.findMissionDir)(slug);
    if (!missionDir) {
        fmt.log.fail(`Mission directory not found for slug: ${fmt.slug(slug)}`);
        process.exit(1);
    }
    const area = (0, mission_utils_js_1.findMissionArea)(missionDir);
    const skipGate = flags.includes('--no-gate');
    fmt.log.info(`Running checkpoint for mission: ${fmt.slug(slug)}, checkpoint: ${fmt.bold(cpName)}`);
    // Step 1: Verify
    if (skipGate) {
        fmt.log.warn('Step 1: Skipping verification gate (--no-gate)');
    }
    else {
        fmt.log.info(`Step 1: Running verification gate for area: ${fmt.bold(area)}...`);
        const verifyResult = (0, verification_js_1.runVerificationGate)(area, { rootDir: process.cwd(), stdio: 'inherit', runFn: git_js_1.run });
        if (verifyResult.status !== 0) {
            fmt.log.fail(`Verification gate failed for area: ${fmt.bold(area)}. Fix errors and retry ${fmt.command((0, verification_js_1.formatVerificationCommand)(area))} or use --no-gate.`);
            process.exit(1);
        }
        fmt.log.pass(`Verification gate passed for area: ${fmt.bold(area)}`);
    }
    // Step 2: Stage
    fmt.log.info('Step 2: Staging all tracked changes...');
    (0, git_js_1.git)(['add', '-A']);
    // Step 3: Commit
    fmt.log.info('Step 3: Committing checkpoint...');
    const commitMsg = `checkpoint(${slug}): ${cpName}`;
    const commitBody = `Next action: ${nextAction}`;
    const commitResult = (0, git_js_1.git)(['commit', '-m', commitMsg, '-m', commitBody]);
    if (commitResult.status !== 0) {
        fmt.log.fail('Commit failed.');
        process.exit(1);
    }
    // Step 4: Push
    const branch = (0, git_js_1.getCurrentBranch)();
    fmt.log.info(`Step 4: Pushing to origin/${fmt.branch(branch)}...`);
    const pushResult = (0, git_js_1.git)(['push', 'origin', branch]);
    if (pushResult.status !== 0) {
        fmt.log.fail('Push failed.');
        process.exit(1);
    }
    fmt.log.pass('Checkpoint complete and pushed.');
}
exports.default = checkpoint;
