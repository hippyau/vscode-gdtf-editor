import * as vscode from 'vscode';

/**
 * Provides document symbols for GDTF description.xml files so the Outline
 * panel shows the full XML element hierarchy (like the built-in XML provider).
 * Registered for the 'gdtf' language ID.
 */
export class GdtfDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.DocumentSymbol[] {
        const original = document.getText();
        // Blank out XML comments to preserve offsets while preventing false matches
        const stripped = original.replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));
        return buildXmlSymbols(original, stripped, document);
    }
}

function buildXmlSymbols(
    original: string,
    stripped: string,
    document: vscode.TextDocument
): vscode.DocumentSymbol[] {
    const root: vscode.DocumentSymbol[] = [];
    const stack: { sym: vscode.DocumentSymbol; name: string; startOffset: number }[] = [];

    // Match any XML/HTML tag: <tagName ...>, </tagName>, <tagName .../>
    const tagRe = /<[^>]+>/g;
    let m: RegExpExecArray | null;

    while ((m = tagRe.exec(stripped)) !== null) {
        const tagStart = m.index;
        const tagEnd = tagStart + m[0].length;
        const tag = m[0];

        // Skip processing instructions and declarations
        if (tag.startsWith('<?') || tag.startsWith('<!')) { continue; }

        const isClose = tag.startsWith('</');
        const isSelf = tag.endsWith('/>');

        const nameMatch = tag.match(/^<\/?([A-Za-z_][A-Za-z0-9_\-:.]*)/);
        if (!nameMatch) { continue; }
        const tagName = nameMatch[1];

        // Read attributes from original text (not comment-stripped)
        const rawTag = original.slice(tagStart, tagEnd);
        const nameAttr = rawTag.match(/\bName="([^"]*)"/)?.[1] ?? '';

        const startPos = document.positionAt(tagStart);
        const endPos = document.positionAt(tagEnd);
        const selRange = new vscode.Range(startPos, endPos);

        if (isClose) {
            // Find the nearest matching opening tag and close it out
            for (let i = stack.length - 1; i >= 0; i--) {
                if (stack[i].name === tagName) {
                    const entry = stack.splice(i, 1)[0];
                    entry.sym.range = new vscode.Range(
                        document.positionAt(entry.startOffset),
                        endPos
                    );
                    if (stack.length > 0) {
                        stack[stack.length - 1].sym.children.push(entry.sym);
                    } else {
                        root.push(entry.sym);
                    }
                    break;
                }
            }
        } else if (isSelf) {
            const kind = vscode.SymbolKind.Property;
            const sym = new vscode.DocumentSymbol(tagName, nameAttr, kind, selRange, selRange);
            if (stack.length > 0) {
                stack[stack.length - 1].sym.children.push(sym);
            } else {
                root.push(sym);
            }
        } else {
            // Opening tag — kind will stay Module (it has children)
            const sym = new vscode.DocumentSymbol(
                tagName, nameAttr,
                vscode.SymbolKind.Module,
                selRange, selRange  // range is updated when the close tag is found
            );
            stack.push({ sym, name: tagName, startOffset: tagStart });
        }
    }

    // Flush any unclosed tags (malformed XML — treat as root-level)
    while (stack.length > 0) {
        const entry = stack.pop()!;
        if (stack.length > 0) {
            stack[stack.length - 1].sym.children.push(entry.sym);
        } else {
            root.push(entry.sym);
        }
    }

    return root;
}
