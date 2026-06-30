#!/usr/bin/env node
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
const fmt = __importStar(require("../core/fmt.js"));
const product_config_js_1 = require("../core/product-config.js");
// `node parallix config` — read-only. Prints the effective configuration:
// code-owned defaults merged with the optional workflow.config.json override.
// This replaces the deleted workflow.config.json.example as the way to discover
// the configurable surface, with no copy-paste footgun and no second source of
// truth to drift from (task-1233 Scope Amendment).
async function config(_args = [], opts = {}) {
    void _args; // intentionally unused — part of public API signature
    const logFn = opts.logFn || fmt.log.plain;
    const errorFn = opts.errorFn || fmt.log.plainError;
    const exitFn = opts.exitFn || ((code) => { process.exitCode = code; });
    const rootDir = opts.rootDir || process.cwd();
    const loaded = (0, product_config_js_1.loadWorkflowConfig)(rootDir);
    if (!loaded.found) {
        logFn(fmt.status('INFO', 'No workflow.config.json found — showing built-in defaults.'));
    }
    else if (loaded.parseError) {
        errorFn(fmt.status('FAIL', `workflow.config.json is invalid JSON (${ /** @type{Error} */(loaded.parseError).message}); showing fallback built-in defaults.`));
        logFn(JSON.stringify((0, product_config_js_1.loadEffectiveConfig)(rootDir), null, 2));
        exitFn(1);
        return;
    }
    else {
        const issues = (0, product_config_js_1.validateWorkflowConfig)(loaded.config);
        if (issues.length > 0) {
            errorFn(fmt.status('FAIL', `workflow.config.json is structurally invalid: ${issues.join('; ')}; showing fallback built-in defaults.`));
            logFn(JSON.stringify((0, product_config_js_1.loadEffectiveConfig)(rootDir), null, 2));
            exitFn(1);
            return;
        }
        logFn(fmt.status('INFO', `Effective config (built-in defaults + ${loaded.configPath}):`));
    }
    logFn(JSON.stringify((0, product_config_js_1.loadEffectiveConfig)(rootDir), null, 2));
}
module.exports = config;
