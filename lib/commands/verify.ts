import verify from '../core/verification.js';
export default verify;
export { verify };

// CJS compat: ensure require() returns the function directly
declare const module: { exports: any } | undefined;
if (typeof module !== 'undefined') { module.exports = verify; }
