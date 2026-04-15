"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerZip = registerZip;
exports.lookupZipForTmpFile = lookupZipForTmpFile;
// Maps timestamp from tmp filename to the source JSZip instance.
// Key is the timestamp string from `zip-viewer-{timestamp}-{filename}`.
const registry = new Map();
function registerZip(key, zip) {
    registry.set(key, zip);
}
function lookupZipForTmpFile(tmpFilePath) {
    const m = tmpFilePath.match(/zip-viewer-(\d+)-/);
    if (!m) {
        return undefined;
    }
    return registry.get(m[1]);
}
//# sourceMappingURL=gdtfRegistry.js.map