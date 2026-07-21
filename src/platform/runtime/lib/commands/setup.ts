import { setupWizard } from '../tools/setup-review.js';
export default setupWizard;
export { setupWizard };

// CJS compat: ensure require() returns the function directly
declare const module: { exports: any } | undefined;
if (typeof module !== 'undefined') { module.exports = setupWizard; }
