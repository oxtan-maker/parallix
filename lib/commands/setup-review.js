"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupReviewCommand = setupReviewCommand;
const setup_review_js_1 = require("../tools/setup-review.js");
/**
 * Workflow command entry point for `setup-review`.
 * Delegates to the Forgejo bootstrap tool (tools/setup-review.js).
 *
 * Usage: node parallix setup-review
 */
/** @param {string[]} args @param {{[key: string]: any}} [options] */
async function setupReviewCommand(args, options) {
    await (0, setup_review_js_1.setupReview)(args, options);
}
exports.default = setupReviewCommand;
if (typeof module !== 'undefined') {
    module.exports = setupReviewCommand;
}
