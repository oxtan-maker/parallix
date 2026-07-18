"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verify = void 0;
const verification_js_1 = __importDefault(require("../core/verification.js"));
exports.verify = verification_js_1.default;
exports.default = verification_js_1.default;
if (typeof module !== 'undefined') {
    module.exports = verification_js_1.default;
}
