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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZipViewerProvider = exports.ZipDocument = void 0;
const vscode = __importStar(require("vscode"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const jszip_1 = __importDefault(require("jszip"));
const gdtfRegistry_1 = require("./gdtfRegistry");
class ZipDocument {
    uri;
    zipData;
    constructor(uri, zipData) {
        this.uri = uri;
        this.zipData = zipData;
    }
    dispose() {
        // Cleanup if needed
    }
}
exports.ZipDocument = ZipDocument;
class ZipViewerProvider {
    extensionUri;
    static viewType = 'zipViewer.zipFile';
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
    }
    async openCustomDocument(uri, openContext, token) {
        const fileData = await vscode.workspace.fs.readFile(uri);
        const zip = await jszip_1.default.loadAsync(fileData);
        return new ZipDocument(uri, zip);
    }
    escapeHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    async resolveCustomEditor(document, webviewPanel, token) {
        webviewPanel.webview.options = {
            enableScripts: true
        };
        webviewPanel.webview.html = await this.getHtmlForWebview(webviewPanel.webview, document);
        // Handle messages from webview
        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'openFile':
                    await this.openFileFromZip(document, message.path);
                    break;
            }
        });
    }
    async openFileFromZip(document, filePath) {
        const file = document.zipData.file(filePath);
        if (!file) {
            vscode.window.showErrorMessage(`File not found: ${filePath}`);
            return;
        }
        try {
            const content = await file.async('nodebuffer');
            const fileName = path.basename(filePath);
            const timestamp = Date.now().toString();
            const tmpPath = path.join(os.tmpdir(), `zip-viewer-${timestamp}-${fileName}`);
            fs.writeFileSync(tmpPath, content);
            (0, gdtfRegistry_1.registerZip)(timestamp, document.zipData);
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(tmpPath));
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
        }
    }
    isImageFile(filePath) {
        const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
        return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext);
    }
    getMimeType(filePath) {
        const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
        const mimeMap = {
            'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
            'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
            'ico': 'image/x-icon', 'bmp': 'image/bmp',
        };
        return mimeMap[ext] ?? 'application/octet-stream';
    }
    isMeshFile(filePath) {
        const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
        return ['3ds', 'glb', 'gltf', 'obj', 'step', 'stp'].includes(ext);
    }
    parseGdtfMetadata(xml) {
        const match = xml.match(/<FixtureType([^>]*)/);
        const attrs = match?.[1] ?? '';
        const attr = (key) => attrs.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1] ?? '';
        return {
            name: attr('Name'),
            shortName: attr('ShortName'),
            manufacturer: attr('Manufacturer'),
            longDescription: attr('LongName') || attr('Description'),
            thumbnail: attr('Thumbnail'),
        };
    }
    async getHtmlForWebview(webview, document) {
        const rawFileName = document.uri.fsPath.split(/[\\/]/).pop() ?? '';
        const isGdtf = rawFileName.toLowerCase().endsWith('.gdtf');
        const files = [];
        document.zipData.forEach((relativePath, file) => {
            files.push({
                path: relativePath,
                size: file.dir ? 0 : (file._data?.uncompressedSize ?? 0),
                isDirectory: file.dir,
            });
        });
        files.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1;
            }
            return a.path.localeCompare(b.path);
        });
        // Load image thumbnails as base64 data URIs
        const thumbnails = new Map();
        await Promise.all(files
            .filter(f => !f.isDirectory && this.isImageFile(f.path))
            .map(async (f) => {
            const zf = document.zipData.file(f.path);
            if (zf) {
                const b64 = await zf.async('base64');
                thumbnails.set(f.path, `data:${this.getMimeType(f.path)};base64,${b64}`);
            }
        }));
        // Parse GDTF metadata from description.xml
        let gdtfMeta = null;
        if (isGdtf) {
            const descFile = document.zipData.file('description.xml');
            if (descFile) {
                try {
                    gdtfMeta = this.parseGdtfMetadata(await descFile.async('string'));
                }
                catch { /* ignore */ }
            }
        }
        // Find fixture thumbnail image (GDTF Thumbnail attr = basename without extension)
        let fixtureThumbnailSrc;
        if (gdtfMeta?.thumbnail) {
            const base = gdtfMeta.thumbnail;
            for (const ext of ['png', 'jpg', 'jpeg', 'svg']) {
                const src = thumbnails.get(`${base}.${ext}`) ?? thumbnails.get(`thumbnails/${base}.${ext}`);
                if (src) {
                    fixtureThumbnailSrc = src;
                    break;
                }
            }
        }
        const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        const fileName = this.escapeHtml(rawFileName);
        // Build a single table row for a file
        const buildRow = (file) => {
            if (file.isDirectory) {
                return `<tr><td colspan="2" style="padding:6px 8px;font-family:monospace;color:var(--vscode-descriptionForeground);">📁 ${this.escapeHtml(file.path)}</td></tr>`;
            }
            const escapedPath = this.escapeHtml(file.path);
            const sizeStr = this.escapeHtml(this.formatBytes(file.size));
            const thumb = thumbnails.get(file.path);
            const thumbHtml = thumb
                ? `<img src="${thumb}" style="max-height:36px;max-width:56px;vertical-align:middle;margin-right:6px;border-radius:2px;">`
                : '';
            const isMesh = this.isMeshFile(file.path);
            const icon = isMesh ? '🔷' : this.isImageFile(file.path) ? '🖼️' : '📄';
            const badge = isMesh
                ? ` <span style="font-size:0.75em;padding:1px 4px;border:1px solid var(--vscode-descriptionForeground);border-radius:3px;margin-left:4px;color:var(--vscode-descriptionForeground);">3D</span>`
                : '';
            return `<tr class="file-row" data-path="${escapedPath}"><td style="padding:8px;font-family:monospace;">${thumbHtml}${icon} ${escapedPath}${badge}</td><td style="padding:8px;text-align:right;font-family:monospace;">${sizeStr}</td></tr>`;
        };
        // Category separator row
        const sectionHeader = (label, count) => `<tr><td colspan="2" style="padding:10px 8px 2px;font-size:0.78em;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--vscode-descriptionForeground);border-top:1px solid var(--vscode-panel-border);">${label} <span style="font-weight:400;">(${count})</span></td></tr>`;
        // Build file rows — grouped for GDTF, flat for ZIP
        let fileListHtml;
        if (isGdtf) {
            const groups = { description: [], thumbnails: [], wheels: [], models: [], other: [] };
            for (const f of files) {
                if (f.isDirectory) {
                    continue;
                }
                const p = f.path.toLowerCase();
                if (p === 'description.xml') {
                    groups.description.push(f);
                }
                else if (p.startsWith('wheels/')) {
                    groups.wheels.push(f);
                }
                else if (p.startsWith('models/')) {
                    groups.models.push(f);
                }
                else if (this.isImageFile(f.path) && !f.path.includes('/')) {
                    groups.thumbnails.push(f);
                }
                else {
                    groups.other.push(f);
                }
            }
            const parts = [];
            const addSection = (key, label) => {
                if (groups[key].length) {
                    parts.push(sectionHeader(label, groups[key].length));
                    groups[key].forEach(f => parts.push(buildRow(f)));
                }
            };
            addSection('description', 'Description');
            addSection('thumbnails', 'Thumbnails');
            addSection('wheels', 'Wheel Media');
            addSection('models', '3D Models');
            addSection('other', 'Other');
            fileListHtml = parts.join('\n');
        }
        else {
            fileListHtml = files.map(buildRow).join('\n');
        }
        // GDTF fixture info card
        const gdtfHeaderHtml = gdtfMeta ? `
        <div style="display:flex;align-items:flex-start;gap:16px;margin:16px 0;padding:16px;background:var(--vscode-editor-inactiveSelectionBackground);border:1px solid var(--vscode-panel-border);border-radius:6px;">
            ${fixtureThumbnailSrc ? `<img src="${fixtureThumbnailSrc}" alt="Fixture" style="max-width:100px;max-height:100px;border-radius:4px;object-fit:contain;">` : ''}
            <div>
                <div style="font-size:1.25em;font-weight:600;margin-bottom:4px;">${this.escapeHtml(gdtfMeta.name)}</div>
                <div style="color:var(--vscode-descriptionForeground);margin-bottom:6px;">${this.escapeHtml(gdtfMeta.manufacturer)}${gdtfMeta.shortName && gdtfMeta.shortName !== gdtfMeta.name ? ' · ' + this.escapeHtml(gdtfMeta.shortName) : ''}</div>
                ${gdtfMeta.longDescription ? `<div style="font-size:0.9em;color:var(--vscode-descriptionForeground);">${this.escapeHtml(gdtfMeta.longDescription)}</div>` : ''}
            </div>
        </div>` : '';
        const fileCount = files.filter(f => !f.isDirectory).length;
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:;">
    <title>${fileName}</title>
    <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
        h2 { color: var(--vscode-foreground); border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 10px; margin-bottom: 0; }
        .info { color: var(--vscode-descriptionForeground); margin: 8px 0 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th { text-align: left; padding: 8px; background: var(--vscode-editor-inactiveSelectionBackground); border-bottom: 1px solid var(--vscode-panel-border); font-family: monospace; }
        tr:hover { background: var(--vscode-list-hoverBackground); }
        .file-row { cursor: pointer; }
        .file-row:hover td { color: var(--vscode-textLink-activeForeground); }
    </style>
</head>
<body>
    <h2>${isGdtf ? '💡' : '📦'} ${fileName}</h2>
    ${gdtfHeaderHtml}
    <div class="info">${fileCount} files · Click to open</div>
    <table>
        <thead><tr><th>File</th><th style="text-align:right;">Size</th></tr></thead>
        <tbody>${fileListHtml}</tbody>
    </table>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.querySelectorAll('tr.file-row').forEach(row => {
            row.addEventListener('click', () => {
                const p = row.getAttribute('data-path');
                if (p) { vscode.postMessage({ command: 'openFile', path: p }); }
            });
        });
    </script>
</body>
</html>`;
    }
    formatBytes(bytes) {
        if (bytes === 0) {
            return '0 Bytes';
        }
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
}
exports.ZipViewerProvider = ZipViewerProvider;
//# sourceMappingURL=zipViewerProvider.js.map