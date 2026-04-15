import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { lookupZipForTmpFile } from './gdtfRegistry';

const VALIDATION_DELAY_MS = 250;
const DIAGNOSTIC_SOURCE = 'xmllint';

interface XmllintIssue {
    line: number;
    message: string;
}

class XmllintUnavailableError extends Error {
    constructor() {
        super('xmllint is not available on PATH');
    }
}

function isTrackedDescriptionDocument(document: vscode.TextDocument): boolean {
    if (document.uri.scheme !== 'file') {
        return false;
    }

    const fileName = path.basename(document.uri.fsPath).toLowerCase();
    if (!fileName.endsWith('description.xml')) {
        return false;
    }

    return lookupZipForTmpFile(document.uri.fsPath) !== undefined;
}

function diagnosticRange(document: vscode.TextDocument, lineNumber: number): vscode.Range {
    const safeLine = Math.max(0, Math.min(document.lineCount - 1, lineNumber - 1));
    const line = document.lineAt(safeLine);
    const startCharacter = Math.min(line.firstNonWhitespaceCharacterIndex, line.text.length);
    return new vscode.Range(safeLine, startCharacter, safeLine, line.text.length);
}

export function parseXmllintOutput(output: string): XmllintIssue[] {
    const issues: XmllintIssue[] = [];
    const seen = new Set<string>();

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

        const issue: XmllintIssue = {
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

export class GdtfSchemaValidator implements vscode.Disposable {
    private readonly diagnostics = vscode.languages.createDiagnosticCollection('gdtf-schema');
    private readonly pendingValidations = new Map<string, NodeJS.Timeout>();
    private readonly schemaPath: string;
    private xmllintAvailable: boolean | undefined;
    private xmllintWarningShown = false;

    constructor(private readonly extensionPath: string) {
        this.schemaPath = path.join(extensionPath, 'gdtf.xsd');
    }

    register(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            this.diagnostics,
            this,
            vscode.workspace.onDidOpenTextDocument(document => this.scheduleValidation(document, true)),
            vscode.workspace.onDidSaveTextDocument(document => this.scheduleValidation(document, true)),
            vscode.workspace.onDidChangeTextDocument(event => this.scheduleValidation(event.document)),
            vscode.workspace.onDidCloseTextDocument(document => this.clearDocument(document))
        );

        for (const document of vscode.workspace.textDocuments) {
            this.scheduleValidation(document, true);
        }
    }

    dispose(): void {
        for (const timer of this.pendingValidations.values()) {
            clearTimeout(timer);
        }
        this.pendingValidations.clear();
        this.diagnostics.dispose();
    }

    private clearDocument(document: vscode.TextDocument): void {
        const key = document.uri.toString();
        const timer = this.pendingValidations.get(key);
        if (timer) {
            clearTimeout(timer);
            this.pendingValidations.delete(key);
        }
        this.diagnostics.delete(document.uri);
    }

    private scheduleValidation(document: vscode.TextDocument, immediate = false): void {
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

    private async validateDocument(document: vscode.TextDocument): Promise<void> {
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
                const diagnostic = new vscode.Diagnostic(
                    diagnosticRange(latest, issue.line),
                    issue.message,
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.source = DIAGNOSTIC_SOURCE;
                return diagnostic;
            });

            this.diagnostics.set(latest.uri, diagnostics);
        } catch (error) {
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

    private async runXmllint(document: vscode.TextDocument): Promise<XmllintIssue[]> {
        if (this.xmllintAvailable === false) {
            throw new XmllintUnavailableError();
        }

        const tempPath = path.join(
            os.tmpdir(),
            `gdtf-viewer-schema-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.xml`
        );

        try {
            await fs.writeFile(tempPath, document.getText(), 'utf8');
            const output = await this.executeXmllint(tempPath);
            this.xmllintAvailable = true;
            return parseXmllintOutput(output);
        } finally {
            await fs.unlink(tempPath).catch(() => undefined);
        }
    }

    private executeXmllint(filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            execFile(
                'xmllint',
                ['--noout', '--schema', this.schemaPath, filePath],
                { maxBuffer: 1024 * 1024 },
                (error, stdout, stderr) => {
                    const output = [stdout, stderr].filter(Boolean).join('\n');
                    if (!error) {
                        resolve(output);
                        return;
                    }

                    const execError = error as NodeJS.ErrnoException;
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
                }
            );
        });
    }
}