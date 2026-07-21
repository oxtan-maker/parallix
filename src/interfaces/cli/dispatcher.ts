/**
 * Transitional source entry for the established headless dispatcher.  The
 * CommonJS dist copy remains the rollback shim; CP-2 consumers import this
 * ESM source boundary while remaining command modules are moved in dependency
 * order.
 */
export { main, printUsage, deriveAliases, resolveAlias } from '../../platform/runtime/index.js';
