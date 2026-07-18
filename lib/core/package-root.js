"use strict";
/**
 * package-root.ts - resolve the Parallix package root from a module's __dirname.
 *
 * ADR 0044 phase T2 (docs/adr/0044-workflow-distribution-model.md §6, §9):
 * package-owned assets (prompts/, templates/, config/, data/, executable
 * scripts) must resolve from the installed package root rather than from a
 * fixed count of `..` segments or from process.cwd(). This helper walks
 * upward from a caller-supplied directory (always its module `__dirname`) to
 * the nearest ancestor whose package.json is named `@magnusekdahl/parallix`.
 *
 * It deliberately never consults process.cwd(): the anchor is the module's
 * own location, so resolution is identical whether the process runs inside
 * the checkout, from an installed node_modules copy, or from an unrelated CWD.
 */
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
exports.packageRoot = packageRoot;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const PACKAGE_NAME = '@magnusekdahl/parallix';
// Cache resolved roots per starting directory. Module locations are stable for
// the lifetime of a process, so this avoids repeated filesystem walks without
// ever reaching into process.cwd().
const rootCache = new Map();
/**
 * Walk upward from `fromDir` and return the nearest directory containing a
 * package.json whose `name` is `@magnusekdahl/parallix`.
 *
 * @param fromDir Starting directory; callers pass their module `__dirname`.
 * @throws if no matching package.json is found on the ancestor chain.
 */
function packageRoot(fromDir) {
    if (typeof fromDir !== 'string' || fromDir.length === 0) {
        throw new Error(`packageRoot: fromDir must be a non-empty string, received ${String(fromDir)}`);
    }
    const start = path.resolve(fromDir);
    const cached = rootCache.get(start);
    if (cached !== undefined) {
        return cached;
    }
    let dir = start;
    // Bounded by the filesystem: dirname('/') === '/', which ends the loop.
    for (;;) {
        const pkgPath = path.join(dir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            let name;
            try {
                name = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).name;
            }
            catch {
                // Malformed package.json: ignore and keep walking upward.
                name = undefined;
            }
            if (name === PACKAGE_NAME) {
                rootCache.set(start, dir);
                return dir;
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    throw new Error(`packageRoot: could not find a package.json named ${PACKAGE_NAME} ` +
        `on the ancestor chain of ${start}`);
}
