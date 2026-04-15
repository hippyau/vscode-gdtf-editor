import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { lookupZipForTmpFile } from './gdtfRegistry';

// ── CIE xyY → sRGB ────────────────────────────────────────────────────────────

function xyYtoRGB(x: number, y: number, Yn: number): [number, number, number] {
    if (y === 0 || Yn === 0) { return [0, 0, 0]; }
    const Y = Yn / 100;
    const X = (Y / y) * x;
    const Z = (Y / y) * (1 - x - y);
    let r =  3.2406 * X - 1.5372 * Y - 0.4986 * Z;
    let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
    let b =  0.0557 * X - 0.2040 * Y + 1.0570 * Z;
    const gamma = (c: number) => {
        c = Math.max(0, Math.min(1, c));
        return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    };
    return [Math.round(gamma(r) * 255), Math.round(gamma(g) * 255), Math.round(gamma(b) * 255)];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function attr(tag: string, name: string): string | undefined {
    return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[ 1];
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isGdtfDoc(document: vscode.TextDocument): boolean {
    const head = document.getText(new vscode.Range(0, 0, Math.min(5, document.lineCount), 0));
    return head.includes('<GDTF') || head.includes('<FixtureType');
}

function isWhiteHex(hex: string): boolean {
    return hex.toLowerCase() === '#ffffff';
}

function mimeForExt(ext: string): string {
    switch (ext.toLowerCase()) {
        case 'png': return 'image/png';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'gif': return 'image/gif';
        case 'svg': return 'image/svg+xml';
        case 'webp': return 'image/webp';
        default: return 'application/octet-stream';
    }
}

function svgPreview(imageHref: string, swatchHex?: string): string {
    const previewWidth = 128;
    const totalWidth = swatchHex ? 170 : 128;
    const swatch = swatchHex
        ? `<rect x="138" y="50" width="28" height="28" rx="3" fill="${swatchHex}" stroke="#888"/>`
        : '';

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} 128" width="${totalWidth}" height="128">`,
        `<rect width="100%" height="100%" rx="4" fill="#1e1e1e"/>`,
        `<image href="${imageHref}" x="0" y="0" width="${previewWidth}" height="128" preserveAspectRatio="xMidYMid meet"/>`,
        swatch,
        `</svg>`,
    ].join('');
}

function swatchOnlySvg(swatchHex: string): string {
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">`,
        `<rect width="28" height="28" rx="3" fill="${swatchHex}" stroke="#888"/>`,
        `</svg>`,
    ].join('');
}

// ── Cuboid SVG (isometric projection) ───────────────────────────────────────

function cuboidSvg(wM: number, hM: number, lM: number): string {
    // Scale so the longest dimension = 100 px, min 10
    const maxDim = Math.max(wM, hM, lM, 0.001);
    const scale = 100 / maxDim;
    const W = Math.max(wM * scale, 8);
    const H = Math.max(hM * scale, 8);
    const L = Math.max(lM * scale, 8);

    // Isometric projection constants
    const cosA = Math.cos(Math.PI / 6); // 30°
    const sinA = Math.sin(Math.PI / 6);

    // iso() maps 3D (x right, y up, z depth) → 2D SVG
    const iso = (x: number, y: number, z: number): [number, number] => [
        (x - z) * cosA,
        -(y) + (x + z) * sinA
    ];

    // 8 corners of box [0..W] x [0..H] x [0..L]
    const corners = [
        iso(0, 0, 0), iso(W, 0, 0), iso(W, 0, L), iso(0, 0, L),  // bottom
        iso(0, H, 0), iso(W, H, 0), iso(W, H, L), iso(0, H, L),  // top
    ];

    // SVG viewBox: find min/max
    const xs = corners.map(c => c[0]);
    const ys = corners.map(c => c[1]);
    const pad = 24;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const vbW = Math.max(...xs) - minX + pad;
    const vbH = Math.max(...ys) - minY + pad;

    const pt = (i: number) => `${(corners[i][0] - minX).toFixed(1)},${(corners[i][1] - minY).toFixed(1)}`;

    // Faces: right (0-1-5-4), front (1-2-6-5), top (4-5-6-7)
    const face = (indices: number[], fill: string) =>
        `<polygon points="${indices.map(pt).join(' ')}" fill="${fill}" stroke="#555" stroke-width="1" stroke-linejoin="round"/>`;

    // Dimension label helpers: midpoint between two corners in SVG space
    const mid = (a: number, b: number): [number, number] => [
        (corners[a][0] + corners[b][0]) / 2 - minX,
        (corners[a][1] + corners[b][1]) / 2 - minY,
    ];
    const label = (pos: [number, number], txt: string, dx = 0, dy = 0) =>
        `<text x="${(pos[0] + dx).toFixed(1)}" y="${(pos[1] + dy).toFixed(1)}" ` +
        `font-size="10" fill="#ccc" text-anchor="middle" font-family="monospace">${txt}</text>`;

    const fmt = (v: number) => v < 0.01 ? `${(v * 1000).toFixed(0)}mm` : v < 1 ? `${(v * 100).toFixed(0)}cm` : `${v.toFixed(2)}m`;

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW.toFixed(1)} ${vbH.toFixed(1)}" width="${Math.round(vbW)}" height="${Math.round(vbH)}">`,
        `<rect width="100%" height="100%" fill="#1e1e1e" rx="4"/>`,
        face([0, 1, 5, 4], '#3a5a8a'),   // right face
        face([1, 2, 6, 5], '#2a4a7a'),   // front face
        face([4, 5, 6, 7], '#4a6a9a'),   // top face
        // Dimension labels
        label(mid(0, 1), fmt(wM), 0, 12),      // width along bottom-front edge
        label(mid(1, 2), fmt(lM), 10, 4),      // length along bottom-right edge
        label(mid(1, 5), fmt(hM), 14, 0),      // height along right vertical
        `</svg>`,
    ].join('\n');
}

