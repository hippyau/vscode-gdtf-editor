import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import JSZip from 'jszip';
import { deregisterTmpFile, registerZip, lookupEntryForTmpFile } from './gdtfRegistry';

export class ZipDocument implements vscode.CustomDocument {
    constructor(
        public readonly uri: vscode.Uri,
        public zipData: JSZip
    ) {}

    dispose(): void {
    }
}

export class ZipViewerProvider implements vscode.CustomReadonlyEditorProvider<ZipDocument> {
    public static readonly viewType = 'gdtfViewer.gdtfFile';
    private readonly pendingArchiveUpdates = new Set<string>();

    constructor(private readonly extensionUri: vscode.Uri) {}

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<ZipDocument> {
        const fileData = await vscode.workspace.fs.readFile(uri);
        const zip = await JSZip.loadAsync(fileData);
        return new ZipDocument(uri, zip);
    }

    private escapeHtml(str: string): string {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async resolveCustomEditor(
        document: ZipDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true
        };

        webviewPanel.webview.html = await this.getHtmlForWebview(webviewPanel.webview, document);

        // Handle messages from webview
        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            if (message?.command === 'openFile' && typeof message.path !== 'string') {
                return;
            }

            switch (message.command) {
                case 'openFile':
                    if (!document.zipData.file(message.path)) {
                        return;
                    }
                    await this.openFileFromZip(document, message.path);
                    break;
            }
        });
    }

    private async openFileFromZip(document: ZipDocument, filePath: string): Promise<void> {
        const file = document.zipData.file(filePath);
        if (!file) {
            vscode.window.showErrorMessage(`File not found: ${filePath}`);
            return;
        }

        try {
            const content = await file.async('nodebuffer');
            const fileName = path.basename(filePath);
            const timestamp = Date.now().toString();
            const tmpPath = path.join(os.tmpdir(), `gdtf-viewer-${timestamp}-${fileName}`);
            await fs.promises.writeFile(tmpPath, content);
            registerZip(
                tmpPath,
                document.uri,
                filePath,
                () => document.zipData,
                zip => { document.zipData = zip; }
            );
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(tmpPath));
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
        }
    }

    registerSaveListener(): vscode.Disposable {
        const saveSubscription = vscode.workspace.onDidSaveTextDocument(async (doc) => {
            const tmpFilePath = doc.uri.fsPath;
            const entry = lookupEntryForTmpFile(tmpFilePath);
            if (!entry) { return; }

            const archiveKey = entry.gdtfUri.toString();
            if (this.pendingArchiveUpdates.has(archiveKey)) { return; }

            this.pendingArchiveUpdates.add(archiveKey);
            const gdtfName = path.basename(entry.gdtfUri.fsPath);

            try {
                const answer = await vscode.window.showInformationMessage(
                    `Update ${entry.zipEntryPath} in ${gdtfName} with your saved changes?`,
                    'Update GDTF',
                    'Discard'
                );
                if (answer !== 'Update GDTF') { return; }

                const gdtfData = await vscode.workspace.fs.readFile(entry.gdtfUri);
                const zip = await JSZip.loadAsync(gdtfData);
                zip.file(entry.zipEntryPath, doc.getText());
                const updated = await zip.generateAsync({
                    type: 'nodebuffer',
                    compression: 'DEFLATE',
                    compressionOptions: { level: 6 }
                });
                await vscode.workspace.fs.writeFile(entry.gdtfUri, updated);
                entry.setZip(zip);
                vscode.window.showInformationMessage(`Updated ${entry.zipEntryPath} in ${gdtfName}.`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Failed to update GDTF: ${message}`);
            } finally {
                this.pendingArchiveUpdates.delete(archiveKey);
            }
        });

        const closeSubscription = vscode.workspace.onDidCloseTextDocument(async (doc) => {
            const tmpFilePath = doc.uri.fsPath;
            if (!lookupEntryForTmpFile(tmpFilePath)) { return; }

            deregisterTmpFile(tmpFilePath);
            await fs.promises.unlink(tmpFilePath).catch(() => undefined);
        });

        return vscode.Disposable.from(saveSubscription, closeSubscription);
    }

    private isImageFile(filePath: string): boolean {
        const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
        return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext);
    }

    private getMimeType(filePath: string): string {
        const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
        const mimeMap: { [key: string]: string } = {
            'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
            'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
            'ico': 'image/x-icon', 'bmp': 'image/bmp',
        };
        return mimeMap[ext] ?? 'application/octet-stream';
    }

    private isMeshFile(filePath: string): boolean {
        const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
        return ['3ds', 'glb', 'gltf', 'obj', 'step', 'stp'].includes(ext);
    }

    private parseGdtfMetadata(xml: string): {
        name: string; shortName: string; manufacturer: string; longDescription: string; thumbnail: string;
        fixtureTypeId: string; dataVersion: string;
        revisions: Array<{ text: string; date: string; userId: string }>;
        rdm: { manufacturerId: string; deviceModelId: string; softwareVersions: string[] } | null;
        dmxModes: Array<{ name: string; description: string; channelCount: number }>;
        wiringObjects: Array<{ name: string; componentType: string; connectorType: string; signalType: string; pinCount: string; voltage: string; voltageRangeMin: string; voltageRangeMax: string; electricalPayLoad: string; frequencyRangeMin: string; frequencyRangeMax: string }>;
    } {
        // ── helpers ──────────────────────────────────────────────────────────
        const attrVal = (tag: string, key: string): string =>
            tag.match(new RegExp(`\\b${key}="([^"]*)"`))?.[ 1] ?? '';

        // ── FixtureType root ─────────────────────────────────────────────────
        const ftMatch = xml.match(/<FixtureType([^>]*)/);
        const ftAttrs = ftMatch?.[1] ?? '';
        const ft = (k: string) => attrVal(ftAttrs, k);

        const gdtfMatch = xml.match(/<GDTF([^>]*)/);
        const gdtfAttrs = gdtfMatch?.[1] ?? '';

        // ── Revisions ────────────────────────────────────────────────────────
        const revisions: Array<{ text: string; date: string; userId: string }> = [];
        const revRe = /<Revision\b([^>]*?)\/?>/g;
        let revM: RegExpExecArray | null;
        while ((revM = revRe.exec(xml)) !== null) {
            const a = revM[1];
            revisions.push({
                text: attrVal(a, 'Text'),
                date: attrVal(a, 'Date'),
                userId: attrVal(a, 'UserID'),
            });
        }

        // ── RDM ─────────────────────────────────────────────────────────────
        let rdm: { manufacturerId: string; deviceModelId: string; softwareVersions: string[] } | null = null;
        const rdmMatch = xml.match(/<FTRDM\b([^>]*)/);
        if (rdmMatch) {
            const ra = rdmMatch[1];
            const swVersions: string[] = [];
            const svRe = /<SoftwareVersionID\b([^>]*)/g;
            let svm: RegExpExecArray | null;
            while ((svm = svRe.exec(xml)) !== null) {
                const v = attrVal(svm[1], 'Value');
                if (v) { swVersions.push(v); }
            }
            rdm = {
                manufacturerId: attrVal(ra, 'ManufacturerID'),
                deviceModelId: attrVal(ra, 'DeviceModelID'),
                softwareVersions: swVersions,
            };
        }

        // ── GeometryReference channel map (global pre-scan) ─────────────────
        // GeometryReference elements live in the Geometries section (not inside DMXModes).
        // Each instance has <Break DMXBreak="N" DMXOffset="M"/> children.
        // Strategy: group (Geometry, DMXBreak) → sorted DMXOffset values,
        //   infer per-pixel width from minimum gap, max_slot = last_offset + pixel_width - 1.
        // Key format: "<geometryType>:<dmxBreak>" → max slot number
        const geoBreakMax = new Map<string, number>();
        {
            const geoOffsets = new Map<string, number[]>(); // "<geo>:<brk>" -> offsets
            const geoRefRe = /<GeometryReference\b([^>]*)>([\s\S]*?)<\/GeometryReference>/g;
            let grM: RegExpExecArray | null;
            while ((grM = geoRefRe.exec(xml)) !== null) {
                const geoType = attrVal(grM[1], 'Geometry');
                if (!geoType) { continue; }
                const breakRe = /<Break\b[^>]*\bDMXBreak="(\d+)"[^>]*\bDMXOffset="(\d+)"/g;
                let bm: RegExpExecArray | null;
                while ((bm = breakRe.exec(grM[2])) !== null) {
                    const key = `${geoType}:${bm[1]}`;
                    const list = geoOffsets.get(key) ?? [];
                    list.push(parseInt(bm[2], 10));
                    geoOffsets.set(key, list);
                }
            }
            for (const [key, offsets] of geoOffsets) {
                const sorted = [...new Set(offsets)].sort((a, b) => a - b);
                let pixelWidth = 1;
                if (sorted.length > 1) {
                    const gaps: number[] = [];
                    for (let i = 0; i < sorted.length - 1; i++) {
                        const g = sorted[i + 1] - sorted[i];
                        if (g > 0) { gaps.push(g); }
                    }
                    if (gaps.length) { pixelWidth = Math.min(...gaps); }
                }
                geoBreakMax.set(key, sorted[sorted.length - 1] + pixelWidth - 1);
            }
        }

        // ── DMX Modes ────────────────────────────────────────────────────────
        // Channel count = sum of (max slot used) per DMX break.
        // Channels with non-empty Offset="a,b,c" contribute max(a,b,c) as slot on their break.
        // Channels with Offset="" reference a geometry type expanded by GeometryReference
        // instances; use geoBreakMax to find the max slot on each break for that geometry.
        const dmxModes: Array<{ name: string; description: string; channelCount: number }> = [];
        const modeRe = /<DMXMode\b([^>]*)>([\s\S]*?)<\/DMXMode>/g;
        let modeM: RegExpExecArray | null;
        while ((modeM = modeRe.exec(xml)) !== null) {
            const mAttrs  = modeM[1];
            const mBody   = modeM[2];
            const modeName = attrVal(mAttrs, 'Name');
            const rawDesc = attrVal(mAttrs, 'Description');
            const modeDesc = rawDesc === 'StringConv Failed' ? '' : rawDesc;

            const maxSlotPerBreak = new Map<number, number>(); // dmxBreak -> max slot used

            const chanTagRe = /<DMXChannel\b([^>]*?)(?:\/>|>)/g;
            let cm: RegExpExecArray | null;
            while ((cm = chanTagRe.exec(mBody)) !== null) {
                const cAttrs  = cm[1];
                const offset  = attrVal(cAttrs, 'Offset');
                const dmxBreak = parseInt(attrVal(cAttrs, 'DMXBreak') || '1', 10);
                const geometry = attrVal(cAttrs, 'Geometry');

                if (offset) {
                    // Regular channel: max slot = max value in comma-separated offset list
                    const maxSlot = Math.max(...offset.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)));
                    if (maxSlot > 0) {
                        maxSlotPerBreak.set(dmxBreak, Math.max(maxSlotPerBreak.get(dmxBreak) ?? 0, maxSlot));
                    }
                } else if (geometry) {
                    // GeometryRef channel: pull max slots from pre-computed map for each break
                    for (const [key, maxSlot] of geoBreakMax) {
                        if (key.startsWith(`${geometry}:`)) {
                            const brk = parseInt(key.split(':')[1], 10);
                            maxSlotPerBreak.set(brk, Math.max(maxSlotPerBreak.get(brk) ?? 0, maxSlot));
                        }
                    }
                }
            }

            let channelCount = 0;
            for (const s of maxSlotPerBreak.values()) { channelCount += s; }
            dmxModes.push({ name: modeName, description: modeDesc, channelCount });
        }

        // ── WiringObjects ────────────────────────────────────────────────────
        // Suppress purely-default/empty values to reduce noise
        const isZero = (v: string) => !v || v === '0' || v === '0.000000';
        const wiringObjects: Array<{
            name: string; componentType: string; connectorType: string; signalType: string;
            pinCount: string; voltage: string; voltageRangeMin: string; voltageRangeMax: string;
            electricalPayLoad: string; frequencyRangeMin: string; frequencyRangeMax: string;
        }> = [];
        const woRe = /<WiringObject\b([^>]*?)\/?>/g;
        let woM: RegExpExecArray | null;
        while ((woM = woRe.exec(xml)) !== null) {
            const a = woM[1];
            const g = (k: string) => attrVal(a, k);
            wiringObjects.push({
                name: g('Name'),
                componentType: g('ComponentType'),
                connectorType: g('ConnectorType'),
                signalType: g('SignalType'),
                pinCount: isZero(g('PinCount')) ? '' : g('PinCount'),
                voltage: isZero(g('Voltage')) ? '' : g('Voltage'),
                voltageRangeMin: isZero(g('VoltageRangeMin')) ? '' : g('VoltageRangeMin'),
                voltageRangeMax: isZero(g('VoltageRangeMax')) ? '' : g('VoltageRangeMax'),
                electricalPayLoad: isZero(g('ElectricalPayLoad')) ? '' : g('ElectricalPayLoad'),
                frequencyRangeMin: isZero(g('FrequencyRangeMin')) ? '' : g('FrequencyRangeMin'),
                frequencyRangeMax: isZero(g('FrequencyRangeMax')) ? '' : g('FrequencyRangeMax'),
            });
        }
        // Deduplicate by name+componentType (same connector appears once per geometry instance)
        const woSeen = new Set<string>();
        const uniqueWiringObjects = wiringObjects.filter(wo => {
            const key = `${wo.componentType}|${wo.connectorType}|${wo.signalType}|${wo.name}`;
            if (woSeen.has(key)) { return false; }
            woSeen.add(key);
            return true;
        });

        return {
            name: ft('Name'),
            shortName: ft('ShortName'),
            manufacturer: ft('Manufacturer'),
            longDescription: ft('LongName') || ft('Description'),
            thumbnail: ft('Thumbnail'),
            fixtureTypeId: ft('FixtureTypeID'),
            dataVersion: attrVal(gdtfAttrs, 'DataVersion'),
            revisions,
            rdm,
            dmxModes,
            wiringObjects: uniqueWiringObjects,
        };
    }

    private async getHtmlForWebview(webview: vscode.Webview, document: ZipDocument): Promise<string> {
        const rawFileName = document.uri.fsPath.split(/[\\/]/).pop() ?? '';
        const isGdtf = rawFileName.toLowerCase().endsWith('.gdtf');

        const files: Array<{ path: string; size: number; isDirectory: boolean }> = [];
        document.zipData.forEach((relativePath, file) => {
            files.push({
                path: relativePath,
                size: file.dir ? 0 : ((file as any)._data?.uncompressedSize ?? 0),
                isDirectory: file.dir,
            });
        });
        files.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) { return a.isDirectory ? -1 : 1; }
            return a.path.localeCompare(b.path);
        });

        // Load image thumbnails as base64 data URIs
        const thumbnails = new Map<string, string>();
        await Promise.all(
            files
                .filter(f => !f.isDirectory && this.isImageFile(f.path))
                .map(async f => {
                    const zf = document.zipData.file(f.path);
                    if (zf) {
                        const b64 = await zf.async('base64');
                        thumbnails.set(f.path, `data:${this.getMimeType(f.path)};base64,${b64}`);
                    }
                })
        );

        // Parse GDTF metadata from description.xml
        let gdtfMeta: ReturnType<typeof this.parseGdtfMetadata> | null = null;
        if (isGdtf) {
            const descFile = document.zipData.file('description.xml');
            if (descFile) {
                try { gdtfMeta = this.parseGdtfMetadata(await descFile.async('string')); } catch { /* ignore */ }
            }
        }

        // Find fixture thumbnail image (GDTF Thumbnail attr = basename without extension)
        let fixtureThumbnailSrc: string | undefined;
        if (gdtfMeta?.thumbnail) {
            const base = gdtfMeta.thumbnail;
            for (const ext of ['png', 'jpg', 'jpeg', 'svg']) {
                const src = thumbnails.get(`${base}.${ext}`) ?? thumbnails.get(`thumbnails/${base}.${ext}`);
                if (src) { fixtureThumbnailSrc = src; break; }
            }
        }

        const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        const fileName = this.escapeHtml(rawFileName);

        // Build a single table row for a file
        const buildRow = (file: { path: string; size: number; isDirectory: boolean }): string => {
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
        const sectionHeader = (label: string, count: number) =>
            `<tr><td colspan="2" style="padding:10px 8px 2px;font-size:0.78em;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--vscode-descriptionForeground);border-top:1px solid var(--vscode-panel-border);">${label} <span style="font-weight:400;">(${count})</span></td></tr>`;

        // Build file rows — grouped for GDTF, flat for ZIP
        let fileListHtml: string;
        if (isGdtf) {
            const groups: Record<string, typeof files> = { description: [], thumbnails: [], wheels: [], models: [], other: [] };
            for (const f of files) {
                if (f.isDirectory) { continue; }
                const p = f.path.toLowerCase();
                if (p === 'description.xml') { groups.description.push(f); }
                else if (p.startsWith('wheels/')) { groups.wheels.push(f); }
                else if (p.startsWith('models/')) { groups.models.push(f); }
                else if (this.isImageFile(f.path) && !f.path.includes('/')) { groups.thumbnails.push(f); }
                else { groups.other.push(f); }
            }
            const parts: string[] = [];
            const addSection = (key: string, label: string) => {
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
        } else {
            fileListHtml = files.map(buildRow).join('\n');
        }

        // ── GDTF extended info card ──────────────────────────────────────────
        const gdtfHeaderHtml = gdtfMeta ? (() => {
            const e = (s: string) => this.escapeHtml(s);
            const badge = (label: string, title = '') =>
                `<span title="${e(title)}" style="display:inline-block;font-size:0.72em;font-weight:600;padding:2px 7px;border-radius:3px;border:1px solid var(--vscode-badge-foreground);color:var(--vscode-badge-foreground);background:var(--vscode-badge-background);margin-right:4px;margin-bottom:4px;">${e(label)}</span>`;

            // ── identity block ─────────────────────────────────────────────
            const titleLine = `<div style="font-size:1.25em;font-weight:600;margin-bottom:4px;">${e(gdtfMeta.name)}</div>`;
            const subLine = `<div style="color:var(--vscode-descriptionForeground);margin-bottom:4px;">${e(gdtfMeta.manufacturer)}${gdtfMeta.shortName && gdtfMeta.shortName !== gdtfMeta.name ? ' · ' + e(gdtfMeta.shortName) : ''}</div>`;
            const descLine = gdtfMeta.longDescription ? `<div style="font-size:0.9em;color:var(--vscode-descriptionForeground);margin-bottom:6px;">${e(gdtfMeta.longDescription)}</div>` : '';

            // ── UUID + version ─────────────────────────────────────────────
            const uuidLine = gdtfMeta.fixtureTypeId
                ? `<div style="font-size:0.8em;font-family:monospace;color:var(--vscode-descriptionForeground);margin-bottom:4px;">UUID: ${e(gdtfMeta.fixtureTypeId)}${gdtfMeta.dataVersion ? ' &nbsp;·&nbsp; GDTF ' + e(gdtfMeta.dataVersion) : ''}</div>`
                : '';

            // ── badges (RDM etc.) ──────────────────────────────────────────
            let badges = '';
            if (gdtfMeta.rdm) {
                const rdm = gdtfMeta.rdm;
                const tip = `Manufacturer ID: ${rdm.manufacturerId}  Device Model ID: ${rdm.deviceModelId}${rdm.softwareVersions.length ? '  SW: ' + rdm.softwareVersions.join(', ') : ''}`;
                badges += badge('RDM', tip);
            }

            // ── revisions ──────────────────────────────────────────────────
            let revisionsHtml = '';
            if (gdtfMeta.revisions.length) {
                const makeRevRow = (r: { text: string; date: string; userId: string }) => {
                    const dateStr = r.date ? r.date.replace('T', ' ').substring(0, 16) : '';
                    return `<tr><td style="padding:3px 8px 3px 0;font-size:0.82em;white-space:nowrap;color:var(--vscode-descriptionForeground);">${e(dateStr)}</td><td style="padding:3px 0;font-size:0.82em;">${e(r.text)}</td></tr>`;
                };
                const revsSorted = [...gdtfMeta.revisions].reverse(); // newest first
                const shownRevs = revsSorted.slice(0, 3);
                const hiddenRevs = revsSorted.slice(3);
                const shownRows = shownRevs.map(makeRevRow).join('');
                const moreHtml = hiddenRevs.length
                    ? `<details style="margin-top:2px;"><summary style="cursor:pointer;font-size:0.78em;color:var(--vscode-descriptionForeground);list-style:none;user-select:none;">and ${hiddenRevs.length} more…</summary><table style="border-collapse:collapse;width:100%;"><tbody>${hiddenRevs.map(makeRevRow).join('')}</tbody></table></details>`
                    : '';
                revisionsHtml = `
                <div style="margin-top:10px;">
                    <div style="font-size:0.78em;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--vscode-descriptionForeground);margin-bottom:4px;">Revisions</div>
                    <table style="border-collapse:collapse;width:100%;"><tbody>${shownRows}</tbody></table>
                    ${moreHtml}
                </div>`;
            }

            // ── DMX modes ─────────────────────────────────────────────────
            let modesHtml = '';
            if (gdtfMeta.dmxModes.length) {
                const rows = gdtfMeta.dmxModes.map(m => {
                    const chBadge = `<span style="font-size:0.78em;font-weight:700;padding:1px 5px;border-radius:3px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);margin-right:6px;">${m.channelCount} ch</span>`;
                    return `<tr><td style="padding:4px 8px 4px 0;white-space:nowrap;vertical-align:top;">${chBadge}<span style="font-weight:600;font-size:0.88em;">${e(m.name)}</span></td><td style="padding:4px 0;font-size:0.83em;color:var(--vscode-descriptionForeground);">${e(m.description)}</td></tr>`;
                }).join('');
                modesHtml = `
                <div style="margin-top:10px;">
                    <div style="font-size:0.78em;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--vscode-descriptionForeground);margin-bottom:4px;">DMX Modes</div>
                    <table style="border-collapse:collapse;width:100%;"><tbody>${rows}</tbody></table>
                </div>`;
            }

            // ── wiring objects ─────────────────────────────────────────────
            const fmtNum = (s: string): string => { const n = parseFloat(s); return isNaN(n) ? s : String(n); };
            let wiringHtml = '';
            if (gdtfMeta.wiringObjects.length) {
                const signalIcon: Record<string, string> = {
                    Power: '⚡', DMX512: '🎛️', Ethernet: '🌐', DALI: '💡', CAN: '🔌', RS485: '🔌',
                };
                const rows = gdtfMeta.wiringObjects.map(wo => {
                    const icon = signalIcon[wo.signalType] ?? '🔌';
                    const details: string[] = [];
                    if (wo.pinCount) { details.push(`${fmtNum(wo.pinCount)}-pin`); }
                    if (wo.voltageRangeMin && wo.voltageRangeMax) {
                        details.push(`${fmtNum(wo.voltageRangeMin)}–${fmtNum(wo.voltageRangeMax)} V`);
                    } else if (wo.voltageRangeMax) {
                        details.push(`≤${fmtNum(wo.voltageRangeMax)} V`);
                    } else if (wo.voltage) {
                        details.push(`${fmtNum(wo.voltage)} V`);
                    }
                    if (wo.electricalPayLoad) { details.push(`${fmtNum(wo.electricalPayLoad)} W`); }
                    if (wo.frequencyRangeMin && wo.frequencyRangeMax) {
                        details.push(`${fmtNum(wo.frequencyRangeMin)}–${fmtNum(wo.frequencyRangeMax)} Hz`);
                    }
                    const detailStr = details.length ? `<span style="color:var(--vscode-descriptionForeground);font-size:0.82em;margin-left:6px;">${e(details.join(' · '))}</span>` : '';
                    const typeLabel = `<span style="font-size:0.75em;color:var(--vscode-descriptionForeground);margin-left:6px;">${e(wo.componentType)}</span>`;
                    return `<tr><td style="padding:3px 8px 3px 0;white-space:nowrap;">${icon} <strong style="font-size:0.88em;">${e(wo.connectorType)}</strong>${typeLabel}</td><td style="padding:3px 0;font-size:0.85em;">${e(wo.name)}${detailStr}</td></tr>`;
                }).join('');
                wiringHtml = `
                <div style="margin-top:10px;">
                    <div style="font-size:0.78em;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--vscode-descriptionForeground);margin-bottom:4px;">Connectors</div>
                    <table style="border-collapse:collapse;width:100%;"><tbody>${rows}</tbody></table>
                </div>`;
            }

            const thumbHtml = fixtureThumbnailSrc
                ? `<img src="${fixtureThumbnailSrc}" alt="Fixture" style="max-width:100px;max-height:100px;border-radius:4px;object-fit:contain;flex-shrink:0;">`
                : '';

            return `
        <div style="margin:16px 0;padding:16px;background:var(--vscode-editor-inactiveSelectionBackground);border:1px solid var(--vscode-panel-border);border-radius:6px;">
            <div style="display:flex;align-items:flex-start;gap:16px;">
                ${thumbHtml}
                <div style="flex:1;min-width:0;">
                    ${titleLine}${subLine}${descLine}${uuidLine}
                    <div style="margin-top:4px;">${badges}</div>
                </div>
            </div>
            ${revisionsHtml}${modesHtml}${wiringHtml}
        </div>`;
        })() : '';

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

    private formatBytes(bytes: number): string {
        if (bytes === 0) {
            return '0 Bytes';
        }
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
}
