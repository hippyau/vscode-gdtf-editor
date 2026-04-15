# GDTF Editor

A Visual Studio Code extension for viewing, validating, and editing [GDTF (General Device Type Format)](https://gdtf-share.com/) fixture description files (`.gdtf`).


## Features

- **Browse GDTF Contents**: Open any `.gdtf` file directly in VS Code to see its contents in a clean, organised table view, with directories listed first
- **Preview Files**: Click any text-based file inside the archive (XML, JSON, SVG, etc.) to open it in a new editor tab with syntax highlighting
- **Edit & Save Back**: Edit any extracted text file and save it — you'll be prompted to write the changes back into the `.gdtf` archive
- **Validate Against Schema**: `description.xml` is automatically validated against the bundled `gdtf.xsd` schema via `xmllint`; errors and warnings appear in the Problems panel
- **Hover Documentation**: Hover over XML elements in `description.xml` to see attribute descriptions drawn from the GDTF schema
- **Document Symbols**: The Outline view shows the structure of `description.xml` for quick navigation
- **File Information**: View file paths and sizes for every entry in the archive

## Usage

1. Open any `.gdtf` file in VS Code
2. The GDTF Editor opens automatically and lists the archive contents
3. Click a file name to preview its contents
4. Edit the file and press **Ctrl+S** — when prompted, choose **Update GDTF** to write the changes back into the archive
5. Schema validation results for `description.xml` appear in the Problems panel

## Requirements

- `xmllint` must be available on your `PATH` for GDTF schema validation

## Development

```bash
npm install
npm run compile   # build once
npm run watch     # rebuild on change
```

Press `F5` to launch an Extension Development Host and open a `.gdtf` file to test.

## Building a VSIX

```bash
npm run package   # produces a .vsix file via vsce
```

## Credits

> **Based on** [Zip ViewerX](https://marketplace.visualstudio.com/items?itemName=MaksHoffman.zip-viewerx) — used to open Zip files.


> **Includes** [GDTF 1.2 Schema](https://github.com/mvrdevelopment/tools/blob/main/gdtf.xsd) from mvrdevelopment/tools

## License

WTFPL
