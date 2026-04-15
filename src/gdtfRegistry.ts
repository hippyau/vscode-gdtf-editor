import * as vscode from 'vscode';
import JSZip from 'jszip';

export interface GdtfTempEntry {
    gdtfUri: vscode.Uri;
    zipEntryPath: string;
    getZip: () => JSZip;
    setZip: (zip: JSZip) => void;
}

// Maps extracted temp file paths to their source GDTF entry.
const registry = new Map<string, GdtfTempEntry>();

export function registerZip(
    tmpFilePath: string,
    gdtfUri: vscode.Uri,
    zipEntryPath: string,
    getZip: () => JSZip,
    setZip: (zip: JSZip) => void
): void {
    registry.set(tmpFilePath, { gdtfUri, zipEntryPath, getZip, setZip });
}

export function lookupEntryForTmpFile(tmpFilePath: string): GdtfTempEntry | undefined {
    return registry.get(tmpFilePath);
}

export function deregisterTmpFile(tmpFilePath: string): void {
    registry.delete(tmpFilePath);
}

export function lookupZipForTmpFile(tmpFilePath: string): JSZip | undefined {
    return lookupEntryForTmpFile(tmpFilePath)?.getZip();
}
