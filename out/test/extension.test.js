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
const assert = __importStar(require("assert"));
// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
const vscode = __importStar(require("vscode"));
const gdtfSchemaValidator_1 = require("../gdtfSchemaValidator");
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
        assert.deepStrictEqual((0, gdtfSchemaValidator_1.parseXmllintOutput)(output), [
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
//# sourceMappingURL=extension.test.js.map