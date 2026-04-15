import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { parseXmllintOutput } from '../gdtfSchemaValidator';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('parseXmllintOutput extracts line diagnostics', () => {
		const output = [
			'/tmp/example.xml:2: element GDTF: Schemas validity error : Element \'GDTF\', attribute \'DataVersion\': [facet \'minInclusive\'] The value \'1.0\' is less than the minimum value allowed (\'1.1\').',
			'/tmp/example.xml:12: element ChannelFunction: Schemas validity error : Element \'ChannelFunction\': The attribute \'Default\' is required but missing.',
			'/tmp/example.xml fails to validate'
		].join('\n');

		assert.deepStrictEqual(parseXmllintOutput(output), [
			{
				line: 2,
				message: "Element 'GDTF', attribute 'DataVersion': [facet 'minInclusive'] The value '1.0' is less than the minimum value allowed ('1.1')."
			},
			{
				line: 12,
				message: "Element 'ChannelFunction': The attribute 'Default' is required but missing."
			}
		]);
	});
});
