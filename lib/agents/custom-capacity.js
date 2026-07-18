"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCustomCapacityAvailable = isCustomCapacityAvailable;
exports.tryAcquireCustomCapacity = tryAcquireCustomCapacity;
exports.resetCustomCapacity = resetCustomCapacity;
exports.activeCustomCapacityCount = activeCustomCapacityCount;
const product_config_js_1 = require("../core/product-config.js");
// Custom launchers run local GPU-backed models. This module is deliberately
// process-local: startAgent is the single lifecycle owner in this process, and
// the mission does not introduce cross-process coordination.
let activeCustomLaunches = 0;
function isCustomCapacityAvailable(rootDir) {
    return activeCustomLaunches < (0, product_config_js_1.resolveMaxConcurrentCustom)(rootDir);
}
function tryAcquireCustomCapacity(rootDir) {
    if (!isCustomCapacityAvailable(rootDir)) {
        return null;
    }
    activeCustomLaunches += 1;
    let released = false;
    return {
        release() {
            if (released) {
                return;
            }
            released = true;
            activeCustomLaunches = Math.max(0, activeCustomLaunches - 1);
        }
    };
}
// Test and recovery hook: clearing reservations is safe because this guard is
// in-process only. Production lifecycle code normally releases via finally.
function resetCustomCapacity() {
    activeCustomLaunches = 0;
}
function activeCustomCapacityCount() {
    return activeCustomLaunches;
}
