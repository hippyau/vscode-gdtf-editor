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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GdtfSchemaValidator = void 0;
exports.parseXmllintOutput = parseXmllintOutput;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs/promises"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const gdtfRegistry_1 = require("./gdtfRegistry");
const VALIDATION_DELAY_MS = 250;
const DIAGNOSTIC_SOURCE = 'xmllint';
class XmllintUnavailableError extends Error {
    constructor() {
        super('xmllint is not available on PATH');
    }
}
function isTrackedDescriptionDocument(document) {
    if (document.uri.scheme !== 'file') {
        return false;
    }
    const fileName = path.basename(document.uri.fsPath).toLowerCase();
    if (!fileName.endsWith('description.xml')) {
        return false;
    }
    return (0, gdtfRegistry_1.lookupZipForTmpFile)(document.uri.fsPath) !== undefined;
}
function diagnosticRange(document, lineNumber) {
    const safeLine = Math.max(0, Math.min(document.lineCount - 1, lineNumber - 1));
    const line = document.lineAt(safeLine);
    const startCharacter = Math.min(line.firstNonWhitespaceCharacterIndex, line.text.length);
    return new vscode.Range(safeLine, startCharacter, safeLine, line.text.length);
}
function parseXmllintOutput(output) {
    const issues = [];
    const seen = new Set();
    for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.endsWith('validates') || line.endsWith('fails to validate')) {
            continue;
        }
        const match = line.match(/^(.*?):(\d+):(?:\d+:)?\s*(.+)$/);
        if (!match) {
            continue;
        }
        let message = match[3].trim();
        const elementPrefix = message.match(/^element\s+[^:]+:\s*(.+)$/i);
        if (elementPrefix) {
            message = elementPrefix[1].trim();
        }
        message = message
            .replace(/^Schemas validity error\s*:\s*/i, '')
            .replace(/^Schemas parser error\s*:\s*/i, '')
            .replace(/^parser error\s*:\s*/i, '')
            .trim();
        const issue = {
            line: Number(match[2]),
            message,
        };
        const key = `${issue.line}:${issue.message}`;
        if (!issue.message || seen.has(key)) {
            continue;
        }
        seen.add(key);
        issues.push(issue);
    }
    return issues;
}
class GdtfSchemaValidator {
    extensionPath;
    diagnostics = vscode.languages.createDiagnosticCollection('gdtf-schema');
    pendingValidations = new Map();
    schemaPath;
    xmllintAvailable;
    xmllintWarningShown = false;
    constructor(extensionPath) {
        this.extensionPath = extensionPath;
        this.schemaPath = path.join(extensionPath, 'gdtf.xsd');
    }
    register(context) {
        context.subscriptions.push(this.diagnostics, this, vscode.workspace.onDidOpenTextDocument(document => this.scheduleValidation(document, true)), vscode.workspace.onDidSaveTextDocument(document => this.scheduleValidation(document, true)), vscode.workspace.onDidChangeTextDocument(event => this.scheduleValidation(event.document)), vscode.workspace.onDidCloseTextDocument(document => this.clearDocument(document)));
        for (const document of vscode.workspace.textDocuments) {
            this.scheduleValidation(document, true);
        }
    }
    dispose() {
        for (const timer of this.pendingValidations.values()) {
            clearTimeout(timer);
        }
        this.pendingValidations.clear();
        this.diagnostics.dispose();
    }
    clearDocument(document) {
        const key = document.uri.toString();
        const timer = this.pendingValidations.get(key);
        if (timer) {
            clearTimeout(timer);
            this.pendingValidations.delete(key);
        }
        this.diagnostics.delete(document.uri);
    }
    scheduleValidation(document, immediate = false) {
        if (!isTrackedDescriptionDocument(document)) {
            this.clearDocument(document);
            return;
        }
        const key = document.uri.toString();
        const existing = this.pendingValidations.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        const timer = setTimeout(() => {
            this.pendingValidations.delete(key);
            void this.validateDocument(document);
        }, immediate ? 0 : VALIDATION_DELAY_MS);
        this.pendingValidations.set(key, timer);
    }
    async validateDocument(document) {
        const startingVersion = document.version;
        try {
            const issues = await this.runXmllint(document);
            const latest = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === document.uri.toString());
            if (!latest || latest.version !== startingVersion) {
                if (latest) {
                    this.scheduleValidation(latest, true);
                }
                return;
            }
            const diagnostics = issues.map(issue => {
                const diagnostic = new vscode.Diagnostic(diagnosticRange(latest, issue.line), issue.message, vscode.DiagnosticSeverity.Error);
                diagnostic.source = DIAGNOSTIC_SOURCE;
                return diagnostic;
            });
            this.diagnostics.set(latest.uri, diagnostics);
        }
        catch (error) {
            if (error instanceof XmllintUnavailableError) {
                this.xmllintAvailable = false;
                this.diagnostics.delete(document.uri);
                if (!this.xmllintWarningShown) {
                    this.xmllintWarningShown = true;
                    void vscode.window.showWarningMessage('GDTF schema validation is unavailable because xmllint was not found on PATH.');
                }
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            console.error('GDTF schema validation failed:', message);
        }
    }
    async runXmllint(document) {
        if (this.xmllintAvailable === false) {
            throw new XmllintUnavailableError();
        }
        const tempPath = path.join(os.tmpdir(), `zip-viewer-schema-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.xml`);
        try {
            await fs.writeFile(tempPath, document.getText(), 'utf8');
            const output = await this.executeXmllint(tempPath);
            this.xmllintAvailable = true;
            return parseXmllintOutput(output);
        }
        finally {
            await fs.unlink(tempPath).catch(() => undefined);
        }
    }
    executeXmllint(filePath) {
        return new Promise((resolve, reject) => {
            (0, child_process_1.execFile)('xmllint', ['--noout', '--schema', this.schemaPath, filePath], { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
                const output = [stdout, stderr].filter(Boolean).join('\n');
                if (!error) {
                    resolve(output);
                    return;
                }
                const execError = error;
                if (execError.code === 'ENOENT') {
                    reject(new XmllintUnavailableError());
                    return;
                }
                const issues = parseXmllintOutput(output);
                if (issues.length > 0) {
                    resolve(output);
                    return;
                }
                reject(new Error(output || execError.message));
            });
        });
    }
}
exports.GdtfSchemaValidator = GdtfSchemaValidator;
//# sourceMappingURL=gdtfSchemaValidator.js.map