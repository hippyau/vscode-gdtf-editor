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
exports.activate = activate;
exports.deactivate = deactivate;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = __importStar(require("vscode"));
const zipViewerProvider_1 = require("./zipViewerProvider");
const gdtfHoverProvider_1 = require("./gdtfHoverProvider");
const gdtfSchemaValidator_1 = require("./gdtfSchemaValidator");
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
function activate(context) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Zip Viewer extension is now active!');
    // Register the custom editor provider for zip files
    const provider = new zipViewerProvider_1.ZipViewerProvider(context.extensionUri);
    const registration = vscode.window.registerCustomEditorProvider(zipViewerProvider_1.ZipViewerProvider.viewType, provider, {
        webviewOptions: {
            retainContextWhenHidden: true
        },
        supportsMultipleEditorsPerDocument: false
    });
    context.subscriptions.push(registration);
    const schemaValidator = new gdtfSchemaValidator_1.GdtfSchemaValidator(context.extensionPath);
    schemaValidator.register(context);
    // GDTF hover provider: colour + media on <Slot>/<ChannelSet> elements in description.xml
    // Registers for 'xml' and 'gdtf' (MA Lighting extension language ID)
    const langs = [{ language: 'xml' }, { language: 'gdtf' }];
    context.subscriptions.push(vscode.languages.registerHoverProvider(langs, new gdtfHoverProvider_1.GdtfHoverProvider()), vscode.languages.registerColorProvider(langs, new gdtfHoverProvider_1.GdtfColorProvider()), vscode.workspace.onDidCloseTextDocument(doc => (0, gdtfHoverProvider_1.cleanupDocTempFiles)(doc.uri.fsPath)));
}
// This method is called when your extension is deactivated
function deactivate() { }
//# sourceMappingURL=extension.js.map