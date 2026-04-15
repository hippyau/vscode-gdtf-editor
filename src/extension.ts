// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ZipViewerProvider } from './zipViewerProvider';
import { GdtfHoverProvider, GdtfColorProvider, cleanupDocTempFiles } from './gdtfHoverProvider';
import { GdtfSchemaValidator } from './gdtfSchemaValidator';
import { GdtfDocumentSymbolProvider } from './gdtfDocumentSymbolProvider';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('GDTF Editor extension is now active!');

	// Register the custom editor provider for zip files
	const provider = new ZipViewerProvider(context.extensionUri);
	const registration = vscode.window.registerCustomEditorProvider(
		ZipViewerProvider.viewType,
		provider,
		{
			webviewOptions: {
				retainContextWhenHidden: true
			},
			supportsMultipleEditorsPerDocument: false
		}
	);

	context.subscriptions.push(registration);
	context.subscriptions.push(provider.registerSaveListener());

	const schemaValidator = new GdtfSchemaValidator(context.extensionPath);
	schemaValidator.register(context);

	// GDTF hover provider: colour + media on <Slot>/<ChannelSet> elements in description.xml
	// Registers for 'xml' and 'gdtf' (MA Lighting extension language ID)
	const langs = [{ language: 'xml' }, { language: 'gdtf' }];
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(langs, new GdtfHoverProvider()),
		vscode.languages.registerColorProvider(langs, new GdtfColorProvider()),
		vscode.languages.registerDocumentSymbolProvider({ language: 'gdtf' }, new GdtfDocumentSymbolProvider()),
		vscode.workspace.onDidCloseTextDocument(doc => cleanupDocTempFiles(doc.uri.fsPath))
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
