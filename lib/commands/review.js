"use strict";
const review_commands_js_1 = require("../review/review-commands.js");
/**
 * Workflow command entry point for `review`.
 * Delegates to the review subsystem (review-commands.js).
 *
 * Usage: node parallix review [<slug>] [--verify] [--submit] [--push] ...
 */
/** @param {string[]} args */
async function reviewCommand(args) {
    await (0, review_commands_js_1.review)(args);
}
module.exports = reviewCommand;