// ── Slot resolution ───────────────────────────────────────────────────────────

interface SlotInfo {
    slotName: string;
    wheelName: string;
    hex: string;
    mediaFile: string | undefined;
}

function slotInfoFromTag(slotTag: string, wheelName: string): SlotInfo | undefined {
    const colorStr = attr(slotTag, 'Color');
    if (!colorStr) { return undefined; }
    const parts = colorStr.split(',').map(s => parseFloat(s.trim()));
    if (parts.length < 3 || parts.some(isNaN)) { return undefined; }
    const [r, g, b] = xyYtoRGB(parts[0], parts[1], parts[2]);
    const hex = `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
    return { slotName: attr(slotTag, 'Name') ?? 'Slot', wheelName, hex, mediaFile: attr(slotTag, 'MediaFileName') };
}

function findWheelSlotByIndex(text: string, wheelName: string, slotIndex: number): string | undefined {
    const wm = new RegExp(`<Wheel\\b[^>]*\\bName="${escapeRegex(wheelName)}"[^>]*>`).exec(text);
    if (!wm) { return undefined; }
    const wheelEnd = text.indexOf('</Wheel>', wm.index);
    const chunk = text.substring(wm.index, wheelEnd !== -1 ? wheelEnd : text.length);
    const re = /<Slot\b[^>]*>/g;
    let count = 0; let sm: RegExpExecArray | null;
    while ((sm = re.exec(chunk)) !== null) {
        if (++count === slotIndex) { return sm[0]; }
    }
    return undefined;
}

// ── Temp file tracking (cleanup on document close) ─────────────────────────

const tempFilesByDoc = new Map<string, Set<string>>();

function hashText(text: string): string {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return Math.abs(hash).toString(36);
}

function buildDocTempPath(docPath: string, prefix: string, safeName: string, extension: string): string {
    return path.join(os.tmpdir(), `${prefix}-${hashText(docPath)}-${safeName}.${extension}`);
}

function registerTempFile(docPath: string, tmpPath: string): void {
    if (!tempFilesByDoc.has(docPath)) { tempFilesByDoc.set(docPath, new Set()); }
    tempFilesByDoc.get(docPath)!.add(tmpPath);
}

export function cleanupDocTempFiles(docPath: string): void {
    const files = tempFilesByDoc.get(docPath);
    if (files) {
        for (const f of files) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
        tempFilesByDoc.delete(docPath);
    }
}

async function writeTempTextFile(
    docPath: string,
    prefix: string,
    safeName: string,
    extension: string,
    content: string
): Promise<string> {
    const tmpPath = buildDocTempPath(docPath, prefix, safeName, extension);
    await fsPromises.writeFile(tmpPath, content, 'utf8');
    registerTempFile(docPath, tmpPath);
    return tmpPath;
}

async function buildImagePreviewFile(
    docPath: string,
    imageName: string,
    imageBuffer: Buffer,
    ext: string,
    swatchHex?: string
): Promise<string> {
    const imageHref = `data:${mimeForExt(ext)};base64,${imageBuffer.toString('base64')}`;
    const previewSvg = svgPreview(imageHref, swatchHex);
    const safeName = imageName.replace(/[^a-zA-Z0-9_-]/g, '_');
    return writeTempTextFile(docPath, 'gdtf-preview', safeName, 'svg', previewSvg);
}

// ── Inline colour swatches (DocumentColorProvider) ────────────────────────────

export class GdtfColorProvider implements vscode.DocumentColorProvider {
    provideDocumentColors(document: vscode.TextDocument): vscode.ColorInformation[] {
        if (!isGdtfDoc(document)) { return []; }
        const text = document.getText();
        const results: vscode.ColorInformation[] = [];
        const re = /<Slot\b[^>]*\bColor="([^"]+)"[^>]*>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const colorStr = m[1];
            const parts = colorStr.split(',').map(s => parseFloat(s.trim()));
            if (parts.length < 3 || parts.some(isNaN)) { continue; }
            const [r, g, b] = xyYtoRGB(parts[0], parts[1], parts[2]);
            const attrIdx = text.indexOf(`Color="${colorStr}"`, m.index);
            if (attrIdx === -1) { continue; }
            const valStart = attrIdx + 'Color="'.length;
            results.push(new vscode.ColorInformation(
                new vscode.Range(document.positionAt(valStart), document.positionAt(valStart + colorStr.length)),
                new vscode.Color(r / 255, g / 255, b / 255, 1)
            ));
        }
        return results;
    }

    provideColorPresentations(
        _color: vscode.Color,
        ctx: { document: vscode.TextDocument; range: vscode.Range }
    ): vscode.ColorPresentation[] {
        // Preserve original CIE text — don't offer editable presentations
        return [new vscode.ColorPresentation(ctx.document.getText(ctx.range))];
    }
}

// ── Hover popup ───────────────────────────────────────────────────────────────

export class GdtfHoverProvider implements vscode.HoverProvider {
    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        if (!isGdtfDoc(document)) { return undefined; }

        const text = document.getText();
        const offset = document.offsetAt(position);
        const before = text.substring(0, offset);
        const line = document.lineAt(position.line).text;

        // ── FixtureType Thumbnail attribute ──
        const thumbnailMatch = /Thumbnail="([^"]+)"/.exec(line);
        if (thumbnailMatch) {
            const value = thumbnailMatch[1];
            const valueStart = thumbnailMatch.index + 'Thumbnail="'.length;
            const valueEnd = valueStart + value.length;
            if (position.character >= valueStart && position.character <= valueEnd) {
                const zip = lookupZipForTmpFile(document.uri.fsPath);
                const md = new vscode.MarkdownString(undefined, true);
                md.supportHtml = true;
                md.isTrusted = true;
                md.appendMarkdown(`**Fixture Thumbnail**\n\n`);
                if (zip) {
                    for (const ext of ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp']) {
                        const zf = zip.file(`${value}.${ext}`);
                        if (zf) {
                            const previewPath = await buildImagePreviewFile(
                                document.uri.fsPath,
                                `thumb-${value}`,
                                await zf.async('nodebuffer'),
                                ext
                            );
                            md.appendMarkdown(`![${value}](${vscode.Uri.file(previewPath)})\n\n`);
                            md.appendMarkdown(`\`${value}.${ext}\``);
                            return new vscode.Hover(md);
                        }
                    }
                }
                md.appendMarkdown(`⚠️ **Missing thumbnail image:** \`${value}\``);
                return new vscode.Hover(md);
            }
        }

        const channelSetStart = before.lastIndexOf('<ChannelSet');
        const slotStart = before.lastIndexOf('<Slot');
        const modelStart = before.lastIndexOf('<Model');

        // ── <Model> element ──
        const modelIsNearest = modelStart > channelSetStart && modelStart > slotStart;
        if (modelIsNearest) {
            const mEnd = text.indexOf('>', modelStart);
            if (mEnd !== -1 && offset <= mEnd + 1) {
                const modelTag = text.substring(modelStart, mEnd + 1);
                const mName = attr(modelTag, 'Name') ?? 'Model';
                const mW = parseFloat(attr(modelTag, 'Width') ?? '0');
                const mH = parseFloat(attr(modelTag, 'Height') ?? '0');
                const mL = parseFloat(attr(modelTag, 'Length') ?? '0');
                const mType = attr(modelTag, 'PrimitiveType');
                if (!isNaN(mW) && !isNaN(mH) && !isNaN(mL)) {
                    const svgStr = cuboidSvg(mW, mH, mL);
                    const tmpSvg = buildDocTempPath(
                        document.uri.fsPath,
                        'gdtf-model',
                        mName.replace(/[^a-zA-Z0-9_-]/g, '_'),
                        'svg'
                    );
                    await fsPromises.writeFile(tmpSvg, svgStr, 'utf8');
                    registerTempFile(document.uri.fsPath, tmpSvg);
                    const md = new vscode.MarkdownString(undefined, true);
                    md.supportHtml = true;
                    md.isTrusted = true;
                    const fmt = (v: number) => v < 0.01 ? `${(v*1000).toFixed(0)} mm` : v < 1 ? `${(v*100).toFixed(0)} cm` : `${v.toFixed(3)} m`;
                    md.appendMarkdown(`**Model: ${mName}**${mType ? ` · \`${mType}\`` : ''}\n\n`);
                    md.appendMarkdown(`![${mName}](${vscode.Uri.file(tmpSvg)})\n\n`);
                    md.appendMarkdown(`W ${fmt(mW)} · H ${fmt(mH)} · L ${fmt(mL)}\n\n`);
                    return new vscode.Hover(md);
                }
            }
        }

        // ── ChannelSet with WheelSlotIndex ──
        if (channelSetStart > slotStart) {
            const csEnd = text.indexOf('>', channelSetStart);
            if (csEnd !== -1 && offset <= csEnd) {
                const csTag = text.substring(channelSetStart, csEnd + 1);
                const wsi = parseInt(attr(csTag, 'WheelSlotIndex') ?? '0', 10);
                if (wsi > 0) {
                    const cfMatch = text.substring(0, channelSetStart)
                        .match(/[\s\S]*(<ChannelFunction\b[^>]*\bWheel="[^"]+[^>]*>)/);
                    if (cfMatch) {
                        const wheelName = attr(cfMatch[1], 'Wheel');
                        if (wheelName) {
                            const slotTag = findWheelSlotByIndex(text, wheelName, wsi);
                            if (slotTag) {
                                const info = slotInfoFromTag(slotTag, wheelName);
                                if (info) { return this.buildHover(info, document); }
                            }
                        }
                    }
                }
            }
        }

        // ── <Slot> element ──
        if (slotStart === -1) { return undefined; }
        const selfClose = text.indexOf('/>', slotStart);
        const tagClose = text.indexOf('</Slot>', slotStart);
        const slotEnd = selfClose !== -1 ? (tagClose !== -1 ? Math.min(selfClose, tagClose) : selfClose) : tagClose;
        if (slotEnd !== -1 && offset > slotEnd + 2) { return undefined; }
        const tagEnd = text.indexOf('>', slotStart);
        if (tagEnd === -1) { return undefined; }
        const slotTag = text.substring(slotStart, tagEnd + 1);
        const wheelMatch = before.substring(0, slotStart).match(/[\s\S]*<Wheel\b[^>]*\bName="([^"]*)"/);
        const info = slotInfoFromTag(slotTag, wheelMatch?.[1] ?? 'Unknown');
        if (!info) { return undefined; }
        return this.buildHover(info, document);
    }

    private async buildHover(info: SlotInfo, document: vscode.TextDocument): Promise<vscode.Hover> {
        const md = new vscode.MarkdownString(undefined, true);
        md.supportHtml = true;
        md.isTrusted = true;

        md.appendMarkdown(`**Wheel ${info.wheelName} > ${info.slotName}**\n\n`);
        const swatchHex = isWhiteHex(info.hex) ? undefined : info.hex;

        if (info.mediaFile) {
            const zip = lookupZipForTmpFile(document.uri.fsPath);
            let previewPath: string | undefined;
            if (zip) {
                for (const ext of ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp']) {
                    const zf = zip.file(`wheels/${info.mediaFile}.${ext}`);
                    if (zf) {
                        previewPath = await buildImagePreviewFile(
                            document.uri.fsPath,
                            `wheel-${info.mediaFile}`,
                            await zf.async('nodebuffer'),
                            ext,
                            swatchHex
                        );
                        break;
                    }
                }
            }
            if (previewPath) {
                md.appendMarkdown(`![${info.mediaFile}](${vscode.Uri.file(previewPath)})\n\n`);
            } else {
                if (swatchHex) {
                    const swatchPath = await writeTempTextFile(
                        document.uri.fsPath,
                        'gdtf-swatch',
                        info.slotName.replace(/[^a-zA-Z0-9_-]/g, '_'),
                        'svg',
                        swatchOnlySvg(swatchHex)
                    );
                    md.appendMarkdown(`![${info.slotName}](${vscode.Uri.file(swatchPath)})\n\n`);
                }
                md.appendMarkdown(`⚠️ **Missing media:** \`wheels/${info.mediaFile}\`\n\n`);
            }
        } else {
            if (swatchHex) {
                const swatchPath = await writeTempTextFile(
                    document.uri.fsPath,
                    'gdtf-swatch',
                    info.slotName.replace(/[^a-zA-Z0-9_-]/g, '_'),
                    'svg',
                    swatchOnlySvg(swatchHex)
                );
                md.appendMarkdown(`![${info.slotName}](${vscode.Uri.file(swatchPath)})\n\n`);
            }
        }

        return new vscode.Hover(md);
    }
}
